import { ArrowRight, CircleHelp, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import type { SessionState } from "../../shared/contracts";
import { DiagnosticButton } from "./components/DiagnosticButton";

import { errorText } from "./ui-shared";
export function Login({ onLogin }: { onLogin: (state: SessionState) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const state = await window.mmllm.login(key.trim());
      setKey("");
      await onLogin(state);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-card">
      <div className="login-brand"><span className="brand-mark"><Sparkles size={24} /></span>
        <span>MM<span className="brand-underscore">_</span>LLM</span></div>
      <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
      <h1>의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
      <p>경희대학교 의료경영학과 대학원을 위한 AI 워크스페이스</p>
      <form onSubmit={submit}>
        <label htmlFor="api-key">학생 본인의 API 키</label>
        <input id="api-key" type="password" value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off" placeholder="ChatKHU API 키를 입력하세요" required />
        <button className="primary-button" type="submit" disabled={busy || !key.trim()}>
          {busy ? <><LoaderCircle className="spin" size={17} /> 확인 중...</> :
            <>시작하기 <ArrowRight size={18} /></>}
        </button>
        {busy && <button className="secondary-button" type="button" onClick={() => {
          void window.mmllm.cancelLogin().catch((error) => setError(errorText(error)));
        }}>로그인 확인 취소</button>}
      </form>
      {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}</div>}
      <DiagnosticButton stage="login" />
      <div className="login-note"><ShieldCheck size={16} />
        키는 이 기기의 운영체제 보안 저장소로 보호됩니다.</div>
      <button className="docs-link" type="button" onClick={() => void window.mmllm.openKeyGuide()}>
        API 키 발급 안내 <ArrowRight size={13} /></button>
    </div>
    <div className="login-aside"><span>LIVE CHATKHU MODELS · ONE MEDICAL MBA SPACE</span>
      <div className="aside-circles"><span>GPT</span><span>Claude</span><span>Gemini</span><span>+ 더 많은 모델</span></div>
    </div>
  </div>;
}
