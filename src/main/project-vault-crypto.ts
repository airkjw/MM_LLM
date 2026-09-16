import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

export type VaultKey = { id: string; key: Buffer };
export type VaultEnvelope = { version: 1; keyId: string; nonce: string; tag: string; ciphertext: string };
const MAX_VAULT_PLAIN_BYTES = 18 * 1024 * 1024;
const MAX_VAULT_ENVELOPE_BYTES = 25 * 1024 * 1024;

export function createVaultKey(): VaultKey { return { id: randomUUID(), key: randomBytes(32) }; }

export function encryptVaultBlob(plain: Buffer, key: VaultKey, aad: string): Buffer {
  if (key.key.length !== 32) throw new Error("프로젝트 보관함 암호화 키가 올바르지 않습니다.");
  if (!plain.length || plain.length > MAX_VAULT_PLAIN_BYTES) throw new Error("프로젝트 문서 암호화 크기가 올바르지 않습니다.");
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope: VaultEnvelope = { version: 1, keyId: key.id, nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function decryptVaultBlob(serialized: Buffer, keys: VaultKey[], aad: string): Buffer {
  if (!serialized.length || serialized.length > MAX_VAULT_ENVELOPE_BYTES) throw new Error("프로젝트 문서 암호화 파일이 저장 한도를 넘었습니다.");
  let envelope: VaultEnvelope;
  try { envelope = JSON.parse(serialized.toString("utf8")) as VaultEnvelope; }
  catch { throw new Error("프로젝트 문서 암호화 형식이 올바르지 않습니다."); }
  if (!envelope || typeof envelope !== "object" || Object.keys(envelope).some((key) =>
    !["version", "keyId", "nonce", "tag", "ciphertext"].includes(key)) || envelope.version !== 1 ||
    typeof envelope.keyId !== "string" || !/^[a-f0-9-]{36}$/.test(envelope.keyId) ||
    typeof envelope.nonce !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
    throw new Error("프로젝트 문서 암호화 버전을 지원하지 않습니다.");
  }
  const key = keys.find((candidate) => candidate.id === envelope.keyId);
  if (!key) throw new Error("프로젝트 문서 암호화 키를 찾을 수 없습니다.");
  const decode = (value: string) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("프로젝트 문서 암호화 메타데이터가 올바르지 않습니다.");
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) throw new Error("프로젝트 문서 암호화 메타데이터가 올바르지 않습니다.");
    return bytes;
  };
  const nonce = decode(envelope.nonce); const tag = decode(envelope.tag);
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("프로젝트 문서 암호화 메타데이터가 올바르지 않습니다.");
  const ciphertext = decode(envelope.ciphertext);
  if (!ciphertext.length || ciphertext.length > MAX_VAULT_PLAIN_BYTES) throw new Error("프로젝트 문서 암호화 데이터가 저장 한도를 넘었습니다.");
  const decipher = createDecipheriv("aes-256-gcm", key.key, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8")); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
