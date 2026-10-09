import { Bot, CircleHelp, Edit3, FileText, FolderOpen, Paperclip, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import type { AppSettings, ChatbotBookmark, ChatbotUsageReport, GatewayModel, ProjectSummary, ThreadSnapshot, ThreadSummary } from "../../shared/contracts";
import { useState } from "react";
import { ProjectRetrievalSettings } from "./ProjectRetrievalSettings";
import { ResearchPanel } from "./ResearchPanel";
import { BackupPanel } from "./components/BackupPanel";
import { DiagnosticButton } from "./components/DiagnosticButton";
import { Notice, type NoticeState } from "./components/Notice";
import { type FocusReturnTarget } from "./components/Sidebar";

import { errorText } from "./ui-shared";
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
  toolsOpen: boolean;
  bookmarkBusy: boolean;
  closeTools: () => void;
  toolsRef: React.RefObject<HTMLDivElement | null>;
  toolsTab: "research" | "chatbot";
  toolsNotice: NoticeState | null;
  clearToolsNotice: () => void;
  bookmarkDraft: { alias: string; chatbotId: string; };
  setBookmarkDraft: React.Dispatch<React.SetStateAction<{ alias: string; chatbotId: string; }>>;
  saveBookmark: () => Promise<void>;
  bookmarks: ChatbotBookmark[];
  openChatbot: (bookmarkId: string) => Promise<void>;
  loadChatbotUsage: (bookmarkId: string) => Promise<void>;
  setBookmarks: React.Dispatch<React.SetStateAction<ChatbotBookmark[]>>;
  setError: (text: string) => void;
  chatbotUsage: { bookmarkId: string; report: ChatbotUsageReport; } | null;
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
  settingsOpen: boolean;
  settingsDraft: AppSettings | null;
  settingsSaving: boolean;
  closeSettings: () => void;
  settingsRef: React.RefObject<HTMLDivElement | null>;
  modelId: string;
  setSettingsDraft: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  saveGlobalSettings: () => Promise<void>;
  researchOpen?: boolean; setResearchOpen?: (open: boolean | ((open: boolean) => boolean)) => void;
};

