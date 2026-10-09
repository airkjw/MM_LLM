import { CircleHelp, Edit3, ShieldCheck } from "lucide-react";
import type { ThreadSummary } from "../../shared/contracts";

/**
 * The dialogs left after Stage 4 (contract D4.9): rename and API key replace (the shared confirm dialog lives in
 * ConfirmDialog). Research, chatbot, projects and settings are screens now.
 */
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };

type Props = {
  renameDialog: RenameDialogState | null;
  closeRename: () => void;
  renameRef: React.RefObject<HTMLFormElement | null>;
  saveRenamedConversation: () => Promise<void>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  setRenameDialog: React.Dispatch<React.SetStateAction<RenameDialogState | null>>;
  keyReplaceOpen: boolean;
  keyReplacing: boolean;
  closeKeyReplace: () => void;
  keyReplaceRef: React.RefObject<HTMLDivElement | null>;
  replacementKey: string;
  setReplacementKey: React.Dispatch<React.SetStateAction<string>>;
  replaceApiKey: () => Promise<void>;
};

export function AppDialogs({ renameDialog, closeRename, renameRef, saveRenamedConversation, renameInputRef, setRenameDialog, keyReplaceOpen, keyReplacing, closeKeyReplace, keyReplaceRef, replacementKey, setReplacementKey, replaceApiKey }: Props) {
  return <>
      {renameDialog && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !renameDialog.busy) closeRename();
      }}><form className="dialog-card rename-dialog" role="dialog" aria-modal="true"
        aria-labelledby="rename-thread-title" aria-describedby={renameDialog.error ? "rename-thread-error" : undefined}
        ref={renameRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void saveRenamedConversation(); }}>
        <div className="dialog-title"><Edit3 size={21} /><h3 id="rename-thread-title">대화 이름 변경</h3></div>
        <label className="settings-field">새 대화 이름
          <input ref={renameInputRef} value={renameDialog.value} maxLength={80} disabled={renameDialog.busy}
            onChange={(event) => setRenameDialog((current) => current
              ? { ...current, value: event.target.value, error: "" } : current)} />
        </label>
        {renameDialog.error && <div className="inline-error" id="rename-thread-error" role="alert">
          <CircleHelp size={16} />{renameDialog.error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button"
          onClick={closeRename} disabled={renameDialog.busy}>취소</button>
          <button type="submit" className="primary-button" disabled={renameDialog.busy ||
            !renameDialog.value.trim() || renameDialog.value.trim() === renameDialog.thread.title}>
            {renameDialog.busy ? "저장 중…" : "저장"}</button></div>
      </form></div>}
      {keyReplaceOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !keyReplacing) closeKeyReplace();
      }}><div className="dialog-card key-replace-dialog" role="dialog"
        aria-modal="true" aria-labelledby="key-replace-title" ref={keyReplaceRef} tabIndex={-1}>
        <div className="dialog-title"><ShieldCheck size={21} /><h3 id="key-replace-title">API 키 교체</h3></div>
        <p>새 키를 먼저 검증한 뒤 현재 대화와 설정을 그대로 연결합니다. 검증에 실패하면 기존 키를 계속 사용합니다.</p>
        <label className="settings-field">새 ChatKHU API 키
          <input type="password" autoComplete="off" value={replacementKey}
            disabled={keyReplacing}
            onChange={(event) => setReplacementKey(event.target.value)} placeholder="새 API 키 입력" />
        </label>
        <div className="dialog-actions"><button type="button" className="secondary-button"
          onClick={closeKeyReplace} disabled={keyReplacing}>취소</button>
          <button type="button" className="primary-button" disabled={keyReplacing || !replacementKey.trim()}
            onClick={() => void replaceApiKey()}>{keyReplacing ? "검증 중…" : "검증하고 교체"}</button></div>
      </div></div>}
  </>;
}
