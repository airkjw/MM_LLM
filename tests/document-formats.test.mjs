import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  DOCUMENT_EXTENSIONS, MAX_EXTRACTED_CHARS, canonicalDocumentMime, extractHwpx, extractPlainText, extractPptx,
  fileSignatureProblem, isAcceptedDocumentMime
} from "../src/main/document-formats.ts";

// Every fixture is built in memory from synthetic text; no binary fixture files and no real documents.
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PPTX_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`;
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const esc = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slideXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS_A}><p:cSld><p:spTree><p:sp><p:txBody>${
  paragraphs.map((text) => `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="ko-KR"/><a:t>${esc(text)}</a:t></a:r></a:p>`).join("")
}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const notesXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS_A}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${
  paragraphs.map((text) => `<a:p><a:r><a:t>${esc(text)}</a:t></a:r></a:p>`).join("")
}</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="10"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld type="slidenum"><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

/** slides: [{ file: 2, paragraphs: [...], notes?: [...] }] listed in the given presentation order. */
async function buildPptx(slides, { presentationOrder = true, types = PPTX_TYPES, extra = {} } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", types);
  if (presentationOrder) {
    zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${NS_A}><p:sldIdLst>${
      slides.map((slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 10}"/>`).join("")}</p:sldIdLst></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">${
      slides.map((slide, index) => `<Relationship Id="rId${index + 10}" Type="${REL_TYPE}/slide" Target="slides/slide${slide.file}.xml"/>`).join("")
    }</Relationships>`);
  }
  for (const slide of slides) {
    zip.file(`ppt/slides/slide${slide.file}.xml`, slideXml(slide.paragraphs));
    if (slide.notes) {
      zip.file(`ppt/notesSlides/notesSlide${slide.file}.xml`, notesXml(slide.notes));
      zip.file(`ppt/slides/_rels/slide${slide.file}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${REL_TYPE}/notesSlide" Target="../notesSlides/notesSlide${slide.file}.xml"/></Relationships>`);
    }
  }
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const HP_NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
const hpP = (text) => `<hp:p id="0" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
const sectionXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${HP_NS}>${body}</hs:sec>`;
async function buildHwpx(sections, { spine = null, mimetype = "application/hwp+zip", extra = {} } = {}) {
  const zip = new JSZip();
  if (mimetype !== null) zip.file("mimetype", mimetype, { compression: "STORE" });
  sections.forEach((body, index) => zip.file(`Contents/section${index}.xml`, sectionXml(body)));
  if (spine) {
    zip.file("Contents/content.hpf", `<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${
      sections.map((_, index) => `<opf:item id="sec${index}" href="Contents/section${index}.xml" media-type="application/xml"/>`).join("")
    }</opf:manifest><opf:spine>${spine.map((index) => `<opf:itemref idref="sec${index}"/>`).join("")}</opf:spine></opf:package>`);
  }
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Marks every central-directory record as encrypted (general purpose flag bit 0). */
function markEncrypted(bytes) {
  const copy = Buffer.from(bytes);
  for (let offset = 0; offset + 46 <= copy.length; offset++) {
    if (copy.readUInt32LE(offset) !== 0x02014b50) continue;
    copy.writeUInt16LE(copy.readUInt16LE(offset + 8) | 1, offset + 8);
  }
  return copy;
}
/** Rewrites the declared uncompressed size of every central-directory record. */
function declareSize(bytes, size) {
  const copy = Buffer.from(bytes);
  for (let offset = 0; offset + 46 <= copy.length; offset++) {
    if (copy.readUInt32LE(offset) !== 0x02014b50) continue;
    copy.writeUInt32LE(size, offset + 24);
  }
  return copy;
}

// ---- plain text -----------------------------------------------------------------------------

test("text files decode UTF-8 and strip a BOM", () => {
  assert.equal(extractPlainText(Buffer.from("병원 경영 분석\nsecond line", "utf8")), "병원 경영 분석\nsecond line");
  assert.equal(extractPlainText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("의료 정책", "utf8")])), "의료 정책");
});

