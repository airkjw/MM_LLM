import type { AppSettings, ChatAdvancedSettings, FontSizeMode, ReasoningMode, ThemeMode } from "../shared/contracts";
import { validatedAdvancedSettings } from "../shared/request-validation.ts";

export const MAX_THREAD_STORE_BYTES = 96 * 1024 * 1024;
export function assertThreadStoreByteLength(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_THREAD_STORE_BYTES) {
    throw new Error("대화 저장 파일이 96MB 안전 한도를 넘었습니다.");
  }
}

export function resolveKeyRotationHash(oldHash: string, newHash: string, activeHash: string): string {
  if (activeHash === oldHash || activeHash === newHash) return activeHash;
  throw new Error("API 키 교체 상태를 안전하게 복구할 수 없습니다.");
}

export function profileMoveCleanupFilenames(sourceId: string, sourceKeyHash: string): string[] {
  return [
    `threads-profile-${sourceId}.enc`, `jobs-profile-${sourceId}.enc`,
    settingsProfileFilename(sourceId), `threads-${sourceKeyHash}.enc`
  ];
}

/** Resolve the account-scoped settings target before entering a serialized write queue. */
export function settingsProfileFilename(profileId: string): string {
  return `settings-profile-${profileId}.enc`;
}

/** Idempotently combines records while preserving the target version of an already-migrated record. */
export function mergeUniqueRecords<T extends { id: string }>(target: T[], source: T[]): T[] {
  const ids = new Set(target.map((item) => item.id));
  return [...target, ...source.filter((item) => !ids.has(item.id))];
}

export const DEFAULT_INSTRUCTION = [
  "당신은 경희대학교 의료경영학 석사과정 학생을 돕는 연구·실무 조력자입니다.",
  "기본 답변은 정확하고 자연스러운 한국어로 작성하고, 중요한 전문용어는 필요한 경우 영어를 함께 표기하세요.",
  "사실·해석·제안을 구분하고, 활용한 근거와 자료의 한계를 명시하세요.",
  "환자정보, 개인정보, 의료법 또는 규제와 관련해서는 관할·상황에 따라 달라질 수 있음을 밝히고 법률적 확정 표현을 피하세요."
].join("\n");

export function normalizeThreadPreferences(raw: Record<string, unknown>): {
  pinned: boolean; instruction: string; reasoningMode: ReasoningMode; advanced: ChatAdvancedSettings;
} {
  const advanced = typeof raw.advanced === "object" && raw.advanced !== null
    ? raw.advanced as ChatAdvancedSettings : {};
  const normalizedAdvanced: ChatAdvancedSettings = {};
  if (typeof advanced.temperature === "number" && Number.isFinite(advanced.temperature)) {
    normalizedAdvanced.temperature = Math.min(2, Math.max(0, advanced.temperature));
  }
  if (typeof advanced.maxOutputTokens === "number" && Number.isFinite(advanced.maxOutputTokens)) {
    normalizedAdvanced.maxOutputTokens = Math.min(65_536, Math.max(128, Math.round(advanced.maxOutputTokens)));
  }
  try {
    const expanded = validatedAdvancedSettings({ ...advanced,
      temperature: normalizedAdvanced.temperature, maxOutputTokens: normalizedAdvanced.maxOutputTokens });
    Object.assign(normalizedAdvanced, expanded);
  } catch {
    // Preserve the two legacy safe values while dropping malformed newer options during migration.
  }
  return {
    pinned: Boolean(raw.pinned),
    instruction: typeof raw.instruction === "string" ? raw.instruction : "",
    reasoningMode: (["auto", "fast", "balanced", "deep"] as unknown[]).includes(raw.reasoningMode)
      ? raw.reasoningMode as ReasoningMode : "auto",
    advanced: normalizedAdvanced
  };
}

export function normalizeAppSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const models = (items: unknown, limit: number) => Array.isArray(items)
    ? [...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 200))].slice(0, limit)
    : undefined;
  const favoriteModels = models(value?.favoriteModels, 20);
  const recentModels = models(value?.recentModels, 8);
  return {
    ...(favoriteModels ? { favoriteModels } : {}), ...(recentModels ? { recentModels } : {}),
    defaultInstruction: typeof value?.defaultInstruction === "string"
      ? value.defaultInstruction.slice(0, 12_000) : DEFAULT_INSTRUCTION,
    theme: (["system", "light", "dark"] as unknown[]).includes(value?.theme)
      ? value!.theme as ThemeMode : "system",
    fontSize: (["small", "medium", "large"] as unknown[]).includes(value?.fontSize)
      ? value!.fontSize as FontSizeMode : "medium"
  };
}

export function rankThreadRecords<T extends {
  title: string; updatedAt: string; pinned?: boolean; messages: Array<{ text: string }>;
}>(records: T[], query: string): Array<{ thread: T; snippet: string }> {
  const terms = query.toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const results: Array<{ thread: T; snippet: string; score: number }> = [];
  for (const thread of records) {
    const title = thread.title.toLocaleLowerCase("ko-KR");
    const conversation = thread.messages.map((message) => message.text.toLocaleLowerCase("ko-KR")).join("\n");
    if (!terms.every((term) => title.includes(term) || conversation.includes(term))) continue;
    const matching = thread.messages.find((message) => terms.some((term) =>
      message.text.toLocaleLowerCase("ko-KR").includes(term)));
    const text = matching?.text.replace(/\s+/g, " ").trim() ?? thread.title;
    const first = terms.map((term) => text.toLocaleLowerCase("ko-KR").indexOf(term))
      .filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - 45);
    results.push({ thread,
      snippet: `${start ? "…" : ""}${text.slice(start, start + 150)}${text.length > start + 150 ? "…" : ""}`,
      score: (title.includes(terms[0]) ? 4 : 0) + (thread.pinned ? 2 : 0) });
  }
  return results.sort((a, b) => b.score - a.score || b.thread.updatedAt.localeCompare(a.thread.updatedAt))
    .slice(0, 50).map(({ thread, snippet }) => ({ thread, snippet }));
}
