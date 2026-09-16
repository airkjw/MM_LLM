import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { acquireOcrSlot, assertZipExpandedSize, extractDocx, extractPdf, extractXlsx, pageNeedsOcr } from "../src/main/document-text.ts";

test("an Excel attachment keeps sheet names and cell values", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("병원 지표");
  sheet.addRow(["월", "외래 수", "매출"]);
  sheet.addRow(["9월", 214, 12700000]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const text = await extractXlsx(bytes);
  assert.match(text, /\[시트: 병원 지표\]/);
  assert.match(text, /월\t외래 수\t매출/);
  assert.match(text, /9월\t214\t12700000/);
});

test("a Word attachment yields the paragraph text", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>병원 운영 분석</w:t></w:r></w:p></w:body></w:document>`);
  const text = await extractDocx(await zip.generateAsync({ type: "nodebuffer" }));
  assert.match(text, /병원 운영 분석/);
});

function smallPdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const stream = `BT /F1 18 Tf 30 200 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("a PDF attachment yields selectable text", async () => {
  assert.match(await extractPdf(smallPdf("Medical MBA")), /Medical MBA/);
});

function scannedPdf(text) {
  const canvas = createCanvas(1000, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1000, 240);
  context.fillStyle = "black";
  context.font = "64px sans-serif";
  context.fillText(text, 45, 145);
  const image = canvas.toBuffer("image/jpeg");
  const content = Buffer.from("q 1000 0 0 240 0 0 cm /Im0 Do Q");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 240] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")])
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "binary")];
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), objects[index], Buffer.from("\nendobj\n"));
  }
  const xref = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const offset of offsets.slice(1)) chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

function mixedPdf() {
  const canvas = createCanvas(1000, 240); const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 1000, 240);
  context.fillStyle = "black"; context.font = "64px sans-serif"; context.fillText("SCANNED PAGE OCR", 45, 145);
  const image = canvas.toBuffer("image/jpeg");
  const textStream = Buffer.from("BT /F1 18 Tf 30 200 Td (Selectable Medical MBA) Tj ET");
  const imageStream = Buffer.from("q 1000 0 0 240 0 0 cm /Im0 Do Q");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Length ${textStream.length} >>\nstream\n`), textStream, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 240] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Length ${imageStream.length} >>\nstream\n`), imageStream, Buffer.from("\nendstream")])
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "binary")]; const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), objects[index], Buffer.from("\nendobj\n"));
  }
  const xref = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const offset of offsets.slice(1)) chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test("a mixed PDF keeps selectable text and OCRs only its scanned page", { timeout: 30_000 }, async () => {
  const text = await extractPdf(mixedPdf());
  assert.match(text, /Selectable Medical MBA/); assert.match(text, /SCANNED\s+PAGE\s+OCR/i);
  assert.match(text, /2페이지 · 로컬 OCR/); assert.doesNotMatch(text, /1페이지 · 로컬 OCR/);
});

test("page numbers and short watermark-only layers still trigger OCR", () => {
  assert.equal(pageNeedsOcr("12"), true);
  assert.equal(pageNeedsOcr("Page 12 · CONFIDENTIAL"), true);
  assert.equal(pageNeedsOcr("병원 보고서", true), true);
  assert.equal(pageNeedsOcr("이 페이지에는 충분한 본문 텍스트가 들어 있어 OCR이 필요하지 않습니다. 의료경영 자료입니다."), false);
});

test("an aborted OCR waiter is removed and cannot block the next turn", async () => {
  const releaseFirst = await acquireOcrSlot();
  const controller = new AbortController();
  const cancelled = acquireOcrSlot(controller.signal);
  const third = acquireOcrSlot();
  controller.abort(new Error("queue cancelled"));
  await assert.rejects(cancelled, /queue cancelled/);
  releaseFirst();
  const releaseThird = await Promise.race([
    third,
    new Promise((_, reject) => setTimeout(() => reject(new Error("third waiter blocked")), 500))
  ]);
  releaseThird();
});

test("PDF extraction respects a caller cancellation before work starts", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(extractPdf(smallPdf("cancel"), undefined, controller.signal), /cancelled/);
});

test("Office ZIP expansion limits reject suspicious archives before extraction", () => {
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(90 * 1024 * 1024, 24);
  assert.throws(() => assertZipExpandedSize(central), /압축 해제된 문서 크기/);
});
