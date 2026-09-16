import { app } from "electron";
import { mockModels } from "./mock";
import type {
  AudioRequest, CreditBalance, GatewayModel, ImageRequest, MediaResult, VideoRequest
} from "../shared/contracts";

export const GATEWAY = "https://factchat-cloud.mindlogic.ai/v1/gateway";
let apiKey: string | null = null;
let models: GatewayModel[] = [];
const allowedMedia = new Set<string>();
const MOCK = process.env.MM_LLM_MOCK === "1" && !app.isPackaged;

export function setGatewayKey(key: string | null): void {
  apiKey = key;
  if (!key) {
    models = [];
    allowedMedia.clear();
  }
}

function requireKey(): string {
  if (!apiKey) throw new Error("API 키를 먼저 입력해 주세요.");
  return apiKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function operationPath(value: string): string {
  const parts = value.split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("작업 ID 형식이 올바르지 않습니다.");
  }
  return parts.map(encodeURIComponent).join("/");
}

async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireKey()}`);
  headers.set("User-Agent", "MM_LLM/0.1");
  const response = await fetch(`${GATEWAY}${path}`, { ...init, headers });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 400) throw new GatewayError(400, "입력 형식이나 모델 설정을 확인해 주세요.");
    if (response.status === 401) throw new GatewayError(401, "API 키가 유효하지 않습니다.");
    if (response.status === 402) throw new GatewayError(402, "크레딧 잔액이 부족합니다.");
    if (response.status === 403) throw new GatewayError(403, "이 모델 또는 Gateway API에 대한 접근 권한이 없습니다.");
    if (response.status === 404) throw new GatewayError(404, "모델 또는 작업을 찾을 수 없습니다. 모델 목록을 새로고침해 주세요.");
    if (response.status === 413) throw new GatewayError(413, "첨부 자료가 API의 25MB 한도를 넘었습니다.");
    if (response.status === 429) throw new GatewayError(429, "요청이 많아 잠시 제한됐습니다. 잠시 후 다시 시도해 주세요.");
    throw new GatewayError(response.status, `ChatKHU API 오류 (${response.status}). 잠시 후 다시 시도해 주세요.`);
  }
  return response;
}

export class GatewayError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function listModels(): Promise<GatewayModel[]> {
  if (MOCK) {
    requireKey();
    models = mockModels;
    return models;
  }
  const response = await gatewayFetch("/models/");
  const json = await response.json() as Record<string, unknown>;
  const data = Array.isArray(json.data) ? json.data : [];
  models = data.filter(isRecord).flatMap((item): GatewayModel[] => {
    if (typeof item.id !== "string" || !["llm", "audio", "image", "video"].includes(asText(item.type))) {
      return [];
    }
    return [{
      id: item.id,
      type: item.type as GatewayModel["type"],
      owned_by: asText(item.owned_by),
      audio_client: asText(item.audio_client),
      profile_image_url: asText(item.profile_image_url)
    }];
  });
  return models;
}

export function currentModels(): GatewayModel[] {
  return models;
}

export function assertModel(id: string, type: GatewayModel["type"]): GatewayModel {
  const model = models.find((item) => item.id === id && item.type === type);
  if (!model) throw new Error("현재 API 키로 사용할 수 없는 모델입니다. 모델 목록을 새로고침해 주세요.");
  return model;
}

export async function getCredits(): Promise<CreditBalance> {
  if (MOCK) return { total: { quota: 1000, used: 120, remaining: 880 } };
  return gatewayFetch("/credits/").then((response) => response.json() as Promise<CreditBalance>);
}

function jsonInit(body: unknown, signal?: AbortSignal): RequestInit {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > 22 * 1024 * 1024) {
    throw new Error("전송할 자료가 API 한도에 가깝습니다. 첨부 파일을 줄여 주세요.");
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serialized,
    signal
  };
}

async function* parseSse(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error("스트리밍 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        buffer = buffer.slice(boundary + separator.length);
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        const parsed = JSON.parse(data) as unknown;
        if (isRecord(parsed)) {
          if (isRecord(parsed.error)) throw new Error("모델 스트리밍이 중단됐습니다. 크레딧과 모델 상태를 확인해 주세요.");
          yield parsed;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function* streamChat(
  modelId: string,
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>,
  signal: AbortSignal
): AsyncGenerator<string> {
  const model = assertModel(modelId, "llm");
  if (MOCK) {
    for (const delta of ["의료경영 분석을 ", "시작하겠습니다. ", "핵심 지표와 근거를 함께 확인해요."]) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield delta;
    }
    return;
  }
  const payload = { model: modelId, messages, stream: true, stream_options: { include_usage: true } };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 22 * 1024 * 1024) {
    throw new Error("대화와 첨부 자료의 크기가 API 한도에 가깝습니다. 파일을 줄이거나 새 대화를 시작해 주세요.");
  }
  let response: Response;
  try {
    response = await gatewayFetch("/chat/completions/", jsonInit(payload, signal));
  } catch (error) {
    if (!(error instanceof GatewayError) || error.status !== 404 || model.owned_by !== "openai") throw error;
    const input = messages.map((message) => ({ role: message.role, content: message.content }));
    response = await gatewayFetch("/responses/", jsonInit({ model: modelId, input, stream: true }, signal));
    for await (const event of parseSse(response)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        yield event.delta;
      }
      if (event.type === "response.failed") throw new Error("모델 응답이 실패했습니다.");
    }
    return;
  }

  for await (const event of parseSse(response)) {
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = choices[0];
    if (!isRecord(choice) || !isRecord(choice.delta)) continue;
    const content = choice.delta.content;
    if (typeof content === "string" && content) yield content;
  }
}

function mediaUrls(value: Record<string, unknown>): string[] {
  const data = Array.isArray(value.data) ? value.data : [];
  const urls = data.filter(isRecord).flatMap((item) => {
    const url = asText(item.url) || asText(item.b64_json);
    if (!url) return [];
    return [url.startsWith("data:") || url.startsWith("https://") ? url : `data:image/png;base64,${url}`];
  });
  for (const url of urls) allowedMedia.add(url);
  return urls;
}

export async function generateImage(
  request: ImageRequest,
  inputImages: string[]
): Promise<MediaResult> {
  assertModel(request.modelId, "image");
  if (MOCK) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><defs><linearGradient id="g"><stop stop-color="#e7d4ef"/><stop offset="1" stop-color="#dce8f0"/></linearGradient></defs><rect width="720" height="420" rx="32" fill="url(#g)"/><circle cx="520" cy="180" r="110" fill="#fff" opacity=".4"/><text x="58" y="220" font-family="Arial" font-size="34" fill="#665579">MM_LLM test image</text></svg>`;
    const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    allowedMedia.add(url);
    return { urls: [url], status: "completed" };
  }
  const response = await gatewayFetch("/images/generate/", jsonInit({
    model: request.modelId,
    prompt: request.prompt,
    number_of_images: 1,
    ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    ...(inputImages.length ? { input_images: inputImages } : {})
  }));
  const result = await response.json() as Record<string, unknown>;
  if (typeof result.operation_id === "string") {
    const operationId = result.operation_id;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await gatewayFetch(`/images/generate/${operationPath(operationId)}/?model=${encodeURIComponent(request.modelId)}`);
      const state = await poll.json() as Record<string, unknown>;
      if (state.status === "failed") throw new Error(asText(state.error) || "이미지 생성이 실패했습니다.");
      if (state.status === "completed") return { urls: mediaUrls(state), status: "completed" };
    }
    return { operationId, status: "processing" };
  }
  return { urls: mediaUrls(result), status: "completed" };
}

