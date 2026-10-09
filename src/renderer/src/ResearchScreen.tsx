import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Quote, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { MCP_LIMIT_NOTICE, researchEvidence, type ResearchResult, type ResearchSuite, type ResearchTool } from "../../shared/research";
import { errorText } from "./ui-shared";

const MAC = navigator.platform.includes("Mac");

/**
 * Research screen (contract D4.3; absorbed ResearchPanel). The 320 column holds the suite, the discovered tools
 * (unreviewed tools are listed but cannot be selected), the query and schema fields and the notices; Cmd/Ctrl+Enter
 * inside the column runs the search. Results are chosen one by one and only the chosen ones become evidence.
 * Remote calls happen only on an explicit action, one request at a time, and leaving the screen cancels it.
 */
export function ResearchScreen({ onEvidence, headerCenter }: {
  onEvidence: (text: string, ownsSource?: () => boolean) => void; headerCenter?: ReactNode;
}) {
  const [suites, setSuites] = useState<ResearchSuite[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [suite, setSuite] = useState(""); const [tools, setTools] = useState<ResearchTool[]>([]);
  const [token, setToken] = useState(""); const [args, setArgs] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const request = useRef<string | null>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false;
    if (request.current) void window.mmllm.cancelResearch(request.current); }; }, []);
  const tool = tools.find((item) => item.token === token && item.executable);
  const fields = tool ? [...tool.fields.filter((field) => field.required), ...tool.fields.filter((field) => !field.required)] : [];
  const canSearch = Boolean(tool) && !busy && fields.some((field) => field.required && args[field.name]);
  async function run(action: (id: string) => Promise<void>) {
    if (request.current) return;
    const id = crypto.randomUUID(); request.current = id; setBusy(true); setError(""); setResult(null); setSelected(new Set());
    try { await action(id); } catch (error) { if (alive.current && request.current === id) setError(errorText(error)); }
    finally { if (alive.current && request.current === id) { request.current = null; setBusy(false); } }
  }
  const search = () => {
    if (!canSearch || !tool) return;
    void run(async (id) => { const next = await window.mmllm.searchResearch(id, tool.token, args);
      if (alive.current && request.current === id) setResult(next); });
  };
  const columnKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    search();
  };
  const chosen = result ? result.sources.filter((_source, index) => selected.has(index)) : [];
  const addEvidence = () => {
    if (!result) return;
    // With sources, only the ticked ones are sent; a result without sources carries its raw text as before.
    if (result.sources.length && !chosen.length) return;
    onEvidence(researchEvidence(result.sources.length ? { ...result, sources: chosen } : result), () => alive.current);
  };
  const toggle = (index: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  return <section className="research-screen screen-layout" aria-label="논문·법령 리서치">
    <div className="screen-column research-column" role="group" aria-label="검색 설정" onKeyDown={columnKeys}>
      <div className="list-header"><h2 className="list-title">논문·법령 리서치</h2>
        <button type="button" className="link-button research-discover" disabled={busy} onClick={() => void run(async (id) => {
          setTools([]); setToken(""); setSuite(""); const next = await window.mmllm.discoverResearch(id);
          if (alive.current && request.current === id) { setSuites(next); setDiscovered(true); }
        })}><RefreshCw size={14} aria-hidden="true" />{discovered ? "도구 다시 확인" : "검색 도구 확인"}</button></div>
      <div className="research-column-body">
        <label className="settings-field">검색 묶음<select value={suite} disabled={busy} onChange={(event) => {
          setSuite(event.target.value); setTools([]); setToken(""); setResult(null);
        }}><option value="">묶음 선택</option>{suites.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select></label>
        <button type="button" className="secondary-button" disabled={busy || !suite} onClick={() => void run(async (id) => {
          setTools([]); setToken(""); const next = await window.mmllm.listResearchTools(id, suite);
          if (alive.current && request.current === id) setTools(next);
        })}>선택한 묶음의 도구·스키마 확인</button>
        {tools.length > 0 && <div className="research-tools" role="group" aria-label="도구">
          <span className="research-label" aria-hidden="true">도구</span>
          {tools.map((item) => <button key={item.token} type="button" className={`research-tool${item.token === token ? " selected" : ""}`}
            aria-pressed={item.token === token && item.executable} aria-disabled={!item.executable || undefined} disabled={busy}
            onClick={() => { if (!item.executable || busy || item.token === token) return; setToken(item.token); setArgs({}); setResult(null); }}>
            <span className="research-tool-name">{item.name}</span>
            <small>{item.executable ? item.description : item.reason ?? item.description}</small>
            {!item.executable && <span className="badge-neutral">실행 미검토</span>}
          </button>)}
        </div>}
        {tool && <>
          {fields.map((field) => <label className="settings-field" key={field.name}>
            {field.name}{field.required && " · 검색어"}
            {field.enum ? <select value={String(args[field.name] ?? "")} disabled={busy} onChange={(event) => setArgs((old) => {
              const next = { ...old };
              if (!event.target.value) delete next[field.name];
              else next[field.name] = event.target.value;
              return next;
            })}>
              <option value="">생략</option>{field.enum.map((value) => <option key={value}>{value}</option>)}</select>
              : field.type === "boolean" ? <input type="checkbox" checked={args[field.name] === true} disabled={busy}
                onChange={(event) => setArgs((old) => ({ ...old, [field.name]: event.target.checked }))} />
              : <input type={field.type === "string" ? "text" : "number"} value={String(args[field.name] ?? "")} disabled={busy}
                maxLength={Math.min(2000, field.maxLength ?? 2000)} min={field.min} max={field.max}
                onChange={(event) => setArgs((old) => { const next = { ...old };
                  if (!event.target.value) delete next[field.name];
                  else next[field.name] = field.type === "string" ? event.target.value : Number(event.target.value); return next; })} />}
          </label>)}
          <details><summary>발견한 입력 스키마</summary><pre>{tool.schema}</pre></details>
        </>}
        <p className="research-notice">계정의 검색 도구를 직접 확인하고 필요한 묶음 하나만 선택하세요. 검색어는 원격 도구로 전송됩니다.</p>
        <p className="research-notice">{MCP_LIMIT_NOTICE}</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <div className="screen-column-footer">
        <kbd aria-hidden="true">{MAC ? "⌘↵" : "Ctrl ↵"}</kbd>
        {busy && <button type="button" className="secondary-button" onClick={() => { if (request.current) void window.mmllm.cancelResearch(request.current); }}>요청 취소</button>}
        <button type="button" className="primary-button" disabled={!canSearch} aria-keyshortcuts="Meta+Enter Control+Enter"
          onClick={search}><Search size={15} aria-hidden="true" />검색 실행</button>
      </div>
    </div>
    <div className="research-body">
      <div className="panel-header"><div className="panel-heading"><h2 className="research-results-header">검색 결과
        {result && <span className="research-count">{result.sources.length}</span>}</h2></div>
        {headerCenter}
        {result && <span className="research-searched">searched {result.searchedAt}</span>}</div>
      <div className="research-results-scroll">
        {!result ? <p className="research-empty">{busy ? "검색 중…" : "검색 도구를 확인하고 묶음과 도구를 고른 뒤 검색을 실행하세요."}</p>
          : <div className="research-results" aria-label="검색 결과">
            <p className="research-trust"><ShieldCheck size={15} aria-hidden="true" />{result.notice}</p>
            {result.sources.map((source, index) => <article key={index} className={`research-result${selected.has(index) ? " selected" : ""}`}>
              <label className="research-result-check"><input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                <strong>{source.title}</strong></label>
              {source.url && <button type="button" className="link-button" onClick={() => void window.mmllm.openExternal(source.url!).catch((error) => setError(errorText(error)))}>{source.url}</button>}
              <span className="research-dates">{Object.entries(source.dates).map(([key, value]) => <small key={key}>{key}: {value}</small>)}</span>
              <p>{source.text}</p></article>)}
            <details><summary>제공된 검색 텍스트</summary><pre>{result.rawText}</pre></details>
          </div>}
      </div>
      {result && <div className="research-selection-bar">
        <span className="research-selection"><strong>{result.sources.length ? `${chosen.length}건 선택` : "원문 텍스트"}</strong>
          <small>초안에 출처와 함께 붙습니다. 전송은 직접 합니다.</small></span>
        {result.sources.length > 0 && <button type="button" className="secondary-button" disabled={!chosen.length}
          onClick={() => setSelected(new Set())}>모두 해제</button>}
        <button type="button" className="primary-button" disabled={result.sources.length > 0 && !chosen.length}
          onClick={addEvidence}><Quote size={15} aria-hidden="true" />대화 초안에 근거 추가</button>
      </div>}
    </div>
  </section>;
}
