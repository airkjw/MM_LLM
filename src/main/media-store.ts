import { app } from "electron";
import { copyFile, lstat, mkdir, open, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { detectMedia, isPublicIpAddress, type DetectedMedia, type MediaKind } from "../shared/media-security";
import { detectChatbotDocument, MAX_CHATBOT_FILE_BYTES } from "../shared/chatbot-files";

export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
export const MEDIA_TTL_MS = 24 * 60 * 60_000;
const MAX_PROFILE_MEDIA_BYTES = 500 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TOKEN = /^[a-f0-9-]{36}$/;
const PROFILE_DIRECTORY = /^[a-f0-9-]{36}$/;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 15_000;
const CLEANUP_INTERVAL_MS = 30 * 60_000;
let cleanupTimer: NodeJS.Timeout | null = null;
const activeTemps = new Set<string>();

const root = () => join(app.getPath("userData"), "media-cache");
const profileRoot = (profileId: string) => join(root(), profileId);
export const mediaUrl = (token: string) => `mmllm://media/${token}`;

function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, message: string) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 15_000);
    reader.read().then((value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

function assertExpected(detected: DetectedMedia | null, expected: MediaKind): DetectedMedia {
  if (detected?.mime === "video/mp4" && expected === "audio") {
    return { kind: "audio", mime: "audio/mp4", extension: "m4a" };
  }
  if (!detected || detected.kind !== expected) throw new Error("생성 결과가 허용된 이미지·오디오·비디오 형식이 아닙니다.");
  return detected;
}

async function finalizeTemp(temp: string, profileId: string, expected: MediaKind, tag = ""): Promise<string> {
  const handle = await open(temp, "r"); const header = Buffer.alloc(64);
  const { bytesRead } = await handle.read(header, 0, header.length, 0).finally(() => handle.close());
  const detected = assertExpected(detectMedia(header), expected);
  const token = randomUUID();
  await rename(temp, join(profileRoot(profileId), `${token}${tag}.${detected.extension}`));
  await cleanupProfileMedia(profileId);
  return mediaUrl(token);
}

export async function persistMediaBytes(bytes: Buffer, profileId: string, expected: MediaKind, tag = "",
  maxBytes = MAX_MEDIA_BYTES): Promise<string> {
  if (!bytes.length || bytes.length > Math.min(MAX_MEDIA_BYTES, maxBytes)) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
  assertExpected(detectMedia(bytes.subarray(0, 64)), expected);
  await mkdir(profileRoot(profileId), { recursive: true, mode: 0o700 });
  const temp = join(profileRoot(profileId), `.${randomUUID()}.tmp`);
  activeTemps.add(temp);
  try {
    await writeFile(temp, bytes, { mode: 0o600 });
    return await finalizeTemp(temp, profileId, expected, tag);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  } finally { activeTemps.delete(temp); }
}

export async function persistMediaResponse(response: Response, profileId: string, expected: MediaKind,
  maxBytes = MAX_MEDIA_BYTES, tag = ""): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
  const declared = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (declared && declared !== "application/octet-stream" && !declared.startsWith(`${expected}/`)) {
    throw new Error(`허용되지 않은 결과 형식입니다 (${declared}).`);
  }
  if (!response.body) throw new Error("생성 결과가 비어 있습니다.");
  await mkdir(profileRoot(profileId), { recursive: true, mode: 0o700 });
  const temp = join(profileRoot(profileId), `.${randomUUID()}.tmp`);
  activeTemps.add(temp);
  const output = createWriteStream(temp, { flags: "wx", mode: 0o600 });
  const reader = response.body.getReader(); let total = 0;
  try {
    while (true) {
      const part = await readWithIdleTimeout(reader, "결과 다운로드가 15초 동안 응답하지 않았습니다.");
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
      if (!output.write(Buffer.from(part.value))) await once(output, "drain");
    }
    output.end(); await once(output, "close");
    if (!total) throw new Error("생성 결과가 비어 있습니다.");
    return await finalizeTemp(temp, profileId, expected, tag);
  } catch (error) {
    output.destroy(); await reader.cancel().catch(() => undefined); await unlink(temp).catch(() => undefined); throw error;
  } finally { activeTemps.delete(temp); await reader.cancel().catch(() => undefined); }
}

export async function persistChatbotFileResponse(
  response: Response, profileId: string, expiresAt: number, maxBytes = MAX_CHATBOT_FILE_BYTES, expectedMime?: string
): Promise<{ mediaUrl: string; mime: string }> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("챗봇 파일이 50MB 안전 한도를 넘었습니다.");
  const responseMime = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  const normalizedExpected = expectedMime?.toLowerCase();
  if (normalizedExpected && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalizedExpected)) {
    throw new Error("챗봇 파일 MIME 형식이 올바르지 않습니다.");
  }
  if (normalizedExpected && responseMime && responseMime !== "application/octet-stream" && responseMime !== normalizedExpected) {
    throw new Error("챗봇 파일의 선언 MIME이 응답과 일치하지 않습니다.");
  }
  const declared = responseMime && responseMime !== "application/octet-stream" ? responseMime : normalizedExpected ?? responseMime;
  if (!response.body) throw new Error("챗봇 파일이 비어 있습니다.");
  await mkdir(profileRoot(profileId), { recursive: true, mode: 0o700 });
  const temp = join(profileRoot(profileId), `.${randomUUID()}.tmp`); activeTemps.add(temp);
  const output = createWriteStream(temp, { flags: "wx", mode: 0o600 });
  const reader = response.body.getReader(); let total = 0;
  try {
    while (true) {
      const part = await readWithIdleTimeout(reader, "챗봇 파일 다운로드가 15초 동안 응답하지 않았습니다.");
      if (part.done) break; total += part.value.byteLength;
      if (total > maxBytes) throw new Error("챗봇 파일이 50MB 안전 한도를 넘었습니다.");
      if (!output.write(Buffer.from(part.value))) await once(output, "drain");
    }
    output.end(); await once(output, "close");
    if (!total) throw new Error("챗봇 파일이 비어 있습니다.");
    const handle = await open(temp, "r"); const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, 64, 0).finally(() => handle.close());
    const media = detectMedia(header.subarray(0, bytesRead));
    const detected = media && (declared === "application/octet-stream" || declared === media.mime ||
      declared.startsWith(`${media.kind}/`)) ? media : detectChatbotDocument(header.subarray(0, bytesRead), declared);
    if (!detected) throw new Error(`허용되지 않거나 실제 형식과 다른 챗봇 파일입니다 (${declared || "unknown"}).`);
    const token = randomUUID();
    await rename(temp, join(profileRoot(profileId), `${token}-exp-${Math.floor(expiresAt)}.${detected.extension}`));
    await cleanupProfileMedia(profileId);
    return { mediaUrl: mediaUrl(token), mime: detected.mime };
  } catch (error) {
    output.destroy(); await unlink(temp).catch(() => undefined); throw error;
  } finally { activeTemps.delete(temp); await reader.cancel().catch(() => undefined); }
}

