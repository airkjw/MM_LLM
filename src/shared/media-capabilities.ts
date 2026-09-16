import type { AudioRequest, GatewayModel, ImageRequest, VideoRequest } from "./contracts";

export const MEDIA_DOCS = {
  models: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models", lastVerified: "2026-09-16" },
  image: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/image-generation", lastVerified: "2026-09-16" },
  video: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/video-generation", lastVerified: "2026-09-16" },
  tts: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-tts", lastVerified: "2026-09-16" },
  stt: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-stt", lastVerified: "2026-09-16" },
  music: { url: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-music", lastVerified: "2026-09-16" }
} as const;

export const TTS_VOICES = [
  "Aoede", "Achernar", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore",
  "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr", "Achird",
  "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus", "Orus",
  "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi"
] as const;

export type ImageCapability = {
  countMax: number;
  aspectRatios?: readonly string[];
  quality?: readonly string[];
  backgrounds?: readonly string[];
  sizes?: readonly string[];
  sizeField?: "size" | "image_size" | "resolution";
  inputImageMax: number;
  creditsPerImage?: number;
};

const COMMON_RATIOS = ["1:1", "16:9", "9:16", "4:3"] as const;
const GPT_IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
const IMAGE: Record<string, ImageCapability> = {
  "gpt-image-2": { countMax: 1, quality: ["low", "medium", "high"], backgrounds: ["auto", "opaque"],
    sizes: GPT_IMAGE_SIZES, sizeField: "size", inputImageMax: 10, creditsPerImage: 53 },
  "gpt-image-1.5": { countMax: 1, quality: ["low", "medium", "high"], backgrounds: ["auto", "transparent", "opaque"],
    sizes: GPT_IMAGE_SIZES, sizeField: "size", inputImageMax: 10, creditsPerImage: 39 },
  "gpt-image-1": { countMax: 1, quality: ["low", "medium", "high"], backgrounds: ["auto", "transparent", "opaque"],
    sizes: GPT_IMAGE_SIZES, sizeField: "size", inputImageMax: 10, creditsPerImage: 42 },
  "gpt-image-1-mini": { countMax: 1, quality: ["low", "medium", "high"], backgrounds: ["auto", "transparent", "opaque"],
    sizes: GPT_IMAGE_SIZES, sizeField: "size", inputImageMax: 10, creditsPerImage: 8 },
  "gemini-3.1-flash-image-preview": { countMax: 4, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "image_size", inputImageMax: 14, creditsPerImage: 69 },
  "gemini-3-pro-image-preview": { countMax: 4, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "image_size", inputImageMax: 10, creditsPerImage: 140 },
  "gemini-3.1-flash-lite-image": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "image_size", inputImageMax: 14, creditsPerImage: 34 },
  "gemini-2.5-flash-image": { countMax: 4, aspectRatios: COMMON_RATIOS, inputImageMax: 10, creditsPerImage: 39 },
  "black-forest-labs/flux-2-pro": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["1MP", "2MP", "4MP"], sizeField: "resolution", inputImageMax: 8, creditsPerImage: 30 },
  "black-forest-labs/flux-1.1-pro": { countMax: 1, aspectRatios: COMMON_RATIOS, inputImageMax: 1, creditsPerImage: 40 },
  "bytedance/seedream-4": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "size", inputImageMax: 10, creditsPerImage: 30 },
  "bytedance/seedream-5-pro": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "image_size", inputImageMax: 10, creditsPerImage: 90 },
  "runwayml/gen4-image": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["720p", "1080p"], sizeField: "resolution", inputImageMax: 3, creditsPerImage: 80 },
  "stability-ai/sdxl": { countMax: 1, inputImageMax: 1, creditsPerImage: 5 },
  "fal-ai/bytedance/seedream/v5/lite": { countMax: 1, aspectRatios: COMMON_RATIOS, sizes: ["1K", "2K", "4K"], sizeField: "image_size", inputImageMax: 10, creditsPerImage: 35 },
  "fal-ai/bytedance/seedream/v4.5": { countMax: 1, sizes: ["square", "landscape", "portrait", "2K", "4K"], sizeField: "image_size", inputImageMax: 10, creditsPerImage: 40 },
  "fal-ai/ideogram/v3": { countMax: 1, aspectRatios: COMMON_RATIOS, inputImageMax: 1, creditsPerImage: 60 },
  "fal-ai/recraft/v4/text-to-image": { countMax: 1, aspectRatios: COMMON_RATIOS, inputImageMax: 0, creditsPerImage: 40 },
  "xai/grok-imagine-image": { countMax: 1, aspectRatios: COMMON_RATIOS, inputImageMax: 1, creditsPerImage: 20 }
};

export type VideoCapability = {
  durationField?: "duration" | "duration_seconds";
  durations?: readonly number[];
  durationRange?: readonly [number, number];
  aspectRatios?: readonly string[];
  resolutionField?: "resolution" | "quality";
  resolutions?: readonly string[];
  inputImageMax: number;
  creditsPerVideo?: number;
  modes?: readonly ("standard" | "pro")[];
  generateAudio?: boolean;
  loop?: boolean;
  audio?: boolean;
};

