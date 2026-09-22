import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyRelease } from "../scripts/verify-release.mjs";
test("release verification rejects wrong versions and corrupted installer bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "mmllm-release-test-"));
  const name = "MM_LLM-0.4.0-x64-Setup.exe"; const bytes = Buffer.from("test fixture");
  const metadata = { version: "0.4.0", files: [{ url: name, size: bytes.length, sha512: createHash("sha512").update(bytes).digest("base64") }] };
  try {
    await writeFile(join(root, name), bytes); await writeFile(join(root, `${name}.blockmap`), "fixture");
    await writeFile(join(root, "latest.yml"), JSON.stringify(metadata));
    assert.deepEqual(await verifyRelease(root, "win", "0.4.0"), [name]);
    await assert.rejects(verifyRelease(root, "win", "0.3.3"), /version/);
    await writeFile(join(root, name), Buffer.from("BAD! fixture"));
    await assert.rejects(verifyRelease(root, "win", "0.4.0"), /SHA512/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
