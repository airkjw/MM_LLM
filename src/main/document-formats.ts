import { inflateRawSync } from "node:zlib";

/**
 * Local text extraction for plain text, PowerPoint (.pptx) and Hancom (.hwpx) documents.
 * Self-contained on purpose: attachments and the project vault import it directly, and it never touches the
 * network, the file system or any XML parser that could resolve external entities.
 */
/** Same limit as the PDF/Word/Excel extractors in document-text.ts (kept separate so this module has no imports). */
export const MAX_EXTRACTED_CHARS = 1_000_000;
const MAX_ZIP_ENTRIES = 5_000;
const MAX_ZIP_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_READ_BYTES = 48 * 1024 * 1024;
const MAX_SMALL_PART_BYTES = 1024 * 1024;
const TEXT_SNIFF_BYTES = 64 * 1024;
const MAX_CONTROL_RATIO = 0.02;
const MAX_REPLACEMENT_RATIO = 0.01;

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const HWPX_MIME = "application/hwp+zip";
const CANONICAL_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": PPTX_MIME,
  ".hwpx": HWPX_MIME,
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv"
};
/** MIME types operating systems commonly report for the newer formats (pdf/docx/xlsx stay exact). */
const MIME_ALIASES: Record<string, string[]> = {
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/x-markdown", "text/plain"],
  ".csv": ["text/csv", "text/x-csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  ".pptx": [PPTX_MIME],
  ".hwpx": [HWPX_MIME, "application/haansofthwpx", "application/x-hwpx", "application/vnd.hancom.hwpx"]
};

export const DOCUMENT_EXTENSIONS: readonly string[] = Object.keys(CANONICAL_MIME);
export const TEXT_DOCUMENT_EXTENSIONS: readonly string[] = [".txt", ".md", ".csv"];

export function canonicalDocumentMime(extension: string): string | undefined {
  return CANONICAL_MIME[extension];
}

/** Extension plus a tolerated reported type; content checks still decide whether the file is really that format. */
export function isAcceptedDocumentMime(extension: string, declared: string): boolean {
  const canonical = CANONICAL_MIME[extension];
  if (!canonical) return false;
  const aliases = MIME_ALIASES[extension];
  if (!aliases) return declared === canonical;
  const normalized = declared.split(";")[0].trim().toLowerCase();
  return normalized === "" || aliases.includes(normalized);
}

/** Extra guidance for the legacy binary formats students most often have; they are not attachable themselves. */
export function legacyFormatHint(extension: string): string | null {
  if (extension === ".hwp") return "한글 구형식(.hwp)은 한글에서 HWPX로 저장한 뒤 첨부해 주세요.";
  if (extension === ".ppt") return "PowerPoint 구형식(.ppt)은 .pptx로 저장한 뒤 첨부해 주세요.";
  return null;
}

// ---- cheap attach-time signature checks ----------------------------------------------------------

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function controlByte(value: number): boolean {
  return value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0c && value !== 0x0d || value === 0x7f;
}

/** Decoded text: C0 controls plus the C1 range, which ICU produces for stray high bytes in CP949. */
function controlCharacter(code: number): boolean {
  return controlByte(code) || code >= 0x80 && code <= 0x9f;
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff);
}

const BINARY_TEXT_MESSAGE = "텍스트 파일이 아닌 이진 데이터가 포함되어 있습니다.";

/** Returns a Korean reason when the bytes cannot be the extension's format, or null. Full checks run at extraction. */
export function fileSignatureProblem(extension: string, bytes: Buffer): string | null {
  if (extension === ".pptx" || extension === ".hwpx") {
    if (bytes.subarray(0, 4).equals(ZIP_LOCAL_SIGNATURE)) return null;
    const pptx = extension === ".pptx";
    if (bytes.subarray(0, 8).equals(OLE_SIGNATURE)) {
      return pptx ? "PowerPoint 구형식(.ppt)이거나 암호가 설정된 문서입니다. 암호를 해제하고 .pptx로 저장해 주세요."
        : "한글 구형식(.hwp)이거나 암호·배포용 문서입니다. 보호를 해제하고 HWPX로 저장해 주세요.";
    }
    return pptx ? "실제 PowerPoint(.pptx) 문서 형식이 아닙니다." : "실제 한글(.hwpx) 문서 형식이 아닙니다.";
  }
  if (TEXT_DOCUMENT_EXTENSIONS.includes(extension)) {
    if (hasUtf16Bom(bytes)) return null;
    const sample = bytes.subarray(0, TEXT_SNIFF_BYTES);
    if (sample.includes(0)) return BINARY_TEXT_MESSAGE;
    let controls = 0;
    for (const value of sample) if (controlByte(value)) controls++;
    return sample.length && controls / sample.length > MAX_CONTROL_RATIO ? BINARY_TEXT_MESSAGE : null;
  }
  return null;
}