export async function generateVideo(
  request: VideoRequest,
  inputUrls: string[]
): Promise<MediaResult> {
  assertModel(request.modelId, "video");
  if (MOCK) return { operationId: "mock-video", status: "processing" };
  const response = await gatewayFetch("/video/generation/", jsonInit({
    model: request.modelId,
    prompt: request.prompt,
    parameters: request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {},
    ...(inputUrls.length ? { input_urls: inputUrls } : {})
  }));
  const result = await response.json() as Record<string, unknown>;
  const operationId = asText(result.operation_id);
  if (!operationId) throw new Error("비디오 작업 ID가 반환되지 않았습니다.");
  return { operationId, status: asText(result.status) || "processing" };
}

export async function pollVideo(operationId: string, modelId: string): Promise<MediaResult> {
  assertModel(modelId, "video");
  if (MOCK) return { operationId, status: "completed" };
  const response = await gatewayFetch(
    `/video/generation/${operationPath(operationId)}/?model=${encodeURIComponent(modelId)}`
  );
  const result = await response.json() as Record<string, unknown>;
  const url = asText(result.video_uri) || asText(result.video_url) || asText(result.url);
  if (result.status === "completed") {
    if (url.startsWith("https://")) {
      allowedMedia.add(url);
      return { operationId, status: "completed", videoUrl: url };
    }
    const download = await gatewayFetch(
      `/video/generation/${operationPath(operationId)}/download/?model=${encodeURIComponent(modelId)}`
    );
    const bytes = Buffer.from(await download.arrayBuffer());
    const videoUrl = `data:video/mp4;base64,${bytes.toString("base64")}`;
    allowedMedia.add(videoUrl);
    return { operationId, status: "completed", videoUrl };
  }
  return { operationId, status: asText(result.status), videoUrl: url };
}

