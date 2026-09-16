export function responseFailureMessage(event: Record<string, unknown>): string {
  const candidates: string[] = [];
  const add = (value: unknown, depth = 0) => {
    if (typeof value === "string" && value.trim()) { candidates.push(value); return; }
    if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "response"]) add(record[key], depth + 1);
  };
  add(event.error);
  add(event.response);
  return candidates[0] ?? "모델 응답이 실패했습니다.";
}
