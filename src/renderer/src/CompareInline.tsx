import { Columns3, Paperclip, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { serializeCompareAnalysis } from "../../shared/compare-export";
import type { CompareRun } from "../../shared/contracts";
import { webSearchStatusLabel } from "../../shared/search-evidence";
import { modelLabel } from "./model-names";
import { digitShortcut } from "./shortcut-policy";
import { errorText, MarkdownText } from "./ui-shared";

const RESULT_STATUS = { running: "답변 중", completed: "완료", incomplete: "일부 완료", failed: "실패", cancelled: "중단" } as const;
const SYNTHESIS_STATUS = { running: "분석 중", completed: "완료", incomplete: "일부 완료", failed: "실패", cancelled: "중단됨" } as const;

export type CompareSynthesisControls = {
  ready: boolean; busy: boolean; modelAvailable: boolean; onStart: () => void; onStop: () => void;
};

/**
 * One comparison rendered in place (contract D3.4): the question, one column per model, the synthesis bar while a
 * live run is ready for it, and the existing synthesis section. Storage stays `CompareRun`; continuing a column calls
 * the existing `continueCompare(runId, modelId)`. Columns answer 1–3 when nothing editable has focus.
 */
export function CompareInline({ run, busy, synthesis, continueDisabled, onContinue, onError, digitKeys = true }: {
  run: CompareRun | null; busy: boolean;
  /** Present only for the live run; a saved run starts no new synthesis. */
  synthesis?: CompareSynthesisControls;
  continueDisabled: boolean;
  onContinue: (runId: string, modelId: string) => void;
  onError: (message: string) => void;
  digitKeys?: boolean;
}) {
  const continuable = run?.results.filter((result) => result.text && result.status !== "running") ?? [];
  const latest = useRef({ run, continuable, continueDisabled, onContinue });
  latest.current = { run, continuable, continueDisabled, onContinue };
  useEffect(() => {
    if (!digitKeys) return;
    const keydown = (event: KeyboardEvent) => {
      const digit = digitShortcut(event);
      const { run: current, continueDisabled: disabled, onContinue: next } = latest.current;
      const result = digit && current?.results[digit - 1];
      if (!current || !result || disabled || !result.text || result.status === "running") return;
      event.preventDefault();
      next(current.id, result.modelId);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [digitKeys]);
  return <section className="compare-inline" aria-label="모델 답변 비교">
    {run && <div className="compare-prompt"><div className="user-bubble">{run.prompt}
      {run.attachmentNames.length > 0 && <small className="compare-prompt-files"><Paperclip size={12} aria-hidden="true" />
        {run.attachmentNames.join(", ")}</small>}</div></div>}
    {busy && !run && <p className="inline-progress" role="status">첨부 자료와 웹 검색 설정에 따라 비교를 준비하고 있습니다…</p>}
    {run && <>
      <div className="compare-inline-divider"><Columns3 size={14} aria-hidden="true" />
        <span>{run.results.length}개 모델 비교{run.webSearch ? ` · ${webSearchStatusLabel(run.webSearch)}` : ""}</span></div>
      <div className="compare-inline-columns" aria-live="polite">{run.results.map((result, index) => {
        const canContinue = Boolean(result.text) && result.status !== "running";
        return <article className="compare-inline-column" key={result.modelId}
          aria-label={`답변 ${String.fromCharCode(65 + index)} · ${modelLabel(result.modelId)}`}>
          <header><strong>{modelLabel(result.modelId)}</strong><span className="mono">{RESULT_STATUS[result.status]}</span></header>
          <div className="compare-inline-body">{result.error
            ? <span className="compare-result-plain">{result.error}</span>
            : result.text ? <MarkdownText text={result.text} />
              : <span className="compare-result-plain">응답을 기다리는 중…</span>}</div>
          <footer className="compare-inline-column-footer">
            {canContinue ? <button type="button" className="compare-continue" aria-keyshortcuts={String(index + 1)}
              disabled={continueDisabled} onClick={() => onContinue(run.id, result.modelId)}>이 답변으로 계속</button>
              : <span>{RESULT_STATUS[result.status]}</span>}
            <kbd aria-hidden="true">{index + 1}</kbd>
          </footer>
        </article>;
      })}</div>
      {synthesis?.ready && <div className="compare-synthesis-bar">
        <Sparkles size={16} aria-hidden="true" />
        <small>{synthesis.modelAvailable
          ? "GPT-5.6 Sol이 답변 A·B·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다."
          : "현재 API 키에서 GPT-5.6 Sol을 사용할 수 없어 종합분석을 실행할 수 없습니다."}</small>
        <button type="button" className={synthesis.busy ? "secondary-button" : "primary-button"}
          disabled={!synthesis.modelAvailable}
          onClick={() => synthesis.busy ? synthesis.onStop() : synthesis.onStart()}>
          {synthesis.busy ? <><Square size={14} aria-hidden="true" /> 종합분석 중단</> : <><Sparkles size={15} aria-hidden="true" />
            {run.synthesis?.text ? "다시 분석" : "종합분석"}</>}
        </button>
      </div>}
      {run.synthesis && <section className="compare-synthesis" aria-live="polite">
        <p className="compare-synthesis-warning">답변 간 합의만으로 정답이 확정되지는 않습니다.
          아래의 사실 검토와 불확실성을 함께 확인해 주세요.
          {run.webSearch && <> {webSearchStatusLabel(run.webSearch)}.</>}
          {run.sharedEvidence ? " 공통 웹 근거를 비교 자료에 포함했습니다." : " 공통 웹 근거가 없어 별도 출처 확인이 필요합니다."}</p>
        {run.synthesis.text && <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={() => {
            void navigator.clipboard.writeText(serializeCompareAnalysis(run)).catch(() => onError("종합분석 복사에 실패했습니다."));
          }}>종합분석 복사</button>
          <button type="button" className="secondary-button" disabled={synthesis?.busy}
            onClick={() => void window.mmllm.exportCompareRun(run.id).catch((error) => onError(errorText(error)))}>Markdown 저장</button>
        </div>}
        <header><span><Sparkles size={16} aria-hidden="true" /><strong>{modelLabel(run.synthesis.modelId)} 종합 분석</strong></span>
          <span>{SYNTHESIS_STATUS[run.synthesis.status]}</span></header>
        <div className="compare-synthesis-legend">{run.results.map((result, index) =>
          <span key={result.modelId}>답변 {String.fromCharCode(65 + index)} · {modelLabel(result.modelId)}</span>)}</div>
        <div className="compare-synthesis-body">{run.synthesis.text
          ? <MarkdownText text={run.synthesis.text} />
          : <span className="compare-result-plain">{run.synthesis.error ??
            (run.synthesis.status === "running" ? "종합분석 응답을 기다리는 중…"
              : "표시할 종합분석 결과가 없습니다. 종합분석을 다시 실행해 주세요.")}</span>}</div>
        {run.synthesis.error && run.synthesis.text &&
          <div className="compare-synthesis-warning" role="status">{run.synthesis.error}</div>}
      </section>}
    </>}
  </section>;
}

/** Rail ② screen: saved runs (`listCompareRuns()`) and the same inline renderer, read-only. */
export function CompareScreen({ headerCenter, loadRuns, selectedRun, onSelectRun, continueDisabled, onContinue, onError, onStartNew }: {
  headerCenter: ReactNode;
  loadRuns: () => Promise<CompareRun[]>;
  selectedRun: CompareRun | null;
  onSelectRun: (run: CompareRun) => void;
  continueDisabled: boolean;
  onContinue: (runId: string, modelId: string) => void;
  onError: (message: string) => void;
  onStartNew: () => void;
}) {
  const [runs, setRuns] = useState<CompareRun[] | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(loadRuns).then((items) => { if (current) setRuns(items); })
      .catch((error) => { if (current) { setRuns([]); onError(errorText(error)); } });
    return () => { current = false; };
  }, [loadRuns]);
  return <section className="chat-panel compare-screen" aria-labelledby="compare-screen-title">
    <div className="panel-header">
      <div className="panel-heading"><h2 id="compare-screen-title">모델 비교</h2></div>
      {headerCenter}
      <div className="panel-actions"><button type="button" className="secondary-button" onClick={onStartNew}>
        <Columns3 size={14} aria-hidden="true" /> 대화에서 새 비교</button></div>
    </div>
    <div className="compare-screen-body">
      {runs === null ? <p className="compare-screen-empty" role="status">저장된 비교를 불러오는 중…</p>
        : runs.length === 0 ? <p className="compare-screen-empty">저장된 비교가 없습니다. 대화 입력창에서 모델을 2개 이상 선택하면 비교할 수 있습니다.</p>
          : <ul className="compare-run-list" aria-label="저장된 비교">{runs.map((run) => <li key={run.id}>
            <button type="button" aria-current={selectedRun?.id === run.id ? "true" : undefined} onClick={() => onSelectRun(run)}>
              <span className="compare-run-title">{run.prompt}</span>
              <span className="compare-run-meta">{run.modelIds.length} models · {new Date(run.createdAt).toLocaleString("ko-KR")}</span>
            </button></li>)}</ul>}
      {selectedRun && <CompareInline run={selectedRun} busy={false} continueDisabled={continueDisabled}
        onContinue={onContinue} onError={onError} />}
    </div>
  </section>;
}