function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function runAudio(
  request: AudioRequest,
  audioFile?: { name: string; mime: string; bytes: Buffer }
): Promise<MediaResult> {
  const model = assertModel(request.modelId, "audio");
  if (MOCK) {
    if (request.lane === "stt") return { text: "모의 받아쓰기 결과입니다.", status: "completed" };
    const pcm = Buffer.alloc(24000 * 2);
    const url = `data:audio/wav;base64,${pcmToWav(pcm).toString("base64")}`;
    allowedMedia.add(url);
    return { audioUrl: url, status: "completed" };
  }
  if (request.lane === "tts") {
    if (["google_lyria3", "elevenlabs", "soniox"].includes(model.audio_client ?? "")) throw new Error("음성 합성 모델을 선택해 주세요.");
    const response = await gatewayFetch("/audio/speech/", jsonInit({
      model: request.modelId,
      input: request.input,
      voice: request.voice || "Aoede"
    }));
    const pcm = Buffer.from(await response.arrayBuffer());
    const url = `data:audio/wav;base64,${pcmToWav(pcm).toString("base64")}`;
    allowedMedia.add(url);
    return { audioUrl: url, status: "completed" };
  }
  if (request.lane === "music") {
    if (!["google_lyria3", "elevenlabs"].includes(model.audio_client ?? "")) throw new Error("음악·효과음 모델을 선택해 주세요.");
    const response = await gatewayFetch("/audio/music/", jsonInit({ model: request.modelId, prompt: request.prompt }));
    const bytes = Buffer.from(await response.arrayBuffer());
    const url = `data:audio/mpeg;base64,${bytes.toString("base64")}`;
    allowedMedia.add(url);
    return { audioUrl: url, status: "completed" };
  }
  if (model.audio_client !== "soniox") throw new Error("받아쓰기 모델을 선택해 주세요.");
  if (!audioFile) throw new Error("오디오 파일을 선택해 주세요.");
  const form = new FormData();
  form.set("model", request.modelId);
  form.set("file", new Blob([new Uint8Array(audioFile.bytes)], { type: audioFile.mime }), audioFile.name);
  const response = await gatewayFetch("/audio/transcriptions/", { method: "POST", body: form });
  const started = await response.json() as Record<string, unknown>;
  const operationId = asText(started.operation_id);
  if (!operationId) return { text: asText(started.text), status: "completed" };
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const poll = await gatewayFetch(`/audio/transcriptions/${operationPath(operationId)}/`);
    const state = await poll.json() as Record<string, unknown>;
    if (state.status === "completed") return { text: asText(state.text), status: "completed" };
    if (state.status === "failed") throw new Error(asText(state.error) || "받아쓰기가 실패했습니다.");
  }
  return { operationId, status: "processing" };
}

export function isAllowedMedia(url: string): boolean {
  return allowedMedia.has(url);
}