test("text files decode UTF-16 little and big endian with a BOM", () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("외래 환자 수 214명", "utf16le")]);
  assert.equal(extractPlainText(le), "외래 환자 수 214명");
  const be = Buffer.from(Buffer.from("외래 환자 수 214명", "utf16le")).swap16();
  assert.equal(extractPlainText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), "외래 환자 수 214명");
});

test("text files that are not UTF-8 are decoded as CP949", () => {
  const cp949 = Buffer.from([0xba, 0xb4, 0xbf, 0xf8, 0x20, 0xb0, 0xe6, 0xbf, 0xb5, 0x20, 0xba, 0xd0, 0xbc, 0xae, 0x3a, 0x20,
    0xbf, 0xdc, 0xb7, 0xa1, 0x20, 0xc8, 0xaf, 0xc0, 0xda, 0x20, 0xbc, 0xf6, 0x20, 0x32, 0x31, 0x34, 0xb8, 0xed]);
  assert.equal(extractPlainText(cp949), "병원 경영 분석: 외래 환자 수 214명");
});

test("markdown and csv keep their structure and line endings are normalised", () => {
  const markdown = "# 제목\n\n- 항목 1\n- 항목 **2**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  assert.equal(extractPlainText(Buffer.from(markdown)), markdown);
  assert.equal(extractPlainText(Buffer.from("월,외래 수\r\n9월,214\r\n")), "월,외래 수\n9월,214\n");
});

test("binary content in a text file is rejected with a Korean message", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), Buffer.alloc(64, 7)]);
  assert.throws(() => extractPlainText(png), /텍스트 파일이 아닌 이진 데이터/);
  assert.throws(() => extractPlainText(Buffer.from("abc\0def")), /텍스트 파일이 아닌 이진 데이터/);
  const controls = Buffer.alloc(400); for (let i = 0; i < controls.length; i++) controls[i] = i % 3 === 0 ? 0x41 : 0x01;
  assert.throws(() => extractPlainText(controls), /텍스트 파일이 아닌 이진 데이터/);
});

test("extracted text over the shared limit is refused", () => {
  assert.equal(MAX_EXTRACTED_CHARS, 1_000_000);
  assert.equal(extractPlainText(Buffer.from("가".repeat(MAX_EXTRACTED_CHARS))).length, MAX_EXTRACTED_CHARS);
  assert.throws(() => extractPlainText(Buffer.from("가".repeat(MAX_EXTRACTED_CHARS + 1))), /너무 큽니다/);
});

// ---- pptx -----------------------------------------------------------------------------------

test("pptx text follows presentation order with slide labels and speaker notes", async () => {
  const bytes = await buildPptx([
    { file: 2, paragraphs: ["병원 경영 개요", "매출 & 비용 <요약>"], notes: ["발표자 메모 하나", "메모 둘"] },
    { file: 1, paragraphs: ["두 번째로 보이는 슬라이드"] }
  ]);
  const text = await extractPptx(bytes);
  assert.ok(text.indexOf("[슬라이드 1]") < text.indexOf("병원 경영 개요"));
  assert.ok(text.indexOf("병원 경영 개요") < text.indexOf("[슬라이드 2]"));
  assert.ok(text.indexOf("[슬라이드 2]") < text.indexOf("두 번째로 보이는 슬라이드"));
  assert.match(text, /매출 & 비용 <요약>/);
  assert.match(text, /발표자 메모 하나\n메모 둘/);
  assert.ok(text.indexOf("병원 경영 개요") < text.indexOf("발표자 메모 하나"), "notes follow the slide text");
  assert.ok(text.indexOf("발표자 메모 하나") < text.indexOf("[슬라이드 2]"));
  assert.doesNotMatch(text, /\n7\n|^7$/m, "the slide-number placeholder of the notes page is not text");
});

