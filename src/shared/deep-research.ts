import { webQueryFingerprint } from "./web-search.ts";

export const DEEP_RESEARCH_MIN_QUERIES = 3;
export const DEEP_RESEARCH_MAX_QUERIES = 4;
export const DEEP_RESEARCH_MAX_CALLS = 6;
export const DEEP_RESEARCH_CONTEXT_BYTES = 512 * 1024;
export const DEEP_RESEARCH_CACHE_TTL_MS = 20 * 60_000;

export function validateResearchQueries(value: unknown, original: string): string[] {
  const candidates = Array.isArray(value) ? value : [];
  const seen = new Set<string>(); const result: string[] = [];
  for (const item of candidates) {
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
    if (cleaned.length < 3) continue;
    const key = cleaned.toLocaleLowerCase("ko-KR"); if (seen.has(key)) continue;
    seen.add(key); result.push(cleaned);
    if (result.length === DEEP_RESEARCH_MAX_QUERIES) break;
  }
  if (result.length >= DEEP_RESEARCH_MIN_QUERIES) return result;
  const base = original.replace(/\s+/g, " ").trim().slice(0, 450);
  const fallbacks = [
    `${base} 공식 자료 통계`, `${base} 최신 연구 근거`, `${base} 정책 제도`, `${base} 반대 근거 한계`
  ];
  for (const query of fallbacks) {
    const key = query.toLocaleLowerCase("ko-KR"); if (!seen.has(key)) { seen.add(key); result.push(query); }
    if (result.length === DEEP_RESEARCH_MAX_QUERIES) break;
  }
  return result;
}

export function parseResearchPlan(text: string, original: string): string[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) try { value = JSON.parse(match[0]); } catch { value = undefined; }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = (value as Record<string, unknown>).queries;
  }
  return validateResearchQueries(value, original);
}

export function combineResearchResults(results: Array<{ query: string; content: string }>): string {
  const urls = new Set<string>(); let used = 0; const blocks: string[] = [];
  for (const result of results.slice(0, DEEP_RESEARCH_MAX_QUERIES)) {
    const withoutDuplicateUrls = result.content.split("\n").filter((line) => {
      const match = line.match(/^\s*-\s+(https?:\/\/\S+)/);
      if (!match) return true;
      try {
        const normalized = new URL(match[1]).href;
        if (urls.has(normalized)) return false; urls.add(normalized); return true;
      } catch { return false; }
    }).join("\n");
    const block = ["<research-result>", `<query>${result.query}</query>`,
      "<untrusted-web-content>", withoutDuplicateUrls, "</untrusted-web-content>", "</research-result>"].join("\n");
    const bytes = Buffer.byteLength(block, "utf8");
    if (used + bytes > DEEP_RESEARCH_CONTEXT_BYTES) break;
    used += bytes; blocks.push(block);
  }
  return blocks.join("\n\n");
}

export function deepResearchCacheKey(query: string): string {
  return `deep:${webQueryFingerprint(query)}`;
}
