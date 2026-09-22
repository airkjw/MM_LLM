import test from "node:test";
import assert from "node:assert/strict";
import { encryptBackup, decryptBackup } from "../src/main/backup-crypto.ts";
const password = "test-only-password-123";
test("backup decrypts independently of machine keychain and never contains plaintext", async () => {
  const plain = Buffer.from(JSON.stringify({ thread: "private conversation", document: "research" }));
  const encrypted = await encryptBackup(plain, password);
  assert.equal(encrypted.includes(Buffer.from("private conversation")), false);
  assert.deepEqual(await decryptBackup(encrypted, password), plain);
  assert.notDeepEqual(await encryptBackup(plain, password), encrypted);
});
test("wrong password, truncation and tampering cannot restore unauthenticated bytes", async () => {
  const encrypted = await encryptBackup(Buffer.from("private content"), password);
  await assert.rejects(decryptBackup(encrypted, "different-password"), /암호/);
  const corrupt = Buffer.from(encrypted); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(decryptBackup(corrupt, password), /손상/);
  await assert.rejects(decryptBackup(encrypted.subarray(0, 10), password), /손상/);
  await assert.rejects(encryptBackup(Buffer.from("data"), "short"), /12자/);
});
