import { ArrowRight, ArrowUpRight, CircleHelp, Eye, EyeOff, HardDrive, LoaderCircle, Lock } from "lucide-react";
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
  // Contract D4.8: two columns from 900px, one below (CSS). No auto-login option: login(key) has none.
  return <main className="login-page">
    <div className="login-layout">
      <section className="login-intro" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark" aria-hidden="true">M</span>
          <span>MM<span className="brand-underscore">_</span>LLM</span></div>
        <div className="login-intro-main">
          <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
          <h1 id="login-title">의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
          <p>경희대학교 의료경영학과 대학원을 위한<br />AI 연구 · 업무 공간</p>
        </div>
        <ul className="login-security" aria-label="보안 안내">
          <li><Lock size={14} aria-hidden="true" /><span>키는 이 기기의 운영체제 보안 저장소로 보호됩니다.</span></li>
          <li><HardDrive size={14} aria-hidden="true" /><span>대화 기록은 이 기기 안에서 암호화해 보관합니다.</span></li>
        </ul>
      </section>
      <section className="login-card" aria-labelledby="login-form-title">
        <div className="login-card-heading"><h2 id="login-form-title">API 키로 시작하기</h2>
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
        <section className="login-guide" aria-labelledby="login-guide-title">
          <div className="login-guide-heading"><h3 id="login-guide-title">API 키 발급 방법</h3>
            <button className="docs-link" type="button" onClick={() => void window.mmllm.openKeyGuide()}>
              발급 안내 열기 <ArrowUpRight size={13} aria-hidden="true" /></button></div>
          <ol>
            <li className="login-guide-step"><b>01</b><span>Info21 계정으로 ChatKHU 로그인</span></li>
            <li className="login-guide-step"><b>02</b><span>왼쪽 아래 API Gateway → API 키 생성</span></li>
            <li className="login-guide-step"><b>03</b><span>이름 입력 후 생성, 키 복사 (한 번만 표시)</span></li>
          </ol>
        </section>
      </section>
    </div>
  </main>;
}