export function AppDialogs({ retrievalModels, onResearchEvidence, renameDialog, closeRename, renameRef, saveRenamedConversation, renameInputRef, setRenameDialog, toolsOpen, bookmarkBusy, closeTools, toolsRef, toolsTab, toolsNotice, clearToolsNotice, bookmarkDraft, setBookmarkDraft, saveBookmark, bookmarks, openChatbot, loadChatbotUsage, setBookmarks, setError, chatbotUsage, projectsOpen, projectBusy, closeProjects, projectsRef, selectedProjectId, setSelectedProjectId, setProjectDraft, projects, projectDraft, saveProject, removeProjectDocument, addDocumentToProject, thread, assignCurrentThreadToProject, createProjectThread, removeProject, keyReplaceOpen, keyReplacing, closeKeyReplace, keyReplaceRef, replacementKey, setReplacementKey, replaceApiKey, settingsOpen, settingsDraft, settingsSaving, closeSettings, settingsRef, modelId, setSettingsDraft, saveGlobalSettings, ...researchControl }: Props) {
  const [researchOpenState, setResearchOpenState] = useState(false);
  const [researchOpen, setResearchOpen] = researchControl.setResearchOpen
    ? [Boolean(researchControl.researchOpen), researchControl.setResearchOpen] : [researchOpenState, setResearchOpenState];
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
      {toolsOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !bookmarkBusy) closeTools();
      }}><div className="dialog-card workspace-tools-dialog" role="dialog" aria-modal="true"
        aria-labelledby="workspace-tools-title" ref={toolsRef} tabIndex={-1}>
        <div className="dialog-title">{researchOpen ? <Search size={21} /> : <Bot size={21} />}<h3 id="workspace-tools-title">{researchOpen ? "논문·법령 검색" : "Studio Chatbot"}</h3>
          <button type="button" className="icon-button dialog-close" aria-label="워크스페이스 도구 닫기" onClick={closeTools}
            disabled={bookmarkBusy}><X size={18} /></button></div>
        <button type="button" className="secondary-button" aria-pressed={researchOpen}
          onClick={() => setResearchOpen((open) => !open)} disabled={bookmarkBusy}>
          {researchOpen ? "기존 도구로 돌아가기" : "논문·법령 검색"}</button>
        {researchOpen ? <ResearchPanel onEvidence={onResearchEvidence} /> : <section className="chatbot-panel" aria-label="Studio Chatbot 관리">
          <div className="audit-notice" role="note"><ShieldCheck size={16} />Studio Chatbot은 원격 서비스에 대화 감사 로그를 저장할 수 있습니다.
            모델·전역/프로젝트 지침·첨부는 전송하지 않고 문서화된 텍스트 메시지만 보냅니다.</div>
          <div className="bookmark-form"><label>별칭<input value={bookmarkDraft.alias} maxLength={80} disabled={bookmarkBusy}
            onChange={(event) => setBookmarkDraft((value) => ({ ...value, alias: event.target.value }))} /></label>
            <label>Chatbot ID<input value={bookmarkDraft.chatbotId} maxLength={200} disabled={bookmarkBusy}
              onChange={(event) => setBookmarkDraft((value) => ({ ...value, chatbotId: event.target.value }))} /></label>
            <button type="button" className="primary-button" disabled={bookmarkBusy || !bookmarkDraft.alias.trim() || !bookmarkDraft.chatbotId.trim()}
              onClick={() => void saveBookmark()}>북마크 저장</button></div>
          <div className="bookmark-list">{bookmarks.length === 0 && <p>저장된 챗봇이 없습니다. ChatKHU Studio에서 받은 ID를 직접 등록하세요.</p>}
            {bookmarks.map((bookmark) => <div key={bookmark.id}><Bot size={16} /><span><strong>{bookmark.alias}</strong>
              <small>{bookmark.chatbotId}</small></span><button type="button" className="secondary-button" disabled={bookmarkBusy}
                onClick={() => void openChatbot(bookmark.id)}>대화 시작</button><button type="button" className="secondary-button"
                disabled={bookmarkBusy} onClick={() => void loadChatbotUsage(bookmark.id)}>사용량</button><button type="button" className="icon-button"
                aria-label={`${bookmark.alias} 삭제`} disabled={bookmarkBusy} onClick={() => void window.mmllm.deleteChatbotBookmark(bookmark.id)
                  .then(async () => setBookmarks(await window.mmllm.listChatbotBookmarks())).catch((error) => setError(errorText(error)))}>
                <Trash2 size={14} /></button></div>)}</div>
          {chatbotUsage && <section className="chatbot-usage" aria-live="polite"><strong>챗봇 사용량</strong>
            <small>{new Date(chatbotUsage.report.retrievedAt).toLocaleString("ko-KR")}</small>
            {chatbotUsage.report.summary.map((line) => <div key={line}>{line}</div>)}
            <details><summary>안전하게 정규화된 상세 응답</summary>
              <pre>{JSON.stringify(chatbotUsage.report.data, null, 2)}</pre></details></section>}
        </section>}
        <Notice notice={toolsNotice} onClose={clearToolsNotice} />
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeTools}
          disabled={bookmarkBusy}>닫기</button></div>
      </div></div>}
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
      {settingsOpen && settingsDraft && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !settingsSaving) closeSettings();
      }}><div className="dialog-card settings-dialog"
        role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={settingsRef} tabIndex={-1}>
        <div className="dialog-title"><Settings size={21} /><h3 id="settings-title">앱 설정</h3></div>
        <p className="settings-description">화면과 답변의 기본 방식을 설정하세요.</p>
        <div className="settings-inline"><label>테마<select value={settingsDraft.theme} disabled={settingsSaving}
          onChange={(event) => setSettingsDraft((value) => value ? { ...value, theme: event.target.value as AppSettings["theme"] } : value)}>
          <option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option>
        </select></label><label>글자 크기<select value={settingsDraft.fontSize} disabled={settingsSaving}
          onChange={(event) => setSettingsDraft((value) => value ? { ...value, fontSize: event.target.value as AppSettings["fontSize"] } : value)}>
          <option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option>
        </select></label></div>
        <label className="settings-field">전역 기본 지침
          <textarea value={settingsDraft.defaultInstruction} maxLength={12000} disabled={settingsSaving}
            onChange={(event) => setSettingsDraft((value) => value ? { ...value, defaultInstruction: event.target.value } : value)} />
          <small>모든 대화에 적용됩니다. 대화별 지침은 더 구체적인 경우 우선합니다.</small>
        </label>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeSettings}
          disabled={settingsSaving}>취소</button>
          <button type="button" className="primary-button" onClick={() => void saveGlobalSettings()}
            disabled={settingsSaving}>{settingsSaving ? "저장 중…" : "저장"}</button></div>
        <details className="settings-disclosure"><summary>백업 · 복원</summary><BackupPanel /></details>
        <details className="settings-disclosure"><summary>진단 정보</summary><DiagnosticButton stage="general" modelId={modelId} /></details>
      </div></div>}
  </>;
}