// ---- plain text ----------------------------------------------------------------------------------

function decodeUtf16(bytes: Buffer, bigEndian: boolean): string {
  const even = bytes.subarray(0, bytes.length - bytes.length % 2);
  return (bigEndian ? Buffer.from(even).swap16() : even).toString("utf16le");
}

function decodeTextBytes(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)); }
    catch { throw new Error("텍스트 인코딩을 인식할 수 없습니다. UTF-8·UTF-16·CP949로 저장해 주세요."); }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), false);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), true);
  if (bytes.includes(0)) throw new Error(BINARY_TEXT_MESSAGE);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { /* not UTF-8: Windows Korean text files are usually CP949 */ }
  const decoded = new TextDecoder("euc-kr").decode(bytes);
  let replacements = 0;
  for (let index = decoded.indexOf("�"); index >= 0; index = decoded.indexOf("�", index + 1)) replacements++;
  if (decoded.length && replacements / decoded.length > MAX_REPLACEMENT_RATIO) {
    throw new Error("텍스트 인코딩을 인식할 수 없습니다. UTF-8·UTF-16·CP949로 저장해 주세요.");
  }
  return decoded;
}

/** .txt/.md/.csv: UTF-8 (BOM stripped), UTF-16 with BOM, else CP949. Markdown and CSV text is kept as is. */
export function extractPlainText(bytes: Buffer): string {
  const decoded = decodeTextBytes(bytes);
  if (decoded.length > MAX_EXTRACTED_CHARS) throw new Error("텍스트 파일에서 추출된 텍스트가 너무 큽니다.");
  let controls = 0;
  for (let index = 0; index < decoded.length; index++) {
    const code = decoded.charCodeAt(index);
    if (code === 0) throw new Error(BINARY_TEXT_MESSAGE);
    if (controlCharacter(code)) controls++;
  }
  if (decoded.length && controls / decoded.length > MAX_CONTROL_RATIO) throw new Error(BINARY_TEXT_MESSAGE);
  return decoded.replace(/\r\n?/g, "\n");
}

// ---- bounded ZIP reader --------------------------------------------------------------------------

const ZIP_STRUCTURE_ERROR = "문서 압축 구조가 올바르지 않습니다.";
const ZIP_TOO_LARGE_ERROR = "압축 해제된 문서 크기가 너무 큽니다.";
const ZIP_ENCRYPTED_ERROR = "암호화된 문서는 읽을 수 없습니다. 암호를 해제한 뒤 다시 첨부해 주세요.";

type ZipEntry = { method: number; compressedSize: number; size: number; localOffset: number };

/**
 * Reads only named entries. Sizes are taken from the central directory, checked before anything is inflated and
 * enforced again while inflating (`maxOutputLength`), so a lying header or a bomb stays bounded.
 */
class SafeZip {
  private readonly bytes: Buffer;
  private readonly entries = new Map<string, ZipEntry>();
  private directoryStart = 0;
  private consumed = 0;

