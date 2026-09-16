export const WORKSPACE_MAX_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_BOOKMARK_RESERVED_BYTES = 256 * 1024;
export const WORKSPACE_COMPARE_ENTITY_MAX_BYTES = 7 * 1024 * 1024;

export function fitWorkspaceState<T extends { bookmarks: unknown[]; compares: unknown[] }>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value.bookmarks), "utf8") > WORKSPACE_BOOKMARK_RESERVED_BYTES) {
    throw new Error("챗봇 북마크 저장 공간이 안전 한도를 넘었습니다.");
  }
  while (value.compares.length > 0 && Buffer.byteLength(JSON.stringify(value), "utf8") > WORKSPACE_MAX_BYTES) {
    value.compares.pop();
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > WORKSPACE_MAX_BYTES) {
    throw new Error("워크스페이스 실행 기록이 저장 한도를 넘었습니다.");
  }
  return value;
}
