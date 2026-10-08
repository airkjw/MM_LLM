import { useEffect, useRef, useState } from "react";
import { MCP_LIMIT_NOTICE, researchEvidence, type ResearchResult, type ResearchSuite, type ResearchTool } from "../../shared/research";
import { errorText } from "./ui-shared";

export function ResearchPanel({ onEvidence }: { onEvidence: (text: string) => void }) {
  const [suites, setSuites] = useState<ResearchSuite[]>([]);
  const [suite, setSuite] = useState(""); const [tools, setTools] = useState<ResearchTool[]>([]);
  const [token, setToken] = useState(""); const [args, setArgs] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const request = useRef<string | null>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false;
    if (request.current) void window.mmllm.cancelResearch(request.current); }; }, []);
  const tool = tools.find((item) => item.token === token);
  async function run(action: (id: string) => Promise<void>) {
    if (request.current) return;
    const id = crypto.randomUUID(); request.current = id; setBusy(true); setError(""); setResult(null);
    try { await action(id); } catch (error) { if (alive.current && request.current === id) setError(errorText(error)); }
    finally { if (alive.current && request.current === id) { request.current = null; setBusy(false); } }
  }
  return <section className="research-panel" aria-label="논문·법령 검색">
    <p>계정의 검색 도구를 직접 확인하고 필요한 묶음 하나만 선택하세요. 검색어는 원격 도구로 전송됩니다.</p>
    <p className="project-notice">{MCP_LIMIT_NOTICE}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async (id) => {
      setTools([]); setToken(""); setSuite(""); const next = await window.mmllm.discoverResearch(id);
      if (alive.current && request.current === id) setSuites(next);
    })}>검색 도구 확인</button>
    <label className="settings-field">발견한 묶음<select value={suite} disabled={busy} onChange={(event) => {
      setSuite(event.target.value); setTools([]); setToken(""); setResult(null);
    }}><option value="">묶음 선택</option>{suites.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select></label>
    <button type="button" className="secondary-button" disabled={busy || !suite} onClick={() => void run(async (id) => {
      setTools([]); setToken(""); const next = await window.mmllm.listResearchTools(id, suite);
      if (alive.current && request.current === id) setTools(next);
    })}>선택한 묶음의 도구·스키마 확인</button>
    <label className="settings-field">도구<select value={token} disabled={busy} onChange={(event) => {
      setToken(event.target.value); setArgs({}); setResult(null);
    }}><option value="">도구 선택</option>{tools.map((item) => <option key={item.token} value={item.token}>{item.name}{!item.executable && " · 실행 미검토"}</option>)}</select></label>
    {tool && <><p>{tool.description}</p><details><summary>발견한 입력 스키마</summary><pre>{tool.schema}</pre></details>
      {tool.reason && <p role="status">{tool.reason}</p>}
      {tool.executable && tool.fields.map((field) => <label className="settings-field" key={field.name}>
        {field.name}{field.required && " · 검색어"}
        {field.enum ? <select value={String(args[field.name] ?? "")} disabled={busy} onChange={(event) => setArgs((old) => ({ ...old, [field.name]: event.target.value }))}>
          <option value="">생략</option>{field.enum.map((value) => <option key={value}>{value}</option>)}</select>
          : field.type === "boolean" ? <input type="checkbox" checked={args[field.name] === true} disabled={busy}
            onChange={(event) => setArgs((old) => ({ ...old, [field.name]: event.target.checked }))} />
          : <input type={field.type === "string" ? "text" : "number"} value={String(args[field.name] ?? "")} disabled={busy}
            maxLength={Math.min(2000, field.maxLength ?? 2000)} min={field.min} max={field.max}
            onChange={(event) => setArgs((old) => { const next = { ...old };
              if (!event.target.value) delete next[field.name];
              else next[field.name] = field.type === "string" ? event.target.value : Number(event.target.value); return next; })} />}
      </label>)}
      <button type="button" className="primary-button" disabled={busy || !tool.executable || !tool.fields.some((field) => field.required && args[field.name])}
        onClick={() => void run(async (id) => { const next = await window.mmllm.searchResearch(id, token, args); if (alive.current && request.current === id) setResult(next); })}>검색 실행</button></>}
    {busy && <button type="button" className="secondary-button" onClick={() => { if (request.current) void window.mmllm.cancelResearch(request.current); }}>요청 취소</button>}
    {error && <p role="alert">{error}</p>}
    {result && <div className="research-results" aria-label="검색 결과"><p>{result.notice}</p><small>검색 시점: {result.searchedAt}</small>
      {result.sources.map((source, index) => <article key={index}><strong>{source.title}</strong>
        {source.url && <button type="button" className="link-button" onClick={() => void window.mmllm.openExternal(source.url!).catch((error) => setError(errorText(error)))}>{source.url}</button>}
        {Object.entries(source.dates).map(([key, value]) => <small key={key}>{key}: {value}</small>)}<p>{source.text}</p></article>)}
      <details><summary>제공된 검색 텍스트</summary><pre>{result.rawText}</pre></details>
      <button type="button" className="secondary-button" onClick={() => onEvidence(researchEvidence(result))}>대화 초안에 근거 추가</button>
    </div>}
  </section>;
}