  constructor(bytes: Buffer) {
    this.bytes = bytes;
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset--) {
      if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) <= bytes.length) { end = offset; break; }
    }
    if (end < 0) throw new Error(ZIP_STRUCTURE_ERROR);
    const total = bytes.readUInt16LE(end + 10);
    const directorySize = bytes.readUInt32LE(end + 12);
    const directoryOffset = bytes.readUInt32LE(end + 16);
    if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error(ZIP_STRUCTURE_ERROR);
    if (total > MAX_ZIP_ENTRIES) throw new Error(ZIP_TOO_LARGE_ERROR);
    if (!total || directoryOffset + directorySize > end) throw new Error(ZIP_STRUCTURE_ERROR);
    this.directoryStart = directoryOffset;
    const directoryEnd = directoryOffset + directorySize;
    let position = directoryOffset; let declared = 0;
    for (let index = 0; index < total; index++) {
      if (position + 46 > directoryEnd || bytes.readUInt32LE(position) !== 0x02014b50) throw new Error(ZIP_STRUCTURE_ERROR);
      const flags = bytes.readUInt16LE(position + 8);
      const nameLength = bytes.readUInt16LE(position + 28);
      const next = position + 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
      if (next > directoryEnd) throw new Error(ZIP_STRUCTURE_ERROR);
      if (flags & 0x41) throw new Error(ZIP_ENCRYPTED_ERROR);
      const compressedSize = bytes.readUInt32LE(position + 20);
      const size = bytes.readUInt32LE(position + 24);
      const localOffset = bytes.readUInt32LE(position + 42);
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error(ZIP_STRUCTURE_ERROR);
      declared += size;
      if (declared > MAX_ZIP_TOTAL_BYTES) throw new Error(ZIP_TOO_LARGE_ERROR);
      const name = bytes.toString("utf8", position + 46, position + 46 + nameLength);
      if (this.entries.has(name)) throw new Error(ZIP_STRUCTURE_ERROR);
      this.entries.set(name, { method: bytes.readUInt16LE(position + 10), compressedSize, size, localOffset });
      position = next;
    }
  }

  names(): string[] { return [...this.entries.keys()]; }
  has(name: string): boolean { return this.entries.has(name); }

  read(name: string, maxBytes = MAX_ZIP_ENTRY_BYTES): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.size > maxBytes || this.consumed + entry.size > MAX_ZIP_READ_BYTES) throw new Error(ZIP_TOO_LARGE_ERROR);
    const { bytes } = this; const local = entry.localOffset;
    if (local + 30 > this.directoryStart || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error(ZIP_STRUCTURE_ERROR);
    if (bytes.readUInt16LE(local + 6) & 0x41) throw new Error(ZIP_ENCRYPTED_ERROR);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const end = start + entry.compressedSize;
    if (end > this.directoryStart) throw new Error(ZIP_STRUCTURE_ERROR);
    let output: Buffer;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) throw new Error(ZIP_STRUCTURE_ERROR);
      output = Buffer.from(bytes.subarray(start, end));
    } else if (entry.method === 8) {
      if (!entry.size) return Buffer.alloc(0);
      try { output = inflateRawSync(bytes.subarray(start, end), { maxOutputLength: entry.size }); }
      catch { throw new Error(ZIP_STRUCTURE_ERROR); }
      if (output.length !== entry.size) throw new Error(ZIP_STRUCTURE_ERROR);
    } else {
      throw new Error(ZIP_STRUCTURE_ERROR);
    }
    this.consumed += output.length;
    return output;
  }

  /** XML part as text; DTDs and entity declarations are never accepted. */
  xml(name: string, maxBytes = MAX_ZIP_ENTRY_BYTES): string | null {
    const raw = this.read(name, maxBytes);
    if (!raw) return null;
    const text = hasUtf16Bom(raw)
      ? decodeUtf16(raw.subarray(2), raw[0] === 0xfe)
      : new TextDecoder("utf-8").decode(raw);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("문서에 지원되지 않는 XML 선언(DOCTYPE·ENTITY)이 있어 읽을 수 없습니다.");
    return text;
  }
}

// ---- linear XML scanning (no parser, no regex over document text, no entity expansion) ----------
//
// Every character of a part is visited a bounded number of times: tags are located with `indexOf` and the
// scan only ever moves forward. A construct that is not closed ends the part with MALFORMED_XML instead of
// being re-scanned from every earlier position.

const MALFORMED_XML = "문서 XML 구조가 올바르지 않습니다.";
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function validXmlCodePoint(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20 && code <= 0xd7ff ||
    code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}

/** Only the five predefined entities and numeric references; `&amp;lt;` becomes `&lt;`, not `<`. */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g,
    (_match, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (named) return NAMED_ENTITIES[named];
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal!, 10);
      return validXmlCodePoint(code) ? String.fromCodePoint(code) : "\ufffd";
    });
}

