import { CircleHelp, Edit3, FileText, FolderOpen, Paperclip, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { GatewayModel, ProjectSummary, ThreadSnapshot, ThreadSummary } from "../../shared/contracts";
import { ProjectRetrievalSettings } from "./ProjectRetrievalSettings";

/**
 * The dialogs left after Stage 4 (contract D4.9): rename and API key replace. Research, chatbot and settings are
 * screens now; the projects dialog stays only until the projects screen is wired.
 */
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };

type Props = {
  onResearchEvidence: (text: string, ownsSource?: () => boolean) => void;
  retrievalModels: GatewayModel[];
  renameDialog: RenameDialogState | null;
  closeRename: () => void;
  renameRef: React.RefObject<HTMLFormElement | null>;
  saveRenamedConversation: () => Promise<void>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  setRenameDialog: React.Dispatch<React.SetStateAction<RenameDialogState | null>>;
  projectsOpen: boolean;
  projectBusy: boolean;
  closeProjects: () => void;
  projectsRef: React.RefObject<HTMLDivElement | null>;
  selectedProjectId: string | null;
  setSelectedProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setProjectDraft: React.Dispatch<React.SetStateAction<{ name: string; instruction: string; }>>;
  projects: ProjectSummary[];
  projectDraft: { name: string; instruction: string; };
  saveProject: () => Promise<void>;
  removeProjectDocument: (projectId: string, documentId: string) => Promise<void>;
  addDocumentToProject: (projectId: string) => Promise<void>;
  thread: ThreadSnapshot | null;
  assignCurrentThreadToProject: (projectId?: string) => Promise<void>;
  createProjectThread: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  keyReplaceOpen: boolean;
  keyReplacing: boolean;
  closeKeyReplace: () => void;
  keyReplaceRef: React.RefObject<HTMLDivElement | null>;
  replacementKey: string;
  setReplacementKey: React.Dispatch<React.SetStateAction<string>>;
  replaceApiKey: () => Promise<void>;
};

export function AppDialogs({ retrievalModels, onResearchEvidence, renameDialog, closeRename, renameRef, saveRenamedConversation, renameInputRef, setRenameDialog, projectsOpen, projectBusy, closeProjects, projectsRef, selectedProjectId, setSelectedProjectId, setProjectDraft, projects, projectDraft, saveProject, removeProjectDocument, addDocumentToProject, thread, assignCurrentThreadToProject, createProjectThread, removeProject, keyReplaceOpen, keyReplacing, closeKeyReplace, keyReplaceRef, replacementKey, setReplacementKey, replaceApiKey }: Props) {
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
      {projectsOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !projectBusy) closeProjects();
      }}><div className="dialog-card projects-dialog" role="dialog" aria-modal="true"
        aria-labelledby="projects-title" ref={projectsRef} tabIndex={-1}>
        <div className="dialog-title"><FolderOpen size={21} /><h3 id="projects-title">프로젝트</h3></div>
        <p className="project-notice">의료경영 연구별 지침과 문서를 암호화해 이 기기에 보관합니다. 문서는 선택한 프로젝트 대화에만 사용됩니다.</p>
        <div className="project-layout">
          <nav className="project-list" aria-label="프로젝트 목록">
            <button type="button" className={selectedProjectId === null ? "selected" : ""} onClick={() => {
              setSelectedProjectId(null); setProjectDraft({ name: "", instruction: "" });
            }}><Plus size={14} /><span>새 프로젝트</span></button>
            {projects.map((item) => <button type="button" key={item.id}
              className={selectedProjectId === item.id ? "selected" : ""} onClick={() => {
                setSelectedProjectId(item.id); setProjectDraft({ name: item.name, instruction: item.instruction });
              }}><FolderOpen size={14} /><span>{item.name}</span><small>{item.threadCount}</small></button>)}
          </nav>
          <section className="project-editor">
            <label className="settings-field">이름
              <input value={projectDraft.name} maxLength={80} disabled={projectBusy}
                onChange={(event) => setProjectDraft((value) => ({ ...value, name: event.target.value }))} />
            </label>
            <label className="settings-field">프로젝트 지침
              <textarea value={projectDraft.instruction} maxLength={12000} disabled={projectBusy}
                placeholder="이 프로젝트의 역할, 분석 기준, 출력 형식을 적어 주세요."
                onChange={(event) => setProjectDraft((value) => ({ ...value, instruction: event.target.value }))} />
              <small>전역 지침 다음에 적용되고, 대화별 지침이 가장 구체적으로 적용됩니다.</small>
            </label>
            <button type="button" className="primary-button project-save" disabled={projectBusy || !projectDraft.name.trim()}
              onClick={() => void saveProject()}>{projectBusy ? "처리 중…" : selectedProjectId ? "변경 저장" : "프로젝트 만들기"}</button>
            {selectedProjectId && (() => {
              const selected = projects.find((item) => item.id === selectedProjectId);
              if (!selected) return null;
              return <>
                <div className="project-section-heading"><strong>문서 보관함</strong><span>{selected.documents.length}/20</span></div>
                <div className="project-documents">{selected.documents.length === 0
                  ? <small>저장된 문서가 없습니다.</small>
                  : selected.documents.map((document) => <div key={document.id}><FileText size={14} />
                    <span title={document.name}>{document.name}</span><small>{Math.ceil(document.size / 1024)}KB</small>
                    <button type="button" aria-label={`${document.name} 제거`} disabled={projectBusy}
                      onClick={() => void removeProjectDocument(selected.id, document.id)}><X size={13} /></button></div>)}</div>
                <button type="button" className="secondary-button project-add-doc" disabled={projectBusy}
                  onClick={() => void addDocumentToProject(selected.id)}><Paperclip size={15} /> 문서 추가</button>
                <ProjectRetrievalSettings key={`${selected.id}:${selected.documents.map((doc) => doc.id).join()}`} project={selected} models={retrievalModels} onEvidence={onResearchEvidence} />
                <div className="project-actions">
                  <button type="button" className="secondary-button" disabled={projectBusy || thread?.projectId === selected.id || thread?.target?.kind === "chatbot"}
                    onClick={() => void assignCurrentThreadToProject(selected.id)}>현재 대화 연결</button>
                  {thread?.projectId === selected.id && <button type="button" className="secondary-button" disabled={projectBusy}
                    onClick={() => void assignCurrentThreadToProject(undefined)}>현재 대화 연결 해제</button>}
                  <button type="button" className="secondary-button" disabled={projectBusy}
                    onClick={() => void createProjectThread(selected.id)}>이 프로젝트에서 새 대화</button>
                  <button type="button" className="danger-button" disabled={projectBusy}
                    onClick={() => void removeProject(selected.id)}><Trash2 size={14} /> 삭제</button>
                </div>
              </>;
            })()}
          </section>
        </div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeProjects}
          disabled={projectBusy}>닫기</button></div>
      </div></div>}
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
