import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
const MAGIC = Buffer.from("MM_LLM_BACKUP_V1\0", "ascii");
const SALT_BYTES = 32; const NONCE_BYTES = 12; const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + NONCE_BYTES + TAG_BYTES;
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

function passwordBytes(password: string): void {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("백업 암호는 12자 이상 1,024자 이하로 입력해 주세요.");
  }
}
async function keyFor(password: string, salt: Buffer): Promise<Buffer> {
  passwordBytes(password);
  // Fixed parameters: untrusted files cannot request arbitrary CPU or memory usage.
  return new Promise((resolve, reject) => scrypt(password, salt, 32,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}

export async function encryptBackup(plain: Buffer, password: string): Promise<Buffer> {
  if (!plain.length || plain.length > MAX_BACKUP_BYTES - HEADER_BYTES) throw new Error("백업은 512MB 이하만 지원합니다.");
  const salt = randomBytes(SALT_BYTES); const nonce = randomBytes(NONCE_BYTES);
  const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const aad = Buffer.concat([MAGIC, salt, nonce]); cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([aad, cipher.getAuthTag(), encrypted]);
  } finally { key.fill(0); }
}

export async function decryptBackup(encrypted: Buffer, password: string): Promise<Buffer> {
  if (encrypted.length <= HEADER_BYTES || encrypted.length > MAX_BACKUP_BYTES ||
    !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("지원하지 않거나 손상된 MM_LLM 백업 파일입니다.");
  const salt = encrypted.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const nonceEnd = MAGIC.length + SALT_BYTES + NONCE_BYTES;
  const key = await keyFor(password, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(MAGIC.length + SALT_BYTES, nonceEnd));
    decipher.setAAD(encrypted.subarray(0, nonceEnd));
    decipher.setAuthTag(encrypted.subarray(nonceEnd, HEADER_BYTES));
    return Buffer.concat([decipher.update(encrypted.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error("백업 암호가 일치하지 않거나 파일이 손상되었습니다. 기존 데이터는 변경하지 않았습니다.");
  } finally { key.fill(0); }
}