type XmlTag = {
  name: string; closing: boolean; selfClosing: boolean;
  /** Offset of `<` and the offset just after `>`. */
  start: number; end: number;
  nameEnd: number;
};

const isBlank = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const QUOTE_DOUBLE = 0x22; const QUOTE_SINGLE = 0x27; const SLASH = 0x2f; const GT = 0x3e; const LT = 0x3c;

/** Parses the tag that starts exactly at `start` (which must be a `<`). */
function tagAt(xml: string, start: number): XmlTag {
  let index = start + 1; let quote = 0;
  for (; index < xml.length; index++) {
    const code = xml.charCodeAt(index);
    if (quote) { if (code === quote) quote = 0; continue; }
    if (code === QUOTE_DOUBLE || code === QUOTE_SINGLE) quote = code;
    else if (code === GT) break;
    else if (code === LT) throw new Error(MALFORMED_XML);
  }
  if (index >= xml.length) throw new Error(MALFORMED_XML);
  const closing = xml.charCodeAt(start + 1) === SLASH;
  let nameStart = start + 1 + (closing ? 1 : 0); let nameEnd = nameStart;
  while (nameEnd < index) {
    const code = xml.charCodeAt(nameEnd);
    if (isBlank(code) || code === SLASH) break;
    nameEnd++;
  }
  return { name: xml.slice(nameStart, nameEnd), closing, selfClosing: !closing && xml.charCodeAt(index - 1) === SLASH,
    start, end: index + 1, nameEnd };
}

/** Next element tag at or after `from`; comments, processing instructions and CDATA between elements are skipped. */
function nextTag(xml: string, from: number): XmlTag | null {
  let start = xml.indexOf("<", from);
  while (start >= 0) {
    let skipTo = -1;
    if (xml.startsWith("<!--", start)) skipTo = xml.indexOf("-->", start + 4) + 3;
    else if (xml.startsWith("<![CDATA[", start)) skipTo = xml.indexOf("]]>", start + 9) + 3;
    else if (xml.startsWith("<?", start)) skipTo = xml.indexOf("?>", start + 2) + 2;
    else if (xml.startsWith("<!", start)) skipTo = xml.indexOf(">", start + 2) + 1;
    else return tagAt(xml, start);
    if (skipTo <= 2) throw new Error(MALFORMED_XML);
    start = xml.indexOf("<", skipTo);
  }
  return null;
}

/** Attribute values of one tag, parsed in a single left-to-right pass. */
function attributes(xml: string, tag: XmlTag): Map<string, string> {
  const result = new Map<string, string>();
  const end = tag.end - 1; let index = tag.nameEnd;
  while (index < end) {
    while (index < end && (isBlank(xml.charCodeAt(index)) || xml.charCodeAt(index) === SLASH)) index++;
    const nameStart = index;
    while (index < end) {
      const code = xml.charCodeAt(index);
      if (code === 0x3d || isBlank(code) || code === SLASH) break;
      index++;
    }
    const name = xml.slice(nameStart, index);
    while (index < end && isBlank(xml.charCodeAt(index))) index++;
    if (xml.charCodeAt(index) !== 0x3d) continue;
    index++;
    while (index < end && isBlank(xml.charCodeAt(index))) index++;
    const quote = xml.charCodeAt(index);
    if (quote !== QUOTE_DOUBLE && quote !== QUOTE_SINGLE) break;
    const close = xml.indexOf(String.fromCharCode(quote), index + 1);
    if (close < 0 || close >= end) break;
    if (name) result.set(name, decodeEntities(xml.slice(index + 1, close)));
    index = close + 1;
  }
  return result;
}

/** Content and resume offset of a text element whose opening tag was just read; the closing tag is looked up once. */
function elementContent(xml: string, tag: XmlTag): { content: string; next: number } {
  const prefix = `</${tag.name}`; let search = tag.end;
  for (;;) {
    const at = xml.indexOf(prefix, search);
    if (at < 0) throw new Error(MALFORMED_XML);
    const after = xml.charCodeAt(at + prefix.length);
    if (after === GT || isBlank(after)) {
      const close = xml.indexOf(">", at);
      if (close < 0) throw new Error(MALFORMED_XML);
      return { content: xml.slice(tag.end, at), next: close + 1 };
    }
    search = at + prefix.length;
  }
}

