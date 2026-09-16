import type { MediaResult, TranscriptSegment } from "./contracts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export const MAX_TRANSCRIPT_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_TRANSCRIPT_SEGMENT_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_TRANSCRIPT_COMBINED_BYTES = 3 * 1024 * 1024;
export const MAX_TRANSCRIPT_SEGMENTS = 20_000;
const MAX_SEGMENT_BYTES = 8 * 1024;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** Keeps only documented STT fields so encrypted pending-job state stays compact. */
export function parseTranscriptResult(value: unknown): Pick<MediaResult, "text" | "segments" | "durationSeconds"> {
  const source = record(value) ?? {};
  if (Array.isArray(source.segments) && source.segments.length > MAX_TRANSCRIPT_SEGMENTS) {
    throw new Error("받아쓰기 구간 수가 로컬 저장 한도를 넘었습니다.");
  }
  let segmentBytes = 0;
  const segments = Array.isArray(source.segments) ? source.segments.flatMap((item) => {
    const segment = record(item); if (!segment) return [];
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (!text) return [];
    const bytes = byteLength(text);
    if (bytes > MAX_SEGMENT_BYTES) throw new Error("받아쓰기 한 구간이 로컬 저장 한도를 넘었습니다.");
    segmentBytes += bytes;
    if (segmentBytes > MAX_TRANSCRIPT_SEGMENT_TEXT_BYTES) {
      throw new Error("받아쓰기 구간 텍스트가 로컬 저장 한도를 넘었습니다.");
    }
    const startMs = finiteNonNegative(segment.start_ms) ?? 0;
    const endMs = Math.max(startMs, finiteNonNegative(segment.end_ms) ?? startMs);
    return [{ speaker: typeof segment.speaker === "string" && segment.speaker.trim()
      ? segment.speaker.trim().slice(0, 80) : "Speaker Unknown", text, startMs, endMs } satisfies TranscriptSegment];
  }) : [];
  const text = typeof source.text === "string" ? source.text : segments.map((item) => item.text).join(" ");
  const textBytes = byteLength(text);
  if (textBytes > MAX_TRANSCRIPT_TEXT_BYTES) {
    throw new Error("받아쓰기 본문이 로컬 저장 한도를 넘었습니다.");
  }
  if (textBytes + segmentBytes > MAX_TRANSCRIPT_COMBINED_BYTES) {
    throw new Error("받아쓰기 본문과 구간 합계가 로컬 저장 한도를 넘었습니다.");
  }
  return { text: text || undefined, segments: segments.length ? segments : undefined,
    durationSeconds: finiteNonNegative(source.duration_seconds) };
}

export function formatTranscriptTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` :
    `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function transcriptForChat(result: MediaResult): string {
  if (result.segments?.length) return result.segments.map((item) =>
    `[${formatTranscriptTimestamp(item.startMs)}] ${item.speaker}: ${item.text}`).join("\n");
  return result.text ?? "";
}

export const MEETING_SUMMARY_INSTRUCTION =
  "의료경영 MBA 회의 분석가로서 전사를 사실에 충실하게 정리하세요. 회의 목적, 핵심 논점, 결정 사항, 미결 쟁점, 담당자와 기한이 있는 실행 항목, 의료기관 운영·재무·환자경험·인력·규제 관점의 시사점을 구분하세요. 불명확한 화자나 내용은 추정하지 말고 확인 필요로 표시하세요.";

export type MeetingSummaryPlan = { prompts: string[]; chunkCount: number };
export type MeetingReductionRound = { prompts: string[]; final: boolean };

function chunkTranscript(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const pieces = line.length <= maxChars ? [line] :
      Array.from({ length: Math.ceil(line.length / maxChars) }, (_, index) =>
        line.slice(index * maxChars, (index + 1) * maxChars));
    for (const piece of pieces) {
      const next = current ? `${current}\n${piece}` : piece;
      if (next.length > maxChars && current) { chunks.push(current); current = piece; }
      else current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Builds user-controlled map/reduce drafts. No model call is made by this helper. */
export function buildMeetingSummaryPlan(result: MediaResult, maxChunkChars = 70_000): MeetingSummaryPlan {
  const transcript = transcriptForChat(result).trim();
  if (!transcript) return { prompts: [], chunkCount: 0 };
  const chunks = chunkTranscript(transcript, Math.max(10_000, Math.min(80_000, maxChunkChars)));
  if (chunks.length === 1) return { chunkCount: 1, prompts: [
    `다음 회의 전사를 의료경영 관점의 회의록으로 정리해 주세요.\n\n${chunks[0]}`
  ] };
  const maps = chunks.map((chunk, index) =>
    `회의 전사 ${index + 1}/${chunks.length} 구간입니다. 이 구간만 사실에 충실하게 부분 요약하세요. ` +
    "결정 사항, 실행 항목(담당자·기한), 미결 쟁점, 의료기관 운영·재무·환자경험·인력·규제 시사점을 보존하세요. " +
    "최종 종합은 아직 하지 마세요.\n\n" + chunk);
  return { prompts: maps, chunkCount: chunks.length };
}

/**
 * Builds one local reduction round from model-produced partial summaries. Every prompt remains bounded;
 * callers collect the replies and call this function again until `final` is true.
 */
export function buildMeetingReductionRound(summaries: string[], maxChars = 70_000): MeetingReductionRound {
  const limit = Math.max(10_000, Math.min(80_000, maxChars));
  const pieces = summaries.flatMap((summary) => chunkTranscript(summary.trim(), limit)).filter(Boolean);
  if (!pieces.length) return { prompts: [], final: true };
  const groups: string[][] = []; let current: string[] = []; let length = 0;
  for (const piece of pieces) {
    const addition = piece.length + (current.length ? 2 : 0);
    if (current.length && length + addition > limit) { groups.push(current); current = []; length = 0; }
    current.push(piece); length += piece.length + (current.length > 1 ? 2 : 0);
  }
  if (current.length) groups.push(current);
  const final = groups.length === 1;
  return { final, prompts: groups.map((group, index) => final
    ? `다음 부분 요약만 사용해 하나의 의료경영 회의록으로 최종 종합하세요. 중복은 합치고 충돌은 확인 필요로 표시하세요. ` +
      "회의 목적, 핵심 논점, 결정 사항, 미결 쟁점, 담당자와 기한이 있는 실행 항목, " +
      `의료기관 운영·재무·환자경험·인력·규제 시사점 순으로 작성하세요.\n\n${group.join("\n\n")}`
    : `부분 요약 묶음 ${index + 1}/${groups.length}입니다. 사실, 결정 사항, 실행 항목, 미결 쟁점과 의료경영 시사점을 ` +
      `빠뜨리지 않으면서 중복만 제거해 더 짧은 중간 요약으로 압축하세요. 최종 종합은 아직 하지 마세요.\n\n${group.join("\n\n")}`) };
}