test("pptx without presentation.xml falls back to numeric slide order", async () => {
  const bytes = await buildPptx([
    { file: 10, paragraphs: ["열 번째"] }, { file: 2, paragraphs: ["두 번째"] }, { file: 1, paragraphs: ["첫 번째"] }
  ], { presentationOrder: false });
  const text = await extractPptx(bytes);
  assert.ok(text.indexOf("첫 번째") < text.indexOf("두 번째") && text.indexOf("두 번째") < text.indexOf("열 번째"));
});

test("a Word document renamed to .pptx is rejected without leaking its text", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>SECRET-BODY-TEXT</w:t></w:r></w:p></w:body></w:document>`);
  await assert.rejects(extractPptx(await zip.generateAsync({ type: "nodebuffer" })), (error) =>
    /PowerPoint 문서 형식이 아닙니다/.test(error.message) && !error.message.includes("SECRET-BODY-TEXT"));
});

test("pptx with no readable slides or random bytes fails clearly", async () => {
  const empty = new JSZip(); empty.file("[Content_Types].xml", PPTX_TYPES);
  await assert.rejects(extractPptx(await empty.generateAsync({ type: "nodebuffer" })), /슬라이드/);
  await assert.rejects(extractPptx(Buffer.from("PK\u0003\u0004 not really a zip at all".padEnd(200, "x"))), /압축 구조가 올바르지 않습니다/);
});

// ---- hwpx -----------------------------------------------------------------------------------

test("hwpx text follows the content.hpf spine and keeps inline tabs and line breaks", async () => {
  const bytes = await buildHwpx([
    hpP("셋째 구역이 아니라 첫 구역 파일") + hpP("A & B"),
    `<hp:p id="1"><hp:run><hp:t>탭<hp:tab width="4000" leader="0" type="1"/>사이</hp:t><hp:t>줄<hp:lineBreak/>바꿈</hp:t></hp:run></hp:p>`
  ], { spine: [1, 0] });
  const text = await extractHwpx(bytes);
  assert.ok(text.indexOf("탭\t사이") < text.indexOf("셋째 구역"), "spine order wins over file numbering");
  assert.match(text, /줄\n바꿈/);
  assert.match(text, /A & B/);
});

test("hwpx without a spine uses numeric section order and reads table cell paragraphs", async () => {
  const bytes = await buildHwpx([hpP("구역 10 대신 먼저"), hpP("두 번째 구역")]);
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 2; index < 11; index++) zip.file(`Contents/section${index}.xml`, sectionXml(hpP(`구역-${index}`)));
  zip.file("Contents/section0.xml", sectionXml(`<hp:p id="9"><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList>${hpP("셀 하나")}${hpP("셀 둘")}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>${hpP("표 뒤 문단")}`));
  const text = await extractHwpx(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const order = ["셀 하나", "셀 둘", "표 뒤 문단", "두 번째 구역", "구역-2", "구역-10"].map((needle) => text.indexOf(needle));
  assert.ok(order.every((position) => position >= 0), text);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("a random zip or a wrong mimetype is rejected as hwpx", async () => {
  const random = new JSZip(); random.file("hello.txt", "SECRET-HWPX-TEXT");
  await assert.rejects(extractHwpx(await random.generateAsync({ type: "nodebuffer" })), (error) =>
    /한글\(HWPX\) 문서 형식이 아닙니다/.test(error.message) && !error.message.includes("SECRET"));
  await assert.rejects(extractHwpx(await buildHwpx([hpP("본문")], { mimetype: "application/vnd.oasis.opendocument.text" })),
    /한글\(HWPX\) 문서 형식이 아닙니다/);
});

test("encrypted or distribution hwpx documents give a clear Korean error", async () => {
  const encrypted = await buildHwpx([hpP("본문")], { extra: {
    "META-INF/manifest.xml": `<?xml version="1.0"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><odf:file-entry odf:full-path="Contents/section0.xml"><odf:encryption-data odf:checksum-type="SHA1"/></odf:file-entry></odf:manifest>` } });
  await assert.rejects(extractHwpx(encrypted), /암호화되었거나 배포용으로 보호된 한글 문서/);
  const opaque = new JSZip();
  opaque.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  opaque.file("Contents/section0.xml", Buffer.from([0x8b, 0x1f, 0x00, 0x42, 0x99, 0x77, 0x01, 0x02]));
  await assert.rejects(extractHwpx(await opaque.generateAsync({ type: "nodebuffer" })), /암호화되었거나 배포용으로 보호된 한글 문서/);
});

// ---- ZIP / XML safety -----------------------------------------------------------------------

for (const [label, declaration] of [["DOCTYPE", `<!DOCTYPE foo [ <!ENTITY xxe "SECRET-EXPANSION"> ]>`], ["ENTITY", `<!ENTITY xxe "SECRET-EXPANSION">`]]) {
  test(`pptx and hwpx reject ${label} declarations without expanding or leaking them`, async () => {
    const pptx = await buildPptx([{ file: 1, paragraphs: ["본문"] }], { extra: {
      "ppt/slides/slide1.xml": `<?xml version="1.0"?>${declaration}<p:sld ${NS_A}><a:p><a:r><a:t>&xxe;</a:t></a:r></a:p></p:sld>` } });
    const hwpx = await buildHwpx([hpP("본문")], { extra: {
      "Contents/section0.xml": `<?xml version="1.0"?>${declaration}<hs:sec ${HP_NS}><hp:p><hp:t>&xxe;</hp:t></hp:p></hs:sec>` } });
    for (const run of [extractPptx(pptx), extractHwpx(hwpx)]) {
      await assert.rejects(run, (error) => /DOCTYPE|ENTITY/.test(error.message) && !error.message.includes("SECRET"));
    }
  });
}

test("only the five predefined and numeric references are decoded; unknown entities stay literal", async () => {
  const bytes = await buildPptx([{ file: 1, paragraphs: [] }], { extra: {
    "ppt/slides/slide1.xml": `<?xml version="1.0"?><p:sld ${NS_A}><a:p><a:r><a:t>&lt;&gt;&amp;&quot;&apos; &#65;&#x42; &custom; &amp;lt;</a:t></a:r></a:p></p:sld>` } });
  assert.match(await extractPptx(bytes), /<>&"' AB &custom; &lt;/);
});