/** Character data of a text element: CDATA kept raw, inline tab/line-break tags honoured, other tags dropped. */
function elementText(raw: string): string {
  let output = ""; let index = 0;
  for (;;) {
    const lt = raw.indexOf("<", index);
    if (lt < 0) return output + decodeEntities(raw.slice(index));
    output += decodeEntities(raw.slice(index, lt));
    if (raw.startsWith("<![CDATA[", lt)) {
      const close = raw.indexOf("]]>", lt + 9);
      if (close < 0) throw new Error(MALFORMED_XML);
      output += raw.slice(lt + 9, close); index = close + 3; continue;
    }
    if (raw.startsWith("<!--", lt) || raw.startsWith("<?", lt)) {
      const terminator = raw.startsWith("<!--", lt) ? "-->" : "?>";
      const close = raw.indexOf(terminator, lt + 2);
      if (close < 0) throw new Error(MALFORMED_XML);
      index = close + terminator.length; continue;
    }
    const tag = tagAt(raw, lt);
    if (!tag.closing) {
      if (tag.name === "hp:tab") output += "\t";
      else if (tag.name === "hp:lineBreak") output += "\n";
      else if (tag.name === "hp:nbSpace" || tag.name === "hp:fwSpace") output += " ";
    }
    index = tag.end;
  }
}