const VIDEO: Record<string, VideoCapability> = {
  "veo-3.1-generate-preview": { durationField: "duration_seconds", durations: [4, 6, 8], aspectRatios: ["16:9", "9:16"], inputImageMax: 1, creditsPerVideo: 1600 },
  "bytedance/seedance-2.5": { durationField: "duration", durations: [5, 10, 15, 30], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["480p", "720p"], inputImageMax: 1, creditsPerVideo: 1165 },
  "fal-ai/vidu/q3": { durationField: "duration", durationRange: [2, 16], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["360p", "540p", "720p", "1080p"], audio: true,
    inputImageMax: 1, creditsPerVideo: 770 },
  "bytedance/seedance-2.0": { durationField: "duration", durations: [5, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["720p", "1080p"], inputImageMax: 1, creditsPerVideo: 756 },
  "lightricks/ltx-2.5/pro": { durationField: "duration", durations: [6, 8, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["720p", "1080p"], generateAudio: true,
    inputImageMax: 1, creditsPerVideo: 720 },
  "bytedance/seedance-2.0/fast": { durationField: "duration", durations: [5, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["720p"], inputImageMax: 1, creditsPerVideo: 605 },
  "veo-3.1-fast-generate-preview": { durationField: "duration_seconds", durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"], inputImageMax: 1, creditsPerVideo: 600 },
  "lightricks/ltx-2.5/fast": { durationField: "duration", durations: [6, 8, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["720p", "1080p"], generateAudio: true,
    inputImageMax: 1, creditsPerVideo: 540 },
  "fal-ai/luma-dream-machine/ray-2": { durationField: "duration", durations: [5, 9], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["540p", "720p", "1080p"], loop: true,
    inputImageMax: 1, creditsPerVideo: 500 },
  "fal-ai/kling-video/o3": { durationField: "duration", durationRange: [3, 15], aspectRatios: COMMON_RATIOS,
    modes: ["standard", "pro"], generateAudio: true, inputImageMax: 1, creditsPerVideo: 420 },
  "fal-ai/kling-video/v3": { durationField: "duration", durationRange: [3, 15], aspectRatios: COMMON_RATIOS,
    modes: ["standard", "pro"], generateAudio: true, inputImageMax: 1, creditsPerVideo: 420 },
  "kwaivgi/kling-v2.5-turbo-pro": { durationField: "duration", durations: [5, 10], aspectRatios: COMMON_RATIOS,
    inputImageMax: 1, creditsPerVideo: 350 },
  "pixverse/pixverse-v5": { durationField: "duration", durations: [5, 8], aspectRatios: COMMON_RATIOS,
    resolutionField: "quality", resolutions: ["360p", "480p", "540p", "720p", "1080p"], inputImageMax: 1, creditsPerVideo: 300 },
  "xai/grok-imagine-video": { durationField: "duration", durationRange: [1, 15], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["480p", "720p"], inputImageMax: 1, creditsPerVideo: 300 },
  "minimax/hailuo-02": { durationField: "duration", durations: [6], resolutionField: "resolution",
    resolutions: ["768p", "1080p"], inputImageMax: 1, creditsPerVideo: 270 },
  "bytedance/seedance-1-pro": { durationField: "duration", durationRange: [2, 12], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["480p", "720p", "1080p"], inputImageMax: 1, creditsPerVideo: 256 },
  "veo-3.1-lite-generate-preview": { durationField: "duration_seconds", durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"], inputImageMax: 1, creditsPerVideo: 200 },
  "bytedance/seedance-1.5-pro": { durationField: "duration", durations: [5, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["480p", "720p", "1080p"], inputImageMax: 1, creditsPerVideo: 130 },
  "bytedance/seedance-1.0-pro/fast": { durationField: "duration", durations: [5, 10], aspectRatios: COMMON_RATIOS,
    resolutionField: "resolution", resolutions: ["480p", "720p", "1080p"], inputImageMax: 1, creditsPerVideo: 97 }
};
export const VIDEO_MODEL_IDS = Object.freeze(Object.keys(VIDEO));

export type MusicCapability = {
  lyrics: boolean;
  instrumental: boolean;
  duration?: readonly [number, number];
  defaultDuration?: number;
  creditsFixed?: number;
  creditsPerSecond?: number;
  exactDurationBilling: boolean;
};

const MUSIC: Record<string, MusicCapability> = {
  "lyria-3-pro-preview": { lyrics: true, instrumental: false, creditsFixed: 80, exactDurationBilling: false },
  "lyria-3-clip-preview": { lyrics: false, instrumental: false, creditsFixed: 40, exactDurationBilling: false },
  "elevenlabs-music": { lyrics: true, instrumental: true, duration: [1, 180], defaultDuration: 30, creditsPerSecond: 2.5, exactDurationBilling: true },
  "elevenlabs-sfx": { lyrics: false, instrumental: false, duration: [1, 30], creditsPerSecond: 6, exactDurationBilling: false }
};

export function imageCapability(modelId: string): ImageCapability | undefined { return IMAGE[modelId]; }
export function videoCapability(modelId: string): VideoCapability | undefined { return VIDEO[modelId]; }
export function musicCapability(modelId: string): MusicCapability | undefined { return MUSIC[modelId]; }
export type AudioLane = "tts" | "stt" | "music";
export function audioLaneForModel(model: GatewayModel): AudioLane | undefined {
  if (model.type !== "audio") return undefined;
  if (model.audio_client === "soniox") return "stt";
  if (model.audio_client === "google_lyria3" || model.audio_client === "elevenlabs") return "music";
  return "tts";
}
export function supportsMultiSpeakerTts(model: GatewayModel): boolean {
  return audioLaneForModel(model) === "tts" && /tts/i.test(model.id);
}

export function imageRequestPayload(request: ImageRequest, inputImages: string[]): Record<string, unknown> {
  const capability = imageCapability(request.modelId);
  const body: Record<string, unknown> = { model: request.modelId, prompt: request.prompt,
    number_of_images: request.numberOfImages ?? 1 };
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (request.quality) body.quality = request.quality;
  if (request.background) body.background = request.background;
  if (request.imageSize && capability?.sizeField) body[capability.sizeField] = request.imageSize;
  if (inputImages.length) body.input_images = inputImages;
  return body;
}

export function videoRequestPayload(request: VideoRequest, inputUrls: string[]): Record<string, unknown> {
  const capability = videoCapability(request.modelId);
  const parameters: Record<string, unknown> = {};
  if (request.aspectRatio) parameters.aspect_ratio = request.aspectRatio;
  if (request.durationSeconds !== undefined && capability?.durationField) {
    parameters[capability.durationField] = request.durationSeconds;
  }
  if (request.resolution && capability?.resolutionField) parameters[capability.resolutionField] = request.resolution;
  if (request.mode) parameters.mode = request.mode;
  if (request.audio !== undefined && capability?.generateAudio) parameters.generate_audio = request.audio;
  if (request.loop !== undefined) parameters.loop = request.loop;
  if (request.audio !== undefined && capability?.audio) parameters.audio = request.audio;
  return { model: request.modelId, prompt: request.prompt, parameters,
    ...(inputUrls.length ? { input_urls: inputUrls } : {}) };
}

export function ttsRequestPayload(request: Extract<AudioRequest, { lane: "tts" }>): Record<string, unknown> {
  return { model: request.modelId, input: request.input,
    ...(request.speakers ? { speakers: request.speakers } : { voice: request.voice || "Aoede" }) };
}

export function musicRequestPayload(request: Extract<AudioRequest, { lane: "music" }>): Record<string, unknown> {
  return { model: request.modelId, prompt: request.prompt,
    ...(request.lyrics ? { lyrics: request.lyrics } : {}),
    ...(request.durationSeconds !== undefined ? { duration_seconds: request.durationSeconds } : {}),
    ...(request.instrumental !== undefined ? { instrumental: request.instrumental } : {}) };
}

export function imageEstimate(modelId: string, count: number): string {
  const unit = imageCapability(modelId)?.creditsPerImage;
  return unit === undefined ? "예상 비용: 공식 단가를 확인할 수 없습니다." : `예상 ${unit * count} 크레딧 (${unit} × ${count}장)`;
}

export function videoEstimate(modelId: string): string {
  const value = videoCapability(modelId)?.creditsPerVideo;
  return value === undefined ? "예상 비용: 공식 단가를 확인할 수 없습니다." : `예상 ${value.toLocaleString("ko-KR")} 크레딧/영상`;
}

export function musicEstimate(modelId: string, duration?: number): string {
  const capability = musicCapability(modelId);
  if (!capability) return "예상 비용: 공식 단가를 확인할 수 없습니다.";
  if (capability.creditsFixed !== undefined) return `예상 ${capability.creditsFixed} 크레딧/호출`;
  if (capability.creditsPerSecond !== undefined && capability.exactDurationBilling) {
    const seconds = duration ?? capability.defaultDuration;
    return seconds === undefined ? "예상 비용: 생성 길이가 정해진 뒤 확정됩니다." :
      `예상 ${seconds * capability.creditsPerSecond} 크레딧 (${seconds}초)`;
  }
  if (capability.creditsPerSecond !== undefined && capability.duration) {
    return `예상 0–${capability.duration[1] * capability.creditsPerSecond} 크레딧 · 실제 생성 길이 기준`;
  }
  return "예상 비용: 생성 결과에 따라 확정됩니다.";
}

export function sttEstimate(durationSeconds?: number): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return "예상 비용: 오디오 길이를 읽으면 표시됩니다. (분당 6 크레딧)";
  return `예상 ${(durationSeconds / 60 * 6).toFixed(1)} 크레딧 · 실제 측정 길이 기준`;
}

export function isRecentlyAdded(created: number | undefined, now = Date.now(), days = 45): boolean {
  if (!Number.isFinite(created) || !created) return false;
  const age = now - created * 1000;
  return age >= -24 * 60 * 60_000 && age <= days * 24 * 60 * 60_000;
}
