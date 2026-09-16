import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantOutcome } from "../src/main/chat-history.ts";

const user = (id, text) => ({ id, role: "user", text, apiContent: text, createdAt: "2026-01-01T00:00:00Z" });
const assistant = (id, text) => ({ id, role: "assistant", text, apiContent: text, createdAt: "2026-01-01T00:00:00Z" });

test("normal interruption is saved as incomplete", () => {
  const messages = [user("u1", "질문")];
  applyAssistantOutcome(messages, "부분 답변", "incomplete", -1, "a2", "2026-01-01T00:00:01Z");
  assert.equal(messages.at(-1).status, "incomplete");
});

test("regeneration interruption replaces later history and remains incomplete", () => {
  const messages = [user("u1", "질문"), assistant("a1", "기존"), user("u2", "후속")];
  applyAssistantOutcome(messages, "새 부분", "incomplete", 0, "a2", "2026-01-01T00:00:02Z");
  assert.deepEqual(messages.map((item) => item.id), ["u1", "a2"]);
  assert.equal(messages[1].status, "incomplete");
});
