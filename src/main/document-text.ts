import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, OEM, type Worker } from "tesseract.js";
import korData from "@tesseract.js-data/kor";
import engData from "@tesseract.js-data/eng";

const MAX_PDF_PAGES = 40;
const MAX_OCR_PAGES = 20;
const MAX_EXTRACTED_CHARS = 1_000_000;
let ocrDataRoot = join(tmpdir(), "mmllm-ocr-data");
type OcrWaiter = {
  resolve: (release: () => void) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};
let ocrLocked = false;
const ocrWaiters: OcrWaiter[] = [];

export function configureOcrDataRoot(path: string): void {
  ocrDataRoot = path;
}

export function pageNeedsOcr(text: string, hasPageImage = false): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/\s/g, "");
  if (compact.length < 4) return true;
  // A short selectable header or watermark can sit over a full-page scanned image.
  // OCR image-bearing pages until the text layer is dense enough to plausibly hold the body.
  if (hasPageImage && compact.length < 800) return true;
  if (compact.length > 80) return false;
  const withoutNoise = normalized.replace(/(?:page|페이지|쪽|confidential|대외비|copyright|©|\d+|[-–—_/|])/gi, "").trim();
  return withoutNoise.replace(/\s/g, "").length < 4;
}

function grantNextOcrSlot(): void {
  while (ocrWaiters.length) {
    const next = ocrWaiters.shift()!;
    if (next.signal?.aborted) {
      next.signal.removeEventListener("abort", next.onAbort!);
      next.reject(next.signal.reason);
      continue;
    }
    next.signal?.removeEventListener("abort", next.onAbort!);
    ocrLocked = true;
    let released = false;
    next.resolve(() => {
      if (released) return;
      released = true;
      ocrLocked = false;
      grantNextOcrSlot();
    });
    return;
  }
  ocrLocked = false;
}

export function acquireOcrSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const waiter: OcrWaiter = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = ocrWaiters.indexOf(waiter);
      if (index >= 0) ocrWaiters.splice(index, 1);
      signal?.removeEventListener("abort", waiter.onAbort!);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    ocrWaiters.push(waiter);
    if (!ocrLocked) grantNextOcrSlot();
  });
}

async function createOcrWorker(): Promise<Worker> {
  const langPath = ocrDataRoot;
  await mkdir(langPath, { recursive: true, mode: 0o700 });
  await Promise.all([
    copyFile(join(korData.langPath, "kor.traineddata.gz"), join(langPath, "kor.traineddata.gz")),
    copyFile(join(engData.langPath, "eng.traineddata.gz"), join(langPath, "eng.traineddata.gz"))
  ]);
  return createWorker("eng+kor", OEM.LSTM_ONLY, { langPath, cachePath: langPath, gzip: true });
}

export async function extractPdf(bytes: Buffer, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  signal?.throwIfAborted();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loadingTask.promise.catch(async (error) => {
    await loadingTask.destroy().catch(() => undefined); throw error;
  });
  const pages: string[] = [];
  let ocrCount = 0;
  let worker: Worker | null = null;
  let releaseOcr: (() => void) | null = null;
  const abortWorker = () => { void worker?.terminate(); };
  signal?.addEventListener("abort", abortWorker, { once: true });
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`PDF는 ${MAX_PDF_PAGES}페이지 이하만 첨부할 수 있습니다.`);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      try {
        const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").trim();
        const imageOps = new Set([
          pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject
        ]);
        const hasPageImage = operators.fnArray.some((operation) => imageOps.has(operation));
        if (!pageNeedsOcr(text, hasPageImage)) { pages.push(`[${pageNumber}페이지]\n${text}`); continue; }
        if (++ocrCount > MAX_OCR_PAGES) throw new Error(`스캔 PDF는 OCR 페이지를 ${MAX_OCR_PAGES}페이지까지 처리할 수 있습니다.`);
        onProgress?.(`PDF ${pageNumber}/${document.numPages}페이지 · ${Math.round((pageNumber - 1) / document.numPages * 100)}% · 기기 안에서 OCR로 읽는 중입니다…`);
        const viewport = page.getViewport({ scale: 1.7 });
        if (viewport.width * viewport.height > 12_000_000) throw new Error(`${pageNumber}페이지 이미지 해상도가 너무 큽니다.`);
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
        releaseOcr ??= await acquireOcrSlot(signal);
        worker ??= await createOcrWorker();
        signal?.throwIfAborted();
        const result = await worker.recognize(canvas.toBuffer("image/png"));
        const recognized = result.data.text.trim();
        const merged = text && recognized && !recognized.replace(/\s/g, "").includes(text.replace(/\s/g, ""))
          ? `[선택 가능한 텍스트]\n${text}\n\n[이미지 OCR]\n${recognized}`
          : recognized || text || "(인식된 텍스트 없음)";
        pages.push(`[${pageNumber}페이지 · 로컬 OCR]\n${merged}`);
        onProgress?.(`PDF ${pageNumber}/${document.numPages}페이지 처리 완료 · ${Math.round(pageNumber / document.numPages * 100)}%`);
      } finally { page.cleanup(); }
    }
  } finally {
    signal?.removeEventListener("abort", abortWorker);
    await worker?.terminate();
    releaseOcr?.();
    await document.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
  const result = pages.join("\n\n");
  if (result.length > MAX_EXTRACTED_CHARS) throw new Error("PDF에서 추출된 텍스트가 너무 큽니다.");
  return result;
}

export async function extractDocx(bytes: Buffer): Promise<string> {
  assertZipExpandedSize(bytes);
  const value = (await mammoth.extractRawText({ buffer: bytes })).value;
  if (value.length > MAX_EXTRACTED_CHARS) throw new Error("Word 문서에서 추출된 텍스트가 너무 큽니다.");
  return value;
}

export async function extractXlsx(bytes: Buffer): Promise<string> {
  assertZipExpandedSize(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(bytes) as never);
  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    lines.push(`[시트: ${sheet.name}]`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values as Array<unknown>;
      lines.push(cells.slice(1).map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object") return JSON.stringify(cell);
        return String(cell);
      }).join("\t"));
      if (lines.reduce((sum, line) => sum + line.length, 0) > MAX_EXTRACTED_CHARS) {
        throw new Error("Excel 문서에서 추출된 텍스트가 너무 큽니다.");
      }
    });
  });
  return lines.join("\n");
}

/** Reads ZIP central-directory sizes without expanding entries. */
export function assertZipExpandedSize(bytes: Buffer, maxBytes = 80 * 1024 * 1024, maxEntries = 5_000): void {
  let offset = 0; let total = 0; let entries = 0;
  while (offset + 46 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature !== 0x02014b50) { offset += 1; continue; }
    total += bytes.readUInt32LE(offset + 24); entries += 1;
    if (total > maxBytes || entries > maxEntries) throw new Error("압축 해제된 문서 크기가 너무 큽니다.");
    const name = bytes.readUInt16LE(offset + 28); const extra = bytes.readUInt16LE(offset + 30); const comment = bytes.readUInt16LE(offset + 32);
    offset += 46 + name + extra + comment;
  }
  if (!entries) throw new Error("문서 압축 구조가 올바르지 않습니다.");
}
