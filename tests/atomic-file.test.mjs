import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAtomic } from "../src/main/atomic-file.ts";

test("failed replacement preserves old contents and removes temporary data", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "mmllm-atomic-")); const file = join(root, "store.enc");
  try {
    await fs.writeFile(file, "previous");
    await assert.rejects(writeAtomic(file, Buffer.from("next"), { ...fs, rename: async () => { throw new Error("disk failure"); } }), /disk failure/);
    assert.equal(await fs.readFile(file, "utf8"), "previous");
    assert.deepEqual(await fs.readdir(root), ["store.enc"]);
    await writeAtomic(file, Buffer.from("committed"));
    assert.equal(await fs.readFile(file, "utf8"), "committed");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
