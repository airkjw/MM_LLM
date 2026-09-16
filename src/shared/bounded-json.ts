export const MAX_STT_JSON_BYTES = 8 * 1024 * 1024;

/** Reads a JSON response without ever buffering more than the declared limit. */
export async function readJsonResponseWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("받아쓰기 응답이 로컬 저장 한도를 넘었습니다.");
  }
  if (!response.body) throw new Error("받아쓰기 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("받아쓰기 응답이 로컬 저장 한도를 넘었습니다.");
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error("받아쓰기 응답 JSON 형식이 올바르지 않습니다."); }
}