test("encrypted zip entries are rejected", async () => {
  await assert.rejects(extractPptx(markEncrypted(await buildPptx([{ file: 1, paragraphs: ["본문"] }]))), /암호화된 문서/);
  await assert.rejects(extractHwpx(markEncrypted(await buildHwpx([hpP("본문")]))), /암호화된 문서/);
});

test("zip bombs are rejected by declared size, by lying headers and by entry count, quickly", async () => {
  const started = Date.now();
  const honest = await buildPptx([{ file: 1, paragraphs: ["본문"] }]);
  // Declared sizes beyond the per-entry / total caps are refused before anything is inflated.
  await assert.rejects(extractPptx(declareSize(honest, 0x7fffffff)), /압축 해제된 문서 크기가 너무 큽니다/);
  // A header that claims a tiny size for a large deflate stream stops at the claimed size (bounded memory).
  const bomb = new JSZip(); bomb.file("[Content_Types].xml", PPTX_TYPES);
  bomb.file("ppt/slides/slide1.xml", Buffer.alloc(64 * 1024 * 1024), { compression: "DEFLATE", compressionOptions: { level: 9 } });
  const bombBytes = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.ok(bombBytes.length < 200 * 1024, "the synthetic bomb is small on disk");
  await assert.rejects(extractPptx(bombBytes), /압축 해제된 문서 크기가 너무 큽니다/);
  const lying = declareSize(bombBytes, 512);
  await assert.rejects(extractPptx(lying), /압축 구조가 올바르지 않습니다|압축 해제된 문서 크기가 너무 큽니다/);
  // More entries than the cap: refused from the central directory without reading any entry.
  const many = new JSZip(); many.file("[Content_Types].xml", PPTX_TYPES);
  for (let index = 0; index < 5200; index++) many.file(`ppt/media/n${index}.bin`, "x");
  await assert.rejects(extractPptx(await many.generateAsync({ type: "nodebuffer" })), /압축 해제된 문서 크기가 너무 큽니다/);
  assert.ok(Date.now() - started < 15_000, "rejection must not depend on inflating the payload");
});

