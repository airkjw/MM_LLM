import { useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { Notice, useNotice } from "./Notice";
import { DiagnosticButton } from "./DiagnosticButton";

export function BackupPanel() {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const { notice, setError, setSuccess, clear } = useNotice();
  async function run(restore: boolean) {
    if (busy) return;
    if (!restore && password !== repeat) { setError("백업 암호와 확인 입력이 일치하지 않습니다."); return; }
    if (restore && !await confirm({ title: "백업 복원", message: "현재 계정의 대화·프로젝트·설정을 백업 내용으로 전환합니다. 현재 기록이 필요하면 먼저 백업해 주세요. API 키는 바뀌지 않습니다.",
      confirmLabel: "백업 내용으로 복원", danger: true })) return;
    setBusy(true); clear();
    try {
      const done = await (restore ? window.mmllm.restoreBackup(password) : window.mmllm.exportBackup(password));
      if (done) {
        setPassword(""); setRepeat("");
        if (restore) window.location.reload();
        else setSuccess("암호화 백업을 저장했습니다.");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "백업 작업에 실패했습니다.");
    } finally { setBusy(false); }
  }
  return <fieldset className="backup-panel" disabled={busy}>
    <legend>암호화 백업·복원</legend>
    <p>대화와 첨부 자료, 프로젝트 문서, 앱 설정을 다른 컴퓨터로 옮길 수 있습니다. API 키는 포함하지 않습니다.
      미디어 생성물과 비교 실행 기록은 이 백업에 포함하지 않습니다. 최대 512MB이며 암호를 잃으면 복원할 수 없습니다.</p>
    <label>백업 암호 (12자 이상)<input type="password" autoComplete="off" value={password}
      maxLength={1024} onChange={(event) => setPassword(event.target.value)} /></label>
    <label>백업할 때 암호 확인<input type="password" autoComplete="off" value={repeat}
      maxLength={1024} onChange={(event) => setRepeat(event.target.value)} /></label>
    <div className="dialog-actions">
      <button type="button" className="secondary-button" disabled={password.length < 12 || password !== repeat}
        onClick={() => void run(false)}>백업 저장</button>
      <button type="button" className="secondary-button" disabled={password.length < 12}
        onClick={() => void run(true)}>백업 복원</button>
    </div>
    {busy && <p role="status">암호화 데이터를 처리하고 있습니다. 완료될 때까지 앱을 열어 두세요.</p>}
    <Notice notice={notice} onClose={clear} />
    {notice?.tone === "error" && <DiagnosticButton stage="backup" />}
  </fieldset>;
}
