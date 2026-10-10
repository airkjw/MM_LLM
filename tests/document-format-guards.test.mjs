import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeflateRaw, deflateRawSync } from "node:zlib";
import { extractHwpx, extractPlainText, extractPptx } from "../src/main/document-formats.ts";

// Every guard of the ZIP reader and every XML scanner shape gets its own fixture that passes the
// [Content_Types].xml / mimetype checks and then hits exactly one guard. Exact messages are asserted so a
// removed guard cannot be masked by a different, later failure.
const STRUCTURE = "문서 압축 구조가 올바르지 않습니다.";
const TOO_LARGE = "압축 해제된 문서 크기가 너무 큽니다.";
const ENCRYPTED = "암호화된 문서는 읽을 수 없습니다. 암호를 해제한 뒤 다시 첨부해 주세요.";
const MALFORMED = "문서 XML 구조가 올바르지 않습니다.";
const MB = 1024 * 1024;

const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HP_NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
const PPTX_TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`;
const slideBody = (text) => `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>`;
const slide = (text, padding = "") => Buffer.from(`<?xml version="1.0"?><p:sld ${A_NS}>${slideBody(text)}${padding}</p:sld>`);
const section = (text) => Buffer.from(`<?xml version="1.0"?><hs:sec ${HP_NS}><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`);

/**
 * Minimal ZIP writer that can lie on purpose. entry: { name, data, method = 8, compressed, flags, localFlags,
 * declaredSize, declaredCompressed, centralMethod, localSignature, centralSignature, localOffsetFrom,
 * centralOffset, centralNameLength }. CRC is left at zero (the reader does not rely on it).
 */
function buildZip(entries, { comment = Buffer.alloc(0), eocd = {} } = {}) {
  const parts = []; const offsets = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const method = entry.method ?? 8;
    const stored = entry.compressed ?? (method === 8 ? deflateRawSync(entry.data) : entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(entry.localSignature ?? 0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlags ?? 0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18); local.writeUInt32LE(entry.data?.length ?? 0, 22); local.writeUInt16LE(name.length, 26);
    offsets.push(offset); parts.push(local, name, stored); offset += 30 + name.length + stored.length;
  }
  const directoryStart = offset; const central = [];
  entries.forEach((entry, index) => {
    const name = Buffer.from(entry.name); const method = entry.method ?? 8;
    const stored = entry.compressed ?? (method === 8 ? deflateRawSync(entry.data) : entry.data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(entry.centralSignature ?? 0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(entry.flags ?? 0, 8); record.writeUInt16LE(entry.centralMethod ?? method, 10);
    record.writeUInt32LE(entry.declaredCompressed ?? stored.length, 20); record.writeUInt32LE(entry.declaredSize ?? entry.data?.length ?? 0, 24);
    record.writeUInt16LE(entry.centralNameLength ?? name.length, 28);
    record.writeUInt32LE(entry.centralOffset ?? offsets[entry.localOffsetFrom ?? index], 42);
    central.push(record, name);
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(eocd.entries ?? entries.length, 8); end.writeUInt16LE(eocd.total ?? entries.length, 10);
  end.writeUInt32LE(eocd.directorySize ?? directory.length, 12); end.writeUInt32LE(eocd.directoryOffset ?? directoryStart, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, directory, end, comment]);
}

const pptxEntries = (text = "가드 통과 본문", extra = []) => [
  { name: "[Content_Types].xml", data: Buffer.from(PPTX_TYPES) },
  { name: "ppt/slides/slide1.xml", data: slide(text) }, ...extra];
const hwpxEntries = (text = "가드 통과 한글 본문", extra = []) => [
  { name: "mimetype", data: Buffer.from("application/hwp+zip"), method: 0 },
  { name: "Contents/section0.xml", data: section(text) }, ...extra];
const zeros = (size) => Buffer.alloc(size);

test("the fixture builder produces archives the reader accepts", async () => {
  assert.match(await extractPptx(buildZip(pptxEntries())), /\[슬라이드 1\]\n가드 통과 본문/);
  assert.match(await extractHwpx(buildZip(hwpxEntries())), /가드 통과 한글 본문/);
});

// ---- size guards ----------------------------------------------------------------------------

test("guard: inflated length must equal the declared size", async () => {
  const entries = pptxEntries(); entries[1].declaredSize = entries[1].data.length + 10;
  await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE });
  const smaller = pptxEntries(); smaller[1].declaredSize = smaller[1].data.length - 10;
  await assert.rejects(extractPptx(buildZip(smaller)), { message: STRUCTURE });
});

test("guard: a stored entry must declare equal compressed and uncompressed sizes", async () => {
  const entries = pptxEntries(); const data = entries[1].data;
  Object.assign(entries[1], { method: 0, compressed: data, declaredSize: data.length - 3 });
  await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE });
});

test("guard: inflating stops at the declared size (bounded memory against a lying header)", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mmllm-bomb-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // 256MiB of zeros compressed through a stream so the test itself never holds the payload.
  const deflater = createDeflateRaw({ level: 9 }); const chunks = [];
  deflater.on("data", (chunk) => chunks.push(chunk));
  const finished = once(deflater, "end"); const block = Buffer.alloc(MB);
  for (let index = 0; index < 256; index++) if (!deflater.write(block)) await once(deflater, "drain");
  deflater.end(); await finished;
  const compressed = Buffer.concat(chunks);
  assert.ok(compressed.length < 512 * 1024, "the synthetic bomb is small on disk");
  const entries = pptxEntries();
  Object.assign(entries[1], { compressed, data: Buffer.alloc(1000), declaredSize: 1000 });
  const file = join(directory, "bomb.pptx"); await writeFile(file, buildZip(entries));
  const script = `
    import { readFileSync } from "node:fs";
    import { extractPptx } from ${JSON.stringify(new URL("../src/main/document-formats.ts", import.meta.url).href)};
    const bytes = readFileSync(process.argv[1]);
    const before = process.resourceUsage().maxRSS;
    let message = "";
    try { await extractPptx(bytes); } catch (error) { message = error.message; }
    console.log(JSON.stringify({ message, grewKb: process.resourceUsage().maxRSS - before }));`;
  const started = Date.now();
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script, file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const result = JSON.parse(output.trim().split("\n").at(-1));
  assert.equal(result.message, STRUCTURE);
  assert.ok(result.grewKb < 64 * 1024, `peak RSS grew by ${result.grewKb} kB`);
  assert.ok(Date.now() - started < 20_000);
});

test("guard: an honest entry above the per-entry cap is refused before inflating", async () => {
  const entries = pptxEntries(); entries[1].data = slide("본문", " ".repeat(16 * MB));
  await assert.rejects(extractPptx(buildZip(entries)), { message: TOO_LARGE });
});

test("guard: the declared total of all entries is capped even when none of them is read", async () => {
  const media = zeros(14 * MB); const compressed = deflateRawSync(media);
  const extra = Array.from({ length: 6 }, (_, index) => ({ name: `ppt/media/blob${index}.bin`, data: media, compressed }));
  await assert.rejects(extractPptx(buildZip(pptxEntries("본문", extra))), { message: TOO_LARGE });
  const fits = Array.from({ length: 5 }, (_, index) => ({ name: `ppt/media/blob${index}.bin`, data: media, compressed }));
  assert.match(await extractPptx(buildZip(pptxEntries("본문", fits))), /본문/, "5 x 14MiB is still under the 80MiB cap");
});

test("guard: the cumulative size of entries actually read is capped", async () => {
  const padded = slide("첫 슬라이드", " ".repeat(15 * MB));
  const entries = [{ name: "[Content_Types].xml", data: Buffer.from(PPTX_TYPES) },
    ...[1, 2, 3, 4].map((number) => ({ name: `ppt/slides/slide${number}.xml`, data: padded }))];
  await assert.rejects(extractPptx(buildZip(entries)), { message: TOO_LARGE });
  const three = entries.slice(0, 4);
  assert.match(await extractPptx(buildZip(three)), /첫 슬라이드/, "three 15MiB slides stay within the 48MiB read budget");
});

test("guard: entry count limit is exact", async () => {
  const filler = (count) => Array.from({ length: count }, (_, index) => ({ name: `ppt/media/f${index}.bin`, data: Buffer.from("x"), method: 0 }));
  assert.match(await extractPptx(buildZip(pptxEntries("본문", filler(4998)))), /본문/, "5000 entries are accepted");
  await assert.rejects(extractPptx(buildZip(pptxEntries("본문", filler(4999)))), { message: TOO_LARGE });
});

// ---- encryption, methods, ZIP64 --------------------------------------------------------------

test("guard: central-directory encryption flags reject the whole archive, read or not", async () => {
  for (const flag of [0x0001, 0x0040]) {
    const extra = [{ name: "ppt/media/unused.bin", data: Buffer.from("x"), method: 0, flags: flag }];
    await assert.rejects(extractPptx(buildZip(pptxEntries("본문", extra))), { message: ENCRYPTED }, `flag ${flag}`);
  }
});

test("guard: a local-header encryption flag is rejected when the entry is read", async () => {
  const entries = pptxEntries(); entries[1].localFlags = 0x0001;
  await assert.rejects(extractPptx(buildZip(entries)), { message: ENCRYPTED });
  const strong = pptxEntries(); strong[1].localFlags = 0x0040;
  await assert.rejects(extractPptx(buildZip(strong)), { message: ENCRYPTED });
});

test("guard: only stored and deflate entries are readable", async () => {
  for (const method of [1, 9, 12, 14]) {
    const entries = pptxEntries(); const data = entries[1].data;
    Object.assign(entries[1], { method, compressed: data, centralMethod: method });
    await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE }, `method ${method}`);
  }
});

test("guard: ZIP64 markers are refused", async () => {
  const marker = 0xffffffff;
  const unused = (patch) => [{ name: "ppt/media/unused.bin", data: Buffer.from("x"), method: 0, ...patch }];
  await assert.rejects(extractPptx(buildZip(pptxEntries("본문", unused({ declaredCompressed: marker })))), { message: STRUCTURE });
  await assert.rejects(extractPptx(buildZip(pptxEntries("본문", unused({ declaredSize: marker })))), { message: STRUCTURE });
  await assert.rejects(extractPptx(buildZip(pptxEntries("본문", unused({ centralOffset: marker })))), { message: STRUCTURE });
  await assert.rejects(extractPptx(buildZip(pptxEntries(), { eocd: { total: 0xffff } })), { message: STRUCTURE });
});

// ---- structure -----------------------------------------------------------------------------

test("guard: duplicate entry names are ambiguous and refused", async () => {
  const entries = pptxEntries(); entries.push({ name: "ppt/slides/slide1.xml", data: slide("두 번째 슬라이드 본문") });
  await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE });
});

test("guard: the local data of an entry may not run into the central directory", async () => {
  const entries = pptxEntries(); const data = entries[1].data;
  Object.assign(entries[1], { method: 0, compressed: data, declaredSize: data.length + 5000, declaredCompressed: data.length + 5000 });
  await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE });
});

test("guard: the local header signature must match", async () => {
  const entries = pptxEntries(); entries[1].localSignature = 0x04034b51;
  await assert.rejects(extractPptx(buildZip(entries)), { message: STRUCTURE });
  // An offset far outside the file is a structure error, not an out-of-range exception from the Buffer API.
  const outside = pptxEntries(); outside[1].centralOffset = 0x7ffffff0;
  await assert.rejects(extractPptx(buildZip(outside)), { message: STRUCTURE });
});

test("guard: central records need the right signature and must stay inside the directory", async () => {
  const signature = pptxEntries(); signature[1].centralSignature = 0x02014b51;
  await assert.rejects(extractPptx(buildZip(signature)), { message: STRUCTURE });
  // The overflowing name sits on the last record so no later record check can mask this guard.
  const overflow = pptxEntries(); overflow[1].centralNameLength = 9000;
  await assert.rejects(extractPptx(buildZip(overflow)), { message: STRUCTURE });
});

test("guard: the end-of-central-directory record is validated", async () => {
  await assert.rejects(extractPptx(buildZip(pptxEntries(), { eocd: { total: 0, entries: 0 } })), { message: STRUCTURE });
  await assert.rejects(extractPptx(buildZip(pptxEntries(), { eocd: { directoryOffset: 1 << 20 } })), { message: STRUCTURE });
  await assert.rejects(extractPptx(Buffer.from("PK\u0003\u0004" + "x".repeat(100))), { message: STRUCTURE });
  await assert.rejects(extractPptx(Buffer.alloc(10)), { message: STRUCTURE });
  // A fake end record hidden in the real record's comment claims a comment longer than the file: it is skipped.
  const fake = Buffer.alloc(22); fake.writeUInt32LE(0x06054b50, 0); fake.writeUInt16LE(0xffff, 20);
  assert.match(await extractPptx(buildZip(pptxEntries(), { comment: fake })), /가드 통과 본문/);
});

// ---- encodings and ordering guards that earlier tests missed ----------------------------------

test("guard: bytes that are neither UTF-8 nor plausible CP949 are refused", () => {
  const encoding = "텍스트 인코딩을 인식할 수 없습니다. UTF-8·UTF-16·CP949로 저장해 주세요.";
  const replaced = Buffer.alloc(200); for (let index = 0; index < replaced.length; index += 2) { replaced[index] = 0xff; replaced[index + 1] = 0x41; }
  assert.throws(() => extractPlainText(replaced), { message: encoding }, "undecodable pairs become U+FFFD");
  const badBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([0xc3, 0x28, 0xa0, 0xa1])]);
  assert.throws(() => extractPlainText(badBom), { message: encoding }, "a UTF-8 BOM promises UTF-8");
  // ICU decodes a lone 0x81 to the C1 control U+0081 rather than U+FFFD: that is binary noise, not text.
  const c1 = Buffer.alloc(200); for (let index = 0; index < c1.length; index += 2) { c1[index] = 0x81; c1[index + 1] = 0x20; }
  assert.throws(() => extractPlainText(c1), { message: "텍스트 파일이 아닌 이진 데이터가 포함되어 있습니다." }, "C1 control noise");
  assert.equal(extractPlainText(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb])), "한글", "plain two-byte CP949 still decodes");
});

test("guard: sections missing from the hwpx spine are appended instead of silently dropped", async () => {
  const entries = [
    { name: "mimetype", data: Buffer.from("application/hwp+zip"), method: 0 },
    { name: "Contents/section0.xml", data: section("구역 영 본문") },
    { name: "Contents/section1.xml", data: section("구역 일 본문") },
    { name: "Contents/content.hpf", data: Buffer.from(`<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="s1" href="Contents/section1.xml"/><opf:item id="s0" href="Contents/section0.xml"/></opf:manifest><opf:spine><opf:itemref idref="s1"/></opf:spine></opf:package>`) }
  ];
  const text = await extractHwpx(buildZip(entries));
  assert.ok(text.indexOf("구역 일 본문") >= 0 && text.indexOf("구역 영 본문") > text.indexOf("구역 일 본문"), text);
});

// ---- linear-time XML scanning (R-1 F1) -------------------------------------------------------

const timed = async (run) => { const started = performance.now(); try { return { value: await run(), ms: performance.now() - started }; }
  catch (error) { return { error, ms: performance.now() - started }; } };
const repeat = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length));
const pptxWith = (xml) => buildZip([{ name: "[Content_Types].xml", data: Buffer.from(PPTX_TYPES) }, { name: "ppt/slides/slide1.xml", data: Buffer.from(xml) }]);
const hwpxWith = (xml) => buildZip([{ name: "mimetype", data: Buffer.from("application/hwp+zip"), method: 0 }, { name: "Contents/section0.xml", data: Buffer.from(xml) }]);
const shapes = {
  "pptx unclosed <a:t>": (size) => ["pptx", `<p:sld ${A_NS}><a:p>${repeat("<a:t>x", size)}`],
  "pptx tag never closed <a:p ": (size) => ["pptx", `<p:sld ${A_NS}>${repeat("<a:p ", size)}`],
  "hwpx unclosed <hp:t>": (size) => ["hwpx", `<hs:sec ${HP_NS}><hp:p>${repeat("<hp:t>x", size)}`],
  "hwpx tag never closed <hp:p ": (size) => ["hwpx", `<hs:sec ${HP_NS}>${repeat("<hp:p ", size)}`],
  "hwpx <hp:t> followed by '<' runs": (size) => ["hwpx", `<hs:sec ${HP_NS}><hp:p><hp:t>${"<".repeat(size)}`]
};
// The last size sits just under the 16 MiB per-part cap, so the scanner (not the size guard) must reject it.
const budgets = [[1024, 1_000], [480 * 1024, 1_500], [16 * MB - 4096, 5_000]];
for (const [label, make] of Object.entries(shapes)) {
  for (const [size, limitMs] of budgets) {
    test(`linear scan: ${label} at ${size >= MB ? "the 16 MiB part cap" : `${size / 1024} KiB`} is rejected within ${limitMs} ms`, async () => {
      const [kind, xml] = make(size);
      const bytes = kind === "pptx" ? pptxWith(xml) : hwpxWith(xml);
      const { error, ms, value } = await timed(() => kind === "pptx" ? extractPptx(bytes) : extractHwpx(bytes));
      assert.ok(error, `expected a rejection, got ${JSON.stringify(value)}`);
      assert.equal(error.message, MALFORMED);
      assert.ok(ms < limitMs, `took ${Math.round(ms)} ms (limit ${limitMs})`);
    });
  }
}

test("linear scan: very large but well-formed parts extract correctly and quickly", async () => {
  const padding = repeat('<a:rPr lang="ko-KR" sz="1800"/>', 15 * MB);
  const pptx = await timed(() => extractPptx(pptxWith(`<p:sld ${A_NS}>${padding}${slideBody("큰 슬라이드 속 본문")}</p:sld>`)));
  assert.equal(pptx.value, "[슬라이드 1]\n큰 슬라이드 속 본문"); assert.ok(pptx.ms < 5_000, `${Math.round(pptx.ms)} ms`);
  const hwpxPadding = repeat('<hp:linesegarray><hp:lineseg textpos="0" vertpos="0"/></hp:linesegarray>', 15 * MB);
  const hwpx = await timed(() => extractHwpx(hwpxWith(`<hs:sec ${HP_NS}><hp:p>${hwpxPadding}<hp:run><hp:t>큰 구역 속 본문</hp:t></hp:run></hp:p></hs:sec>`)));
  assert.equal(hwpx.value, "큰 구역 속 본문"); assert.ok(hwpx.ms < 5_000, `${Math.round(hwpx.ms)} ms`);
});

test("linear scan: attributes with '>' in quotes, comments and CDATA are scanned, not mis-tokenised", async () => {
  const xml = `<p:sld ${A_NS}><!-- <a:t>hidden</a:t> --><a:p><a:r><a:rPr note="a > b"/><a:t><![CDATA[1 < 2 & 3]]></a:t></a:r></a:p><a:p><a:r><a:t>둘째 &amp; 끝</a:t></a:r></a:p></p:sld>`;
  assert.equal(await extractPptx(pptxWith(xml)), "[슬라이드 1]\n1 < 2 & 3\n둘째 & 끝");
});

test("linear scan: an unterminated comment, CDATA or quote is a malformed part, not a hang", async () => {
  for (const tail of ["<!-- never closed", "<![CDATA[ never closed", `<a:p note="never closed>`, "<a:p <a:p>"]) {
    const { error, ms } = await timed(() => extractPptx(pptxWith(`<p:sld ${A_NS}>${tail}${" ".repeat(MB)}`)));
    assert.equal(error?.message, MALFORMED, tail); assert.ok(ms < 1_000);
  }
});

test("linear scan: millions of empty or tiny paragraphs stop at the text limit quickly", async () => {
  const tiny = repeat("<hp:p><hp:t>x</hp:t></hp:p>", 15 * MB);
  const { error, ms } = await timed(() => extractHwpx(hwpxWith(`<hs:sec ${HP_NS}>${tiny}</hs:sec>`)));
  assert.equal(error?.message, "한글(HWPX) 문서에서 추출된 텍스트가 너무 큽니다."); assert.ok(ms < 5_000, `${Math.round(ms)} ms`);
  const empty = await timed(() => extractPptx(pptxWith(`<p:sld ${A_NS}>${repeat("<a:p></a:p><a:p/>", 15 * MB)}${slideBody("끝")}</p:sld>`)));
  assert.equal(empty.value, "[슬라이드 1]\n끝"); assert.ok(empty.ms < 5_000, `${Math.round(empty.ms)} ms`);
});