function wavHeader(pcmBytes: number): Buffer {
  const header = Buffer.alloc(44); header.write("RIFF", 0); header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcmBytes, 40); return header;
}

export async function persistPcmResponse(response: Response, profileId: string, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
  if (!response.body) throw new Error("생성 결과가 비어 있습니다.");
  await mkdir(profileRoot(profileId), { recursive: true, mode: 0o700 });
  const temp = join(profileRoot(profileId), `.${randomUUID()}.tmp`);
  activeTemps.add(temp);
  const output = createWriteStream(temp, { flags: "wx", mode: 0o600 });
  output.write(wavHeader(0));
  const reader = response.body.getReader(); let total = 0;
  try {
    while (true) {
      const part = await readWithIdleTimeout(reader, "음성 다운로드가 15초 동안 응답하지 않았습니다.");
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
      if (!output.write(Buffer.from(part.value))) await once(output, "drain");
    }
    output.end(); await once(output, "close");
    const handle = await open(temp, "r+");
    await handle.write(wavHeader(total), 0, 44, 0).finally(() => handle.close());
    return await finalizeTemp(temp, profileId, "audio");
  } catch (error) {
    output.destroy(); await unlink(temp).catch(() => undefined); throw error;
  } finally { activeTemps.delete(temp); await reader.cancel().catch(() => undefined); }
}

function normalizedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function resolvePublicAddress(url: URL, signal: AbortSignal): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("공개 HTTPS 미디어 주소만 사용할 수 있습니다.");
  }
  const hostname = normalizedHostname(url.hostname);
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] :
    await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address))) {
    throw new Error("사설 네트워크로 연결되는 주소는 사용할 수 없습니다.");
  }
  const selected = addresses[0];
  if (selected.family !== 4 && selected.family !== 6) throw new Error("결과 다운로드 주소를 확인할 수 없습니다.");
  return { address: selected.address, family: selected.family };
}

function responseHeaders(values: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, String(value));
  }
  return headers;
}

export async function pinnedHttpsRequest(url: URL, signal: AbortSignal): Promise<Response> {
  const selected = await resolvePublicAddress(url, signal);
  signal.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = httpsRequest(url, {
      family: selected.family,
      servername: normalizedHostname(url.hostname),
      agent: false,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family)
    }, (incoming: IncomingMessage) => {
      if (settled) { incoming.destroy(); return; }
      settled = true;
      const body = Readable.toWeb(incoming) as unknown as BodyInit;
      resolve(new Response(body, {
        status: incoming.statusCode ?? 500,
        statusText: incoming.statusMessage,
        headers: responseHeaders(incoming.headers)
      }));
    });
    request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error("결과 다운로드가 15초 동안 응답하지 않았습니다."));
    });
    request.once("error", finishError);
    const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason :
      new Error("결과 다운로드 시간이 초과되었습니다."));
    signal.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal.removeEventListener("abort", abort));
    request.end();
  });
}

export async function downloadRemoteMedia(rawUrl: string, profileId: string, expected: MediaKind): Promise<string> {
  let url = new URL(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("결과 다운로드 시간이 초과되었습니다.")),
    DOWNLOAD_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await pinnedHttpsRequest(url, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === MAX_REDIRECTS) throw new Error("결과 다운로드의 리디렉션이 너무 많습니다.");
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new Error("결과 다운로드 주소가 올바르지 않습니다.");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`결과 다운로드가 실패했습니다 (${response.status}).`);
      return await persistMediaResponse(response, profileId, expected);
    }
    throw new Error("결과 다운로드가 실패했습니다.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function persistMediaCandidate(value: string, profileId: string, expected: MediaKind): Promise<string> {
  if (value.startsWith("https://")) return downloadRemoteMedia(value, profileId, expected);
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value);
  const encoded = match ? match[2] : value;
  if (encoded.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 8) throw new Error("생성 결과 파일이 허용 크기를 넘었습니다.");
  return persistMediaBytes(Buffer.from(encoded, "base64"), profileId, expected);
}

