import type { GatewayModel } from "./contracts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Parses only fields documented by the live /models endpoint. */
export function parseGatewayModels(value: unknown): GatewayModel[] {
  const root = record(value); const data = root && Array.isArray(root.data) ? root.data : [];
  return data.flatMap((raw): GatewayModel[] => {
    const item = record(raw); const id = text(item?.id); const type = text(item?.type);
    if (!item || !id || !type || !["llm", "audio", "image", "video"].includes(type)) return [];
    return [{ id, type: type as GatewayModel["type"], object: text(item.object),
      created: typeof item.created === "number" && Number.isFinite(item.created) ? item.created : undefined,
      owned_by: text(item.owned_by), profile_image_url: text(item.profile_image_url) ?? null,
      audio_client: text(item.audio_client) }];
  });
}

export function resolveLiveThreadModel(storedModelId: string, models: GatewayModel[]): {
  modelId: string; removed: boolean;
} {
  const llms = models.filter((model) => model.type === "llm");
  if (llms.some((model) => model.id === storedModelId)) return { modelId: storedModelId, removed: false };
  const fallback = llms.find((model) => model.id === "gpt-5.6-luna") ?? llms[0];
  return { modelId: fallback?.id ?? "", removed: Boolean(storedModelId) };
}
