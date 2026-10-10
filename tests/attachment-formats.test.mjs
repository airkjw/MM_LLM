import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

// Real attachments.ts, project-vault.ts and extractors; only Electron (dialog, safeStorage, userData path) is a fixture.
let root; let dialogOptions = null; let dialogResult = { canceled: true, filePaths: [] };
globalThis.__attachmentFormatsElectron = {
  app: { getPath: () => root },
  dialog: { showOpenDialog: async (_window, options) => { dialogOptions = options; return dialogResult; } },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`synthetic\0${value}`),
    decryptStringAsync: async (bytes) => ({ result: bytes.toString().slice(10), shouldReEncrypt: false })
  }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "mmllm-test:electron", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const url = new URL(specifier, context.parentURL);
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mmllm-test:electron") return { format: "module", shortCircuit: true,
      source: "export const { app, dialog, safeStorage } = globalThis.__attachmentFormatsElectron;" };
    return next(url, context);
  }
});
root = await mkdtemp(join(tmpdir(), "mmllm-attachment-formats-"));
const attachments = await import("../src/main/attachments.ts");
const vault = await import("../src/main/project-vault.ts");
test.after(async () => {
  attachments.clearAttachments(); hooks.deregister(); delete globalThis.__attachmentFormatsElectron;
  await rm(root, { recursive: true, force: true });
});

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const HWPX_MIME = "application/hwp+zip";
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HP_NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';