async function findMediaPath(profileId: string, token: string): Promise<{ path: string; detected: DetectedMedia }> {
  if (!TOKEN.test(token)) throw new Error("미디어 토큰이 올바르지 않습니다.");
  const names = await readdir(profileRoot(profileId)).catch(() => [] as string[]);
  const name = names.find((item) => item.startsWith(`${token}.`) && !item.endsWith(".tmp"));
  const taggedName = names.find((item) => item.startsWith(`${token}-exp-`) && !item.endsWith(".tmp"));
  const storedName = name ?? taggedName;
  if (!storedName) throw new Error("미디어 결과가 만료되었거나 존재하지 않습니다.");
  const expiry = storedName.match(/-exp-(\d+)\./)?.[1];
  if (expiry && Number(expiry) <= Date.now()) {
    await unlink(join(profileRoot(profileId), storedName)).catch(() => undefined);
    throw new Error("미디어 결과가 만료되었거나 존재하지 않습니다.");
  }
  const path = join(profileRoot(profileId), storedName);
  const details = await lstat(path).catch(() => null);
  if (!details?.isFile() || Date.now() - details.mtimeMs > MEDIA_TTL_MS) {
    await unlink(path).catch(() => undefined);
    throw new Error("미디어 결과가 만료되었거나 존재하지 않습니다.");
  }
  const handle = await open(path, "r");
  const header = Buffer.alloc(64);
  const { bytesRead } = await handle.read(header, 0, header.length, 0).finally(() => handle.close());
  const extension = storedName.split(".").pop()?.toLowerCase() ?? "";
  const documentMime: Record<string, string> = { pdf: "application/pdf", docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv" };
  const detected = detectMedia(header.subarray(0, bytesRead)) ??
    (documentMime[extension] ? detectChatbotDocument(header.subarray(0, bytesRead), documentMime[extension]) : undefined);
  if (!detected) throw new Error("미디어 결과 형식이 올바르지 않습니다.");
  return { path, detected };
}

export function mediaTokenFromUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "mmllm:" || url.hostname !== "media") throw new Error("미디어 주소가 올바르지 않습니다.");
  const token = url.pathname.replace(/^\/+/, "");
  if (!TOKEN.test(token)) throw new Error("미디어 토큰이 올바르지 않습니다.");
  return token;
}

export async function resolveMedia(profileId: string, token: string) { return findMediaPath(profileId, token); }

export async function saveMediaTo(profileId: string, value: string, destination: string): Promise<void> {
  const { path } = await findMediaPath(profileId, mediaTokenFromUrl(value));
  await copyFile(path, destination);
}

/** Deletes only a validated token belonging to the active profile. */
export async function releaseMedia(profileId: string, value: string): Promise<void> {
  const token = mediaTokenFromUrl(value);
  const names = await readdir(profileRoot(profileId)).catch(() => [] as string[]);
  const name = names.find((item) => (item.startsWith(`${token}.`) || item.startsWith(`${token}-exp-`)) && !item.endsWith(".tmp"));
  if (name) await unlink(join(profileRoot(profileId), name)).catch(() => undefined);
}

export async function cleanupProfileMedia(profileId: string, now = Date.now()): Promise<void> {
  const directory = profileRoot(profileId); const names = await readdir(directory).catch(() => [] as string[]);
  const files = (await Promise.all(names.map(async (name) => {
    const path = join(directory, name); const details = await lstat(path).catch(() => null);
    return details?.isFile() ? { path, mtime: details.mtimeMs, size: details.size } : null;
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const expired = (path: string) => { const value = path.match(/-exp-(\d+)\./)?.[1]; return value ? Number(value) <= now : false; };
  for (const item of files.filter((entry) => expired(entry.path) || now - entry.mtime > MEDIA_TTL_MS ||
    entry.path.endsWith(".tmp") && !activeTemps.has(entry.path))) {
    await unlink(item.path).catch(() => undefined);
  }
  const remaining = files.filter((entry) => !expired(entry.path) && now - entry.mtime <= MEDIA_TTL_MS && !entry.path.endsWith(".tmp"))
    .sort((a, b) => b.mtime - a.mtime);
  let total = remaining.reduce((sum, item) => sum + item.size, 0);
  for (const item of remaining.reverse()) {
    if (total <= MAX_PROFILE_MEDIA_BYTES) break;
    await unlink(item.path).catch(() => undefined); total -= item.size;
  }
}

/** Sweeps every on-disk profile directory so orphaned caches are covered without consulting the profile registry. */
export async function cleanupAllProfileMedia(now = Date.now()): Promise<void> {
  const entries = await readdir(root(), { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isDirectory() && PROFILE_DIRECTORY.test(entry.name))
    .map((entry) => cleanupProfileMedia(entry.name, now)));
}

export function startMediaCacheSweeper(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => { void cleanupAllProfileMedia(); }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopMediaCacheSweeper(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

export async function clearProfileMedia(profileId: string): Promise<void> {
  await rm(profileRoot(profileId), { recursive: true, force: true });
}
