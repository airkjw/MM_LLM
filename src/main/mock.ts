import type { GatewayModel } from "../shared/contracts";

const llmIds = [
  "gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5",
  "claude-sonnet-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5",
  "claude-opus-4-8", "claude-haiku-4-5-20251001",
  "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash",
  "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview",
  "grok-4.6", "grok-4.5", "grok-4-1-fast", "google/gemma-4-31B-it",
  "muse-spark-1.3", "sonar-pro", "sonar-reasoning-pro", "solar-pro4",
  "qwen3.8-max", "qwen3.7-plus", "qwen3.7-max", "glm-5.3-flash",
  "glm-5.3", "glm-5.2", "kimi-k3", "seed-2-0-pro-260328",
  "seed-2-0-lite-260428", "deepseek-v4-pro", "deepseek-v4-flash"
];

function owner(id: string): string {
  if (id.startsWith("gpt")) return "openai";
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("gemini") || id.startsWith("google/")) return "gemini";
  if (id.startsWith("grok")) return "xai";
  if (id.startsWith("sonar")) return "perplexity";
  if (id.startsWith("solar")) return "upstage";
  return "other";
}

export const mockModels: GatewayModel[] = [
  ...llmIds.map((id): GatewayModel => ({ id, type: "llm", owned_by: owner(id) })),
  { id: "gemini-3.1-flash-image-preview", type: "image", owned_by: "gemini" },
  { id: "gemini-3.1-flash-tts-preview", type: "audio", owned_by: "gemini", audio_client: "google" },
  { id: "stt-async-v5", type: "audio", owned_by: "soniox", audio_client: "soniox" },
  { id: "lyria-3-clip-preview", type: "audio", owned_by: "google", audio_client: "google_lyria3" },
  { id: "veo-3.1-fast-generate-preview", type: "video", owned_by: "google" }
];

if (llmIds.length !== 36) throw new Error("Mock LLM catalog must match the 36 supplied models.");