async function pptxBytes(...texts) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  texts.forEach((text, index) => zip.file(`ppt/slides/slide${index + 1}.xml`,
    `<p:sld ${A_NS}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function hwpxBytes(...texts) {
  const zip = new JSZip();
  zip.file("mimetype", HWPX_MIME, { compression: "STORE" });
  zip.file("Contents/section0.xml", `<hs:sec ${HP_NS}>${texts.map((text) => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`).join("")}</hs:sec>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function docxBytes() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>기존 Word 본문</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
const CP949_TEXT = Buffer.from([0xba, 0xb4, 0xbf, 0xf8, 0x20, 0xb0, 0xe6, 0xbf, 0xb5]); // 병원 경영

const newFormats = async () => [
  { name: "개요.txt", bytes: Buffer.from("텍스트 첨부 본문"), expectMime: "text/plain", expectText: /텍스트 첨부 본문/ },
  { name: "노트.md", bytes: Buffer.from("# 마크다운 제목\n- 항목"), expectMime: "text/markdown", expectText: /# 마크다운 제목/ },
  { name: "지표.csv", bytes: Buffer.from("월,외래\n9월,214\n"), expectMime: "text/csv", expectText: /9월,214/ },
  { name: "구형.txt", bytes: CP949_TEXT, expectMime: "text/plain", expectText: /병원 경영/ },
  { name: "발표.pptx", bytes: await pptxBytes("슬라이드 본문 하나", "슬라이드 본문 둘"), expectMime: PPTX_MIME, expectText: /\[슬라이드 1\]\n슬라이드 본문 하나[\s\S]*\[슬라이드 2\]/ },
  { name: "공문.hwpx", bytes: await hwpxBytes("한글 문서 본문"), expectMime: HWPX_MIME, expectText: /한글 문서 본문/ }
];

test("dropped txt, md, csv, pptx and hwpx files are kept as documents with canonical MIME types", async () => {
  for (const item of await newFormats()) {
    const [picked] = attachments.addDroppedAttachments([{ name: item.name, bytes: item.bytes }], ["document"]);
    assert.equal(picked.kind, "document", item.name);
    assert.equal(picked.name, item.name);
    assert.equal(attachments.getAttachment(picked.id).mime, item.expectMime, item.name);
    attachments.discardAttachments([picked.id]);
  }
});

test("document-only entry points still refuse unsupported or legacy formats and mismatched content", async () => {
  const refuse = (name, bytes, pattern) => assert.throws(
    () => attachments.addDroppedAttachments([{ name, bytes }], ["document", "image"]), pattern, name);
  refuse("옛문서.hwp", Buffer.from("x"), /지원하지 않는 파일 형식/);
  refuse("옛문서.ppt", Buffer.from("x"), /지원하지 않는 파일 형식/);
  refuse("스크립트.js", Buffer.from("x"), /지원하지 않는 파일 형식/);
  refuse("가짜.pptx", Buffer.from("this is plain text"), /실제 PowerPoint\(\.pptx\) 문서 형식이 아닙니다/);
  refuse("가짜.hwpx", Buffer.from("%PDF-1.7"), /실제 한글\(\.hwpx\) 문서 형식이 아닙니다/);
  refuse("이진.txt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x0a]), /텍스트 파일이 아닌 이진 데이터/);
  refuse("용량.txt", Buffer.alloc(attachments.MAX_FILE_BYTES + 1, 0x41), /18MB 이하/);
  assert.throws(() => attachments.addDroppedAttachments([{ name: "개요.txt", bytes: Buffer.from("x") }], ["image"]), /지원하지 않는 파일 형식/);
});

test("contentForChat extracts text from every new format exactly like docx and xlsx documents", async () => {
  for (const item of await newFormats()) {
    const [picked] = attachments.addDroppedAttachments([{ name: item.name, bytes: item.bytes }], ["document"]);
    const sent = await attachments.contentForChat("질문", [picked.id]);
    assert.deepEqual(sent.names, [item.name]);
    assert.equal(sent.attachmentContext.length, 1);
    assert.equal(sent.attachmentContext[0].kind, "document");
    assert.match(sent.attachmentContext[0].chunks.join("\n"), item.expectText, item.name);
    assert.equal("rawPdfBase64" in sent.attachmentContext[0], false);
    attachments.discardAttachments([picked.id]);
  }
});

test("a renamed docx or a text-less file fails extraction with a clear error and no leaked content", async () => {
  const [renamed] = attachments.addDroppedAttachments([{ name: "이름만.pptx", bytes: await docxBytes() }], ["document"]);
  await assert.rejects(attachments.contentForChat("질문", [renamed.id]), (error) =>
    /PowerPoint 문서 형식이 아닙니다/.test(error.message) && !error.message.includes("기존 Word 본문"));
  const [empty] = attachments.addDroppedAttachments([{ name: "빈.txt", bytes: Buffer.from("  \n\n") }], ["document"]);
  await assert.rejects(attachments.contentForChat("질문", [empty.id]), /읽을 수 있는 텍스트가 없습니다/);
  attachments.discardAttachments([renamed.id, empty.id]);
});

test("the file picker offers the new document extensions and returns a picked pptx", async () => {
  const path = join(root, "선택.pptx");
  await writeFile(path, await pptxBytes("선택한 슬라이드"));
  dialogResult = { canceled: false, filePaths: [path] };
  const picked = await attachments.pickAttachment({}, ["document", "image"]);
  assert.ok(dialogOptions.filters[0].extensions.includes("pptx"));
  for (const extension of ["pdf", "docx", "xlsx", "pptx", "hwpx", "txt", "md", "csv", "png", "jpg", "jpeg", "webp"]) {
    assert.ok(dialogOptions.filters[0].extensions.includes(extension), extension);
  }
  assert.equal(dialogOptions.filters[0].extensions.includes("hwp"), false);
  assert.equal(picked.kind, "document");
  assert.equal(attachments.getAttachment(picked.id).mime, PPTX_MIME);
  dialogResult = { canceled: true, filePaths: [] };
  assert.equal(await attachments.pickAttachment({}, ["image"]), null);
  assert.equal(dialogOptions.filters[0].extensions.includes("pptx"), false);
  attachments.discardAttachments([picked.id]);
});

test("project documents accept each new format, tolerate reported MIME variants and store the canonical MIME", async () => {
  const profileId = randomUUID();
  const project = await vault.createProject(profileId, "형식 확장 프로젝트", "문서 기반 응답");
  const variants = [
    ["개요.txt", Buffer.from("프로젝트 텍스트 본문"), ["text/plain", "", "text/plain; charset=utf-8"], "text/plain"],
    ["노트.md", Buffer.from("# 프로젝트 마크다운"), ["text/markdown", "text/x-markdown", ""], "text/markdown"],
    ["지표.csv", Buffer.from("월,외래\n9월,214\n"), ["text/csv", "application/vnd.ms-excel", ""], "text/csv"],
    ["구형.txt", CP949_TEXT, ["text/plain"], "text/plain"],
    ["발표.pptx", await pptxBytes("프로젝트 슬라이드"), [PPTX_MIME, ""], PPTX_MIME],
    ["공문.hwpx", await hwpxBytes("프로젝트 한글 본문"), [HWPX_MIME, "application/haansofthwpx", ""], HWPX_MIME]
  ];
  let count = 0;
  for (const [name, bytes, mimes, canonical] of variants) {
    for (const mime of mimes) {
      if (count >= 20) break;
      const updated = await vault.addProjectDocument(profileId, project.id, { name, mime, bytes });
      count++;
      assert.equal(updated.documents.at(-1).mime, canonical, `${name} stored with ${mime || "empty MIME"}`);
      assert.equal(updated.documents.at(-1).name, name);
    }
  }
  const context = await vault.projectContext(profileId, project.id, "프로젝트 본문 슬라이드 마크다운 외래 병원 경영", false);
  for (const expected of [/프로젝트 텍스트 본문/, /프로젝트 마크다운/, /9월,214/, /병원 경영/, /\[슬라이드 1\]/, /프로젝트 한글 본문/]) {
    assert.match(context.text, expected);
  }
});

test("project documents refuse mismatched MIME, extension and content, and keep the old formats exact", async () => {
  const profileId = randomUUID();
  const project = await vault.createProject(profileId, "거부 프로젝트");
  const add = (input) => vault.addProjectDocument(profileId, project.id, input);
  const mismatch = /확장자·MIME·실제 파일 형식이 일치하지 않습니다/;
  await assert.rejects(add({ name: "a.pptx", mime: "application/pdf", bytes: await pptxBytes("x") }), mismatch);
  await assert.rejects(add({ name: "a.txt", mime: "image/png", bytes: Buffer.from("x") }), mismatch);
  await assert.rejects(add({ name: "a.hwpx", mime: "text/html", bytes: await hwpxBytes("x") }), mismatch);
  await assert.rejects(add({ name: "a.pptx", mime: PPTX_MIME, bytes: Buffer.from("not a zip") }), mismatch);
  await assert.rejects(add({ name: "a.txt", mime: "text/plain", bytes: Buffer.from([0, 1, 2, 3, 0, 0]) }), mismatch);
  await assert.rejects(add({ name: "a.docx", mime: "", bytes: await docxBytes() }), mismatch);
  await assert.rejects(add({ name: "a.xlsx", mime: "application/vnd.ms-excel", bytes: await docxBytes() }), mismatch);
  await assert.rejects(add({ name: "a.hwp", mime: HWPX_MIME, bytes: await hwpxBytes("x") }), mismatch);
  await assert.rejects(add({ name: "가짜.pptx", mime: PPTX_MIME, bytes: await docxBytes() }), /PowerPoint 문서 형식이 아닙니다/);
  const docx = await add({ name: "기존.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await docxBytes() });
  assert.equal(docx.documents.length, 1);
  assert.equal(docx.documents[0].mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("new-format project documents survive a portable backup export and restore into another profile", async () => {
  const source = randomUUID(); const target = randomUUID();
  const project = await vault.createProject(source, "백업 형식");
  await vault.addProjectDocument(source, project.id, { name: "발표.pptx", mime: "", bytes: await pptxBytes("백업 슬라이드 본문") });
  await vault.addProjectDocument(source, project.id, { name: "공문.hwpx", mime: "application/haansofthwpx", bytes: await hwpxBytes("백업 한글 본문") });
  await vault.addProjectDocument(source, project.id, { name: "메모.md", mime: "text/x-markdown", bytes: Buffer.from("# 백업 마크다운") });
  const exported = await vault.exportProjectBackup(source);
  assert.deepEqual(exported[0].documents.map((doc) => doc.mime), [PPTX_MIME, HWPX_MIME, "text/markdown"]);
  await vault.restoreProjectBackup(target, exported);
  const restored = (await vault.listProjects(target))[0];
  assert.deepEqual(restored.documents.map((doc) => [doc.name, doc.mime]),
    [["발표.pptx", PPTX_MIME], ["공문.hwpx", HWPX_MIME], ["메모.md", "text/markdown"]]);
  const context = await vault.projectContext(target, restored.id, "백업 슬라이드 한글 마크다운", false);
  for (const expected of [/백업 슬라이드 본문/, /백업 한글 본문/, /백업 마크다운/]) assert.match(context.text, expected);
});

test("legacy .hwp and .ppt files are refused with a pointer to HWPX and PPTX", () => {
  const refuse = (name) => { try { attachments.addDroppedAttachments([{ name, bytes: Buffer.from("x") }], ["document"]); } catch (error) { return error.message; } return ""; };
  assert.equal(refuse("옛문서.hwp"), "옛문서.hwp: 지원하지 않는 파일 형식입니다. 한글 구형식(.hwp)은 한글에서 HWPX로 저장한 뒤 첨부해 주세요.");
  assert.equal(refuse("발표.PPT"), "발표.PPT: 지원하지 않는 파일 형식입니다. PowerPoint 구형식(.ppt)은 .pptx로 저장한 뒤 첨부해 주세요.");
  assert.equal(refuse("스크립트.js"), "스크립트.js: 지원하지 않는 파일 형식입니다.");
});