/** Package-relative part name; only ever used as a key into the archive's own entry table. */
function resolvePart(baseDirectory: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${baseDirectory}${target}`).split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop(); else output.push(part);
  }
  return output.join("/");
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

class TextBudget {
  private used = 0;
  private readonly message: string;
  constructor(message: string) { this.message = message; }
  add(length: number): void {
    this.used += length + 1;
    if (this.used > MAX_EXTRACTED_CHARS) throw new Error(this.message);
  }
}

/** Calls `visit` for every opening/self-closing tag whose name is listed; closing tags are ignored. */
function eachTag(xml: string, names: ReadonlySet<string>, visit: (tag: XmlTag, values: () => Map<string, string>) => void): void {
  for (let tag = nextTag(xml, 0); tag; tag = nextTag(xml, tag.end)) {
    if (tag.closing || !names.has(tag.name)) continue;
    const current = tag;
    visit(current, () => attributes(xml, current));
  }
}

function relationships(zip: SafeZip, name: string): Array<{ id: string; type: string; target: string }> {
  const xml = zip.xml(name, MAX_SMALL_PART_BYTES);
  const found: Array<{ id: string; type: string; target: string }> = [];
  if (!xml) return found;
  eachTag(xml, new Set(["Relationship"]), (_tag, values) => {
    const { Id: id, Type: type, Target: target } = Object.fromEntries(values());
    if (id !== undefined && type !== undefined && target !== undefined) found.push({ id, type, target });
  });
  return found;
}

// ---- pptx ----------------------------------------------------------------------------------------

const PPTX_TOO_LARGE = "PowerPoint 문서에서 추출된 텍스트가 너무 큽니다.";

function drawingParagraphs(xml: string, budget: TextBudget): string[] {
  const lines: string[] = []; let current: string | null = null;
  const flush = () => {
    if (current !== null && current.trim()) { budget.add(current.length); lines.push(current); }
    current = null;
  };
  let position = 0;
  for (let tag = nextTag(xml, position); tag; tag = nextTag(xml, position)) {
    position = tag.end;
    if (tag.name === "a:p") { flush(); if (!tag.closing && !tag.selfClosing) current = ""; continue; }
    if (tag.closing) continue;
    if (tag.name === "a:br") current = (current ?? "") + "\n";
    else if (tag.name === "a:t" && !tag.selfClosing) {
      const { content, next } = elementContent(xml, tag);
      current = (current ?? "") + elementText(content); position = next;
    }
  }
  flush();
  return lines;
}

function orderedSlides(zip: SafeZip): string[] {
  const numeric = zip.names().flatMap((name) => {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    return match ? [{ name, number: Number(match[1]) }] : [];
  }).sort((a, b) => a.number - b.number).map((item) => item.name);
  const presentation = zip.xml("ppt/presentation.xml", MAX_SMALL_PART_BYTES);
  if (!presentation) return numeric;
  const targets = new Map(relationships(zip, "ppt/_rels/presentation.xml.rels").map((item) => [item.id, item.target]));
  const seen = new Set<string>(); const ordered: string[] = [];
  eachTag(presentation, new Set(["p:sldId"]), (_tag, values) => {
    const id = values().get("r:id"); const target = id === undefined ? undefined : targets.get(id);
    const name = target === undefined ? undefined : resolvePart("ppt/", target);
    if (name && zip.has(name) && !seen.has(name)) { seen.add(name); ordered.push(name); }
  });
  return ordered.length ? ordered : numeric;
}

const IGNORED_NOTE_PLACEHOLDERS = new Set(["sldNum", "sldImg", "hdr", "ftr", "dt"]);

/** Paragraphs of the speaker-notes body shapes of one notes page. */
function notesParagraphs(xml: string, budget: TextBudget): string[] {
  const shapes: Array<{ text: string; placeholder: string | undefined }> = [];
  let shapeStart = -1; let placeholder: string | undefined;
  for (let tag = nextTag(xml, 0); tag; tag = nextTag(xml, tag.end)) {
    if (tag.name === "p:sp" && !tag.closing && !tag.selfClosing) { shapeStart = tag.start; placeholder = undefined; }
    else if (tag.name === "p:ph" && !tag.closing && shapeStart >= 0) placeholder = attributes(xml, tag).get("type") ?? "";
    else if (tag.name === "p:sp" && tag.closing && shapeStart >= 0) {
      shapes.push({ text: xml.slice(shapeStart, tag.end), placeholder }); shapeStart = -1;
    }
  }
  const body = shapes.filter((shape) => shape.placeholder === "body");
  const chosen = body.length ? body
    : shapes.filter((shape) => shape.placeholder === undefined || !IGNORED_NOTE_PLACEHOLDERS.has(shape.placeholder));
  const lines: string[] = [];
  for (const shape of chosen) for (const line of drawingParagraphs(shape.text, budget)) lines.push(line);
  return lines;
}

function slideNotes(zip: SafeZip, slide: string, budget: TextBudget): string[] {
  const directory = slide.slice(0, slide.lastIndexOf("/") + 1); const file = slide.slice(directory.length);
  const relsName = `${directory}_rels/${file}.rels`;
  let notesName: string | undefined;
  if (zip.has(relsName)) {
    const notes = relationships(zip, relsName).find((item) => item.type.endsWith("/notesSlide"));
    if (notes) notesName = resolvePart(directory, notes.target);
  } else {
    const number = /slide(\d+)\.xml$/.exec(slide)?.[1];
    if (number) notesName = `ppt/notesSlides/notesSlide${number}.xml`;
  }
  const xml = notesName ? zip.xml(notesName) : null;
  return xml ? notesParagraphs(xml, budget) : [];
}

export async function extractPptx(bytes: Buffer): Promise<string> {
  const zip = new SafeZip(bytes);
  const types = zip.xml("[Content_Types].xml", MAX_SMALL_PART_BYTES);
  if (!types || !types.includes("presentationml")) throw new Error("PowerPoint 문서 형식이 아닙니다.");
  const slides = orderedSlides(zip);
  if (!slides.length) throw new Error("PowerPoint 문서에서 슬라이드를 찾을 수 없습니다.");
  const budget = new TextBudget(PPTX_TOO_LARGE); const blocks: string[] = [];
  for (const [index, slide] of slides.entries()) {
    await yieldToEventLoop();
    const label = index + 1;
    const lines = drawingParagraphs(zip.xml(slide) ?? "", budget);
    const notes = slideNotes(zip, slide, budget);
    if (lines.length) { budget.add(`[슬라이드 ${label}]`.length); blocks.push(`[슬라이드 ${label}]\n${lines.join("\n")}`); }
    if (notes.length) {
      budget.add(`[슬라이드 ${label} 발표자 노트]`.length);
      blocks.push(`[슬라이드 ${label} 발표자 노트]\n${notes.join("\n")}`);
    }
  }
  return blocks.join("\n\n");
}

// ---- hwpx ----------------------------------------------------------------------------------------

const HWPX_PROTECTED = "암호화되었거나 배포용으로 보호된 한글 문서는 읽을 수 없습니다. 보호를 해제한 HWPX로 저장해 주세요.";

/** Paragraph text per hp:p; paragraphs nested in tables or text boxes become their own lines in reading order. */
function hwpxParagraphs(xml: string, budget: TextBudget): { lines: string[]; sawParagraph: boolean } {
  const lines: string[] = []; const open: string[] = []; let sawParagraph = false;
  const emit = (text: string) => { if (text.trim()) { budget.add(text.length); lines.push(text); } };
  let position = 0;
  for (let tag = nextTag(xml, position); tag; tag = nextTag(xml, position)) {
    position = tag.end;
    if (tag.name === "hp:p") {
      if (tag.closing) { if (open.length) emit(open.pop()!); continue; }
      sawParagraph = true;
      if (tag.selfClosing) continue;
      if (open.length) { emit(open[open.length - 1]); open[open.length - 1] = ""; }
      open.push("");
    } else if (tag.name === "hp:t" && !tag.closing && !tag.selfClosing) {
      const { content, next } = elementContent(xml, tag);
      const text = elementText(content); position = next;
      if (open.length) open[open.length - 1] += text; else emit(text);
    }
  }
  while (open.length) emit(open.pop()!);
  return { lines, sawParagraph };
}

function orderedSections(zip: SafeZip): string[] {
  const numeric = zip.names().flatMap((name) => {
    const match = /^Contents\/section(\d+)\.xml$/.exec(name);
    return match ? [{ name, number: Number(match[1]) }] : [];
  }).sort((a, b) => a.number - b.number).map((item) => item.name);
  const manifest = zip.xml("Contents/content.hpf", MAX_SMALL_PART_BYTES);
  if (!manifest) return numeric;
  const known = new Set(numeric);
  const hrefs = new Map<string, string>(); const itemrefs: string[] = [];
  eachTag(manifest, new Set(["opf:item", "opf:itemref"]), (tag, values) => {
    const found = values();
    if (tag.name === "opf:item") {
      const id = found.get("id"); const href = found.get("href");
      if (id !== undefined && href !== undefined) hrefs.set(id, href);
    } else {
      const id = found.get("idref"); if (id !== undefined) itemrefs.push(id);
    }
  });
  const seen = new Set<string>(); const ordered: string[] = [];
  for (const id of itemrefs) {
    const href = hrefs.get(id);
    if (href === undefined) continue;
    const name = [resolvePart("", href), resolvePart("Contents/", href)].find((candidate) => known.has(candidate));
    if (name && !seen.has(name)) { seen.add(name); ordered.push(name); }
  }
  // A spine that omits sections must not silently drop body text: append any section it did not list.
  return ordered.length ? [...ordered, ...numeric.filter((name) => !seen.has(name))] : numeric;
}

export async function extractHwpx(bytes: Buffer): Promise<string> {
  const zip = new SafeZip(bytes);
  const mimetype = zip.read("mimetype", 256);
  if (!mimetype || mimetype.toString("utf8").trim() !== HWPX_MIME) throw new Error("한글(HWPX) 문서 형식이 아닙니다.");
  const manifest = zip.xml("META-INF/manifest.xml", MAX_SMALL_PART_BYTES);
  if (manifest && /encryption-?data/i.test(manifest)) throw new Error(HWPX_PROTECTED);
  const sections = orderedSections(zip);
  if (!sections.length) throw new Error("한글 문서에서 본문 구역을 찾을 수 없습니다.");
  const budget = new TextBudget("한글(HWPX) 문서에서 추출된 텍스트가 너무 큽니다.");
  const lines: string[] = []; let sawParagraph = false;
  for (const section of sections) {
    await yieldToEventLoop();
    const parsed = hwpxParagraphs(zip.xml(section) ?? "", budget);
    sawParagraph ||= parsed.sawParagraph;
    for (const line of parsed.lines) lines.push(line);
  }
  if (!sawParagraph) throw new Error(HWPX_PROTECTED);
  return lines.join("\n");
}
