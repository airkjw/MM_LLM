import type { GatewayModel } from "./contracts";

const SONAR_MODELS = new Set(["sonar-pro", "sonar-reasoning-pro"]);

/** Models that the FactChat Gateway documents as having native web search. */
export function hasNativeWebSearch(modelId: string): boolean {
  return modelId.startsWith("gemini-") || SONAR_MODELS.has(modelId);
}

export function webSearchMode(modelId: string): "native" | "sonar" {
  return hasNativeWebSearch(modelId) ? "native" : "sonar";
}

export function availableSearchModel(catalog: GatewayModel[]): string | null {
  for (const id of ["sonar-pro", "sonar-reasoning-pro"]) {
    if (catalog.some((model) => model.type === "llm" && model.id === id)) return id;
  }
  return null;
}
