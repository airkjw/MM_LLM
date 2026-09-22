import { useState } from "react";
import type { DiagnosticStage } from "../../../shared/diagnostics";

export function DiagnosticButton({ stage, modelId }: { stage: DiagnosticStage; modelId?: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return <span className="diagnostic-control"><button type="button" className="secondary-button" disabled={busy}
    onClick={async () => {
      setBusy(true);
      try { await navigator.clipboard.writeText(await window.mmllm.getDiagnostics(stage, modelId)); setStatus("진단 정보를 복사했습니다."); }
      catch { setStatus("복사하지 못했습니다. 다시 시도해 주세요."); }
      finally { setBusy(false); }
    }}>진단 정보 복사</button><small role="status">{status}</small></span>;
}
