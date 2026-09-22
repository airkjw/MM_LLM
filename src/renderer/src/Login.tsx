import { ArrowRight, BookOpen, CircleHelp, Columns3, Eye, EyeOff, FileText, LoaderCircle, PanelsTopLeft, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { SessionState } from "../../shared/contracts";
import { DiagnosticButton } from "./components/DiagnosticButton";

import { errorText } from "./ui-shared";
export function Login({ onLogin }: { onLogin: (state: SessionState) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const state = await window.mmllm.login(key.trim());
      setKey("");
      await onLogin(state);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-layout">
      <section className="login-intro" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark"><PanelsTopLeft size={22} /></span>
          <span>MM<span className="brand-underscore">_</span>LLM</span></div>
        <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
        <h1 id="login-title">의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
        <p>경희대학교 의료경영학과 대학원을 위한<br />AI 연구 · 업무 공간</p>
        <ul className="login-capabilities">
          <li><BookOpen size={17} /><span>논문과 자료를 읽고, 핵심을 정리하세요.</span></li>
          <li><Columns3 size={17} /><span>여러 모델의 관점을 비교하고 검토하세요.</span></li>
          <li><FileText size={17} /><span>프로젝트별로 연구의 맥락을 이어가세요.</span></li>
        </ul>
      </section>
      <section className="login-card" aria-labelledby="login-form-title">
        <div className="login-card-heading"><h2 id="login-form-title">워크스페이스 시작하기</h2>
          <p>ChatKHU에서 발급받은 API 키로 연결하세요.</p></div>
        <form onSubmit={submit}>
          <label htmlFor="api-key">API 키</label>
          <div className="key-input-wrap">
            <input id="api-key" type={visible ? "text" : "password"} value={key} disabled={busy}
              onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false}
              placeholder="API 키를 붙여넣으세요" required />
            <button type="button" className="key-visibility icon-button" aria-label={visible ? "API 키 숨기기" : "API 키 보기"}
              aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <button className="primary-button" type="submit" disabled={busy || !key.trim()}>
            {busy ? <><LoaderCircle className="spin" size={17} /> 연결 확인 중…</> : <>시작하기 <ArrowRight size={17} /></>}
          </button>
          {busy && <button className="secondary-button" type="button" onClick={() => {
            void window.mmllm.cancelLogin().catch((error) => setError(errorText(error)));
          }}>로그인 확인 취소</button>}
        </form>
        {error && <><div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}</div>
          <DiagnosticButton stage="login" /></>}
        <button className="docs-link" type="button" onClick={() => void window.mmllm.openKeyGuide()}>
          API 키가 처음이신가요? 발급 안내 <ArrowRight size={13} /></button>
        <div className="login-note"><ShieldCheck size={16} /><span>키는 이 기기의 운영체제 보안 저장소로 보호됩니다.</span></div>
      </section>
    </div>
    <div className="login-footer"><span>MM_LLM · MEDICAL MBA</span><span>학습에서 연구, 의사결정까지</span></div>
  </main>;
}
