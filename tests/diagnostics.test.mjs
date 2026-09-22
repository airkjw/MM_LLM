import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticReport } from "../src/shared/diagnostics.ts";
test("diagnostic output uses an explicit allowlist and ignores sensitive fields", () => {
  const report = diagnosticReport({ version: "0.4.0", platform: "darwin", arch: "arm64", electron: "44",
    stage: "chat", modelId: "gpt-5.6-sol", key: "sk-secret", prompt: "private patient", path: "/Users/secret" });
  assert.match(report, /0\.4\.0/); assert.match(report, /gpt-5.6-sol/);
  assert.doesNotMatch(report, /sk-secret|private patient|Users\/secret/);
});
