import type { GatewayModel, WebSearchMode } from "./contracts";

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

const REWRITE_ONLY = /^(?:위|이|그|방금|앞의|지금\s*내용을?)?\s*(?:내용을?\s*)?(요약|정리|번역|다시\s*써|고쳐\s*써|짧게|길게|표로|목록으로|말투|문체|rewrite|summari[sz]e|translate)|^(짧게|길게).*(다시\s*써|정리|요약)/i;
const FRESHNESS = /(오늘|현재|최신|최근|이번\s*(주|달|해)|뉴스|속보|가격|주가|환율|날씨|일정|규정|법률|정책|현직|지금|검색|찾아|근거|출처|today|current|latest|recent|news|price|weather|schedule|search|source)/i;

/** Auto mode searches only when the user explicitly needs changing/current web facts. */
export function shouldSearchWebInAuto(query: string): boolean {
  const value = query.trim();
  if (!value || REWRITE_ONLY.test(value)) return false;
  return FRESHNESS.test(value);
}

const TOPIC_STOP = new Set(["오늘", "현재", "최신", "최근", "검색", "찾아줘", "알려줘", "정리해줘", "요약해줘", "내용", "다시", "정리", "요약", "please", "current", "latest"]);

export function webQueryFingerprint(query: string): string {
  return [...new Set(query.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [])]
    .map((term) => /[가-힣]/.test(term) ? term.replace(/(?:을|를|은|는|이|가|과|와|의)$/u, "") : term)
    .filter((term) => term.length >= 2 && !TOPIC_STOP.has(term)).sort().slice(0, 12).join("|");
}

export type WebSearchCacheEntry = { query: string; fingerprint: string; content: string; createdAt: string;
  mode?: "always" | "auto" | "deep" };

export function relevantCachedWebContext(
  entries: WebSearchCacheEntry[] | undefined, query: string, now = Date.now(), ttlMs = 30 * 60_000,
  mode?: WebSearchMode
): string | undefined {
  const effectiveTtl = mode === "deep" ? Math.min(ttlMs, 20 * 60_000) : ttlMs;
  const fresh = (entries ?? []).filter((entry) => now - Date.parse(entry.createdAt) <= effectiveTtl &&
    (mode === undefined || mode === "off" || (entry.mode ?? "always") === mode));
  if (!fresh.length) return undefined;
  if (REWRITE_ONLY.test(query.trim()) || /^(?:위|이|그|방금|앞의)(?:\s|$)/.test(query.trim())) return fresh[0].content;
  const fingerprint = new Set(webQueryFingerprint(query).split("|").filter(Boolean));
  if (!fingerprint.size) return undefined;
  const ranked = fresh.map((entry) => {
    const cached = new Set(entry.fingerprint.split("|").filter(Boolean));
    const overlap = [...fingerprint].filter((term) => cached.has(term)).length;
    const union = new Set([...fingerprint, ...cached]).size;
    return { entry, overlap, ratio: overlap / Math.max(1, union) };
  }).sort((a, b) => b.ratio - a.ratio);
  return ranked[0] && ranked[0].overlap >= 2 && ranked[0].ratio >= .65 ? ranked[0].entry.content : undefined;
}
