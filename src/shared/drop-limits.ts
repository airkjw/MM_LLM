export const MAX_DROPPED_FILE_BYTES = 18 * 1024 * 1024;
export const MAX_DROPPED_BATCH_BYTES = 64 * 1024 * 1024;
export const MAX_DROPPED_FILES = 14;

export function assertDroppedFileBatch(files: Array<{ name: string; size: number }>): void {
  if (!files.length || files.length > MAX_DROPPED_FILES) {
    throw new Error(`한 번에 파일을 1개에서 ${MAX_DROPPED_FILES}개까지 첨부할 수 있습니다.`);
  }
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_DROPPED_FILE_BYTES) {
      throw new Error(`${file.name}: 파일은 18MB 이하만 첨부할 수 있습니다.`);
    }
    total += file.size;
    if (total > MAX_DROPPED_BATCH_BYTES) throw new Error("선택한 파일의 전체 크기는 64MB 이하여야 합니다.");
  }
}
