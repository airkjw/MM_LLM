import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument } from "../src/main/thread-context.ts";
import { extractPlainText } from "../src/main/document-formats.ts";

// Reference: chunkDocument exactly as it was before the whitespace pass became linear (R-1 F2).
function referenceChunkDocument(text, maxChars = 6_000) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks = []; let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf(". ", end));
      if (boundary > start + Math.floor(maxChars * .55)) end = boundary + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - 500);
  }
  return chunks.filter(Boolean);
}

const paragraph = "병원 경영 분석 보고서입니다. 외래 환자 수는 214명이며 매출은 12,700,000원입니다. ";
const samples = {
  empty: "",
  blank: " \t \n\t\n  ",
  normal: Array.from({ length: 120 }, (_, i) => `${i + 1}. ${paragraph}`).join("\n"),
  trailingBlanks: "첫 줄   \n둘째 줄\t\t\n셋째 줄 \t \n\n  \n끝   ",
  crlf: "가나다  \r\n라마바\t\r\n사아자\r차카타 \r끝",
  nbsp: "비분리 공백  \n다음 줄　\n전각 공백",
  leading: "   앞공백\n\t\t탭으로 시작\n끝",
  tableLike: Array.from({ length: 400 }, (_, i) => `월${i}\t214\t12700000 \t`).join("\n"),
  markdown: "# 제목  \n\n- 항목 1  \n- 항목 **2**\t\n\n| a | b |\n|---|---|\n| 1 | 2 |   \n",
  longNoBreak: "가".repeat(20_000) + "  \n" + "나".repeat(7_000),
  mixedRuns: ("a" + " ".repeat(37) + "\t".repeat(5) + " \n" + "b ").repeat(900),
  sentences: Array.from({ length: 500 }, (_, i) => `문장 ${i}번입니다. `).join("")
};

for (const [name, text] of Object.entries(samples)) {
  test(`chunkDocument output is unchanged for ${name} input`, () => {
    assert.deepEqual(chunkDocument(text), referenceChunkDocument(text));
    assert.deepEqual(chunkDocument(text, 500), referenceChunkDocument(text, 500));
  });
}

const elapsed = (run) => { const started = performance.now(); const value = run(); return { value, ms: performance.now() - started }; };

test("long whitespace runs without a newline are chunked in linear time", () => {
  for (const unit of [" ", "\t", " \t"]) {
    const text = "a" + unit.repeat(500_000) + "b";
    const { value, ms } = elapsed(() => chunkDocument(text));
    assert.ok(ms < 1_500, `${JSON.stringify(unit)} x 500000 took ${Math.round(ms)} ms`);
    assert.ok(value[0].startsWith("a") && value.at(-1).endsWith("b"));
  }
});

test("a .txt made of one 1 MB whitespace run goes through extraction and chunking quickly", () => {
  const bytes = Buffer.from("a" + " ".repeat(999_998) + "b");
  const { value, ms } = elapsed(() => chunkDocument(extractPlainText(bytes)));
  assert.ok(ms < 2_000, `${Math.round(ms)} ms`);
  assert.ok(value.length > 1);
});

test("a long run before a newline is still trimmed, in linear time", () => {
  const text = `첫 줄${" ".repeat(300_000)}\n둘째 줄${"\t".repeat(300_000)}\n끝`;
  const { value, ms } = elapsed(() => chunkDocument(text));
  assert.equal(value.join("").includes("\t"), false);
  assert.match(value[0], /^첫 줄\n둘째 줄\n끝$/);
  assert.ok(ms < 1_500, `${Math.round(ms)} ms`);
});

test("a megabyte of text with no line or sentence breaks is chunked quickly", () => {
  const { value, ms } = elapsed(() => chunkDocument("가".repeat(1_000_000)));
  assert.ok(value.length > 100);
  assert.ok(ms < 3_000, `${Math.round(ms)} ms`);
});
