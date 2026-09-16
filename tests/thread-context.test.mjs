import assert from "node:assert/strict";
import test from "node:test";
import { buildChatContext, chunkDocument } from "../src/main/thread-context.ts";

test("documents are chunked with bounded pieces and overlap", () => {
  const chunks = chunkDocument("가".repeat(13_000));
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 6_000));
});

test("chat context selects relevant original chunks without resending the whole attachment", () => {
  const messages = [{
    id: "u1", role: "user", text: "첨부 문서를 읽어줘", apiContent: "첨부 문서를 읽어줘",
    createdAt: new Date().toISOString(), attachments: ["report.pdf"],
    attachmentContext: [{ kind: "document", name: "report.pdf", chunks: [
      "병원 주차장 운영에 관한 일반 설명", "외래 환자 만족도는 87점이며 대기시간은 24분이다", "구내식당 메뉴 안내"
    ] }]
  }, {
    id: "a1", role: "assistant", text: "읽었습니다.", apiContent: "읽었습니다.", createdAt: new Date().toISOString()
  }, {
    id: "u2", role: "user", text: "외래 환자 대기시간은?", apiContent: "외래 환자 대기시간은?", createdAt: new Date().toISOString()
  }];
  const context = buildChatContext(messages, "외래 환자 대기시간은?", 200);
  const latest = context.at(-1).content;
  assert.equal(typeof latest, "string");
  assert.match(latest, /대기시간은 24분/);
  assert.doesNotMatch(latest, /구내식당/);
});

test("a whole-document comparison represents every attached document", () => {
  const messages = [{ id: "u", role: "user", text: "모든 문서를 비교 요약해줘", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext: [
      { kind: "document", name: "A.pdf", chunks: ["A 병원 운영 지표"] },
      { kind: "document", name: "B.pdf", chunks: ["B 병원 환자 만족도"] },
      { kind: "document", name: "C.pdf", chunks: ["C 병원 재무 현황"] }
    ] }];
  const content = buildChatContext(messages, "모든 문서를 비교 요약해줘", 2_000)[0].content;
  assert.match(content, /A\.pdf/); assert.match(content, /B\.pdf/); assert.match(content, /C\.pdf/);
});

test("a 13-document comparison uses a balanced excerpt from every document", () => {
  const attachmentContext = Array.from({ length: 13 }, (_, index) => ({ kind: "document",
    name: `문서-${index + 1}.pdf`, chunks: [`문서 ${index + 1}의 핵심 병원 지표 ${"자료 ".repeat(300)}`] }));
  const messages = [{ id: "u", role: "user", text: "모든 문서를 비교해줘", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext }];
  const content = String(buildChatContext(messages, "모든 문서를 비교해줘", 15_000)[0].content);
  for (let index = 1; index <= 13; index++) assert.match(content, new RegExp(`문서-${index}\\.pdf`));
  assert.doesNotMatch(content, /포함되지 않았습니다/);
});

test("all images on the newest user message are retained", () => {
  const images = Array.from({ length: 4 }, (_, index) => ({ kind: "image", name: `${index}.png`,
    dataUrl: `data:image/png;base64,${String(index).repeat(8)}` }));
  const messages = [{ id: "u", role: "user", text: "네 이미지를 비교해줘", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext: images }];
  const content = buildChatContext(messages, "네 이미지를 비교해줘")[0].content;
  assert.ok(Array.isArray(content));
  assert.equal(content.filter((part) => part.type === "image_url").length, 4);
});

test("oversized combined image context fails explicitly instead of silently dropping images", () => {
  const huge = `data:image/png;base64,${"a".repeat(9 * 1024 * 1024)}`;
  const messages = [{ id: "u", role: "user", text: "이미지", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext: [{ kind: "image", name: "1.png", dataUrl: huge }, { kind: "image", name: "2.png", dataUrl: huge }] }];
  assert.throws(() => buildChatContext(messages, "이미지"), /전체 크기/);
});

test("more than four images fails explicitly before a request is sent", () => {
  const images = Array.from({ length: 5 }, (_, index) => ({ kind: "image", name: `${index}.png`,
    dataUrl: `data:image/png;base64,${index}` }));
  const messages = [{ id: "u", role: "user", text: "이미지를 비교해줘", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext: images }];
  assert.throws(() => buildChatContext(messages, "이미지를 비교해줘"), /최대 4개/);
});

test("very long ordinary conversation is conservatively shortened with an explicit notice", () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user",
    text: `${index}:${"긴 대화 ".repeat(3_000)}`, apiContent: "", createdAt: "2026-01-01T00:00:00Z" }));
  const content = buildChatContext(messages, "계속");
  assert.ok(content.length < messages.length);
  assert.match(String(content[0].content), /오래된 일부 대화/);
});

test("OCR-free PDFs remain native on follow-up and excess PDFs fail explicitly", () => {
  const pdf = Buffer.from("%PDF-1.7").toString("base64");
  const message = (id, name) => ({ id, role: "user", text: "pdf", apiContent: "pdf", createdAt: "2026-01-01T00:00:00Z",
    attachmentContext: [{ kind: "document", name, chunks: ["[이 PDF는 로컬 OCR로 읽히지 않았습니다.]"], rawPdfBase64: pdf }] });
  const followup = { id: "follow", role: "user", text: "후속 질문", apiContent: "후속 질문", createdAt: "2026-01-02T00:00:00Z" };
  const context = buildChatContext([message("one", "one.pdf"), followup], "후속 질문");
  assert.equal(context.at(-1).content.find((item) => item.type === "document").title, "one.pdf");
  assert.throws(() => buildChatContext([message("1", "1.pdf"), message("2", "2.pdf"), message("3", "3.pdf"), followup], "후속"), /최대 2개/);
});

test("batched manual tool results become consecutive provider tool messages", () => {
  const context = buildChatContext([{ id: "tools", role: "user", text: "results", apiContent: "", createdAt: "2026-01-01T00:00:00Z",
    manualToolResults: [{ toolCallId: "a", name: "one", result: "{\"x\":1}" },
      { toolCallId: "b", name: "two", result: "{\"y\":2}" }] }], "results");
  assert.deepEqual(context.map((item) => item.tool_call_id), ["a", "b"]);
});