test("pptx extracted text over the limit is refused", async () => {
  const bytes = await buildPptx([{ file: 1, paragraphs: ["가".repeat(MAX_EXTRACTED_CHARS / 2), "나".repeat(MAX_EXTRACTED_CHARS / 2), "다"] }]);
  await assert.rejects(extractPptx(bytes), /PowerPoint 문서에서 추출된 텍스트가 너무 큽니다/);
});

// ---- extensions, MIME tolerance and signatures ----------------------------------------------

test("the document allow-list and canonical MIME types", () => {
  assert.deepEqual([...DOCUMENT_EXTENSIONS].sort(), [".csv", ".docx", ".hwpx", ".md", ".pdf", ".pptx", ".txt", ".xlsx"]);
  assert.equal(canonicalDocumentMime(".pdf"), "application/pdf");
  assert.equal(canonicalDocumentMime(".txt"), "text/plain");
  assert.equal(canonicalDocumentMime(".md"), "text/markdown");
  assert.equal(canonicalDocumentMime(".csv"), "text/csv");
  assert.equal(canonicalDocumentMime(".pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(canonicalDocumentMime(".hwpx"), "application/hwp+zip");
  assert.equal(canonicalDocumentMime(".exe"), undefined);
});

test("new formats tolerate the MIME types operating systems report; old formats stay exact", () => {
  for (const mime of ["text/plain", "", "TEXT/PLAIN; charset=utf-8"]) assert.ok(isAcceptedDocumentMime(".txt", mime), mime);
  for (const mime of ["text/markdown", "text/x-markdown", "text/plain", ""]) assert.ok(isAcceptedDocumentMime(".md", mime), mime);
  for (const mime of ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv", ""]) assert.ok(isAcceptedDocumentMime(".csv", mime), mime);
  assert.ok(isAcceptedDocumentMime(".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
  assert.ok(isAcceptedDocumentMime(".pptx", ""));
  for (const mime of ["application/hwp+zip", "application/haansofthwpx", "application/x-hwpx", ""]) assert.ok(isAcceptedDocumentMime(".hwpx", mime), mime);
  assert.ok(!isAcceptedDocumentMime(".pptx", "application/pdf"));
  assert.ok(!isAcceptedDocumentMime(".txt", "image/png"));
  assert.ok(!isAcceptedDocumentMime(".hwpx", "text/html"));
  assert.ok(isAcceptedDocumentMime(".pdf", "application/pdf"));
  assert.ok(!isAcceptedDocumentMime(".pdf", ""), "pdf/docx/xlsx behaviour is unchanged");
  assert.ok(!isAcceptedDocumentMime(".xlsx", "application/vnd.ms-excel"));
});

test("cheap signature checks run at attach time", () => {
  assert.equal(fileSignatureProblem(".pptx", Buffer.from("PK\u0003\u0004rest")), null);
  assert.match(fileSignatureProblem(".pptx", Buffer.from("not a zip")), /실제 PowerPoint\(\.pptx\) 문서 형식이 아닙니다/);
  assert.match(fileSignatureProblem(".hwpx", Buffer.from("%PDF-1.4")), /실제 한글\(\.hwpx\) 문서 형식이 아닙니다/);
  assert.match(fileSignatureProblem(".hwpx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), /HWPX로 저장/);
  assert.match(fileSignatureProblem(".pptx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), /\.pptx로 저장/);
  assert.equal(fileSignatureProblem(".txt", Buffer.from("평범한 텍스트")), null);
  assert.equal(fileSignatureProblem(".csv", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b", "utf16le")])), null);
  assert.match(fileSignatureProblem(".md", Buffer.from("a\0b")), /이진 데이터/);
});
