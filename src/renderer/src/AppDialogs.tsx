import { Bot, CircleHelp, Columns3, Edit3, FileText, FolderOpen, Paperclip, Plus, Search, Settings, ShieldCheck, Sparkles, Square, Trash2, X } from "lucide-react";
import { serializeCompareAnalysis } from "../../shared/compare-export";
import type { AppSettings, ChatbotBookmark, ChatbotUsageReport, CompareRun, GatewayModel, PickedAttachment, ProjectSummary, ThreadSearchResult, ThreadSnapshot, ThreadSummary, WebSearchMode } from "../../shared/contracts";
import { BackupPanel } from "./components/BackupPanel";
import { DiagnosticButton } from "./components/DiagnosticButton";
import { type FocusReturnTarget } from "./components/Sidebar";
import { modelLabel } from "./model-names";

import { errorText, MarkdownText } from "./ui-shared";
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };

type Props = {
  renameDialog: RenameDialogState | null;
  closeRename: () => void;
  renameRef: React.RefObject<HTMLFormElement | null>;
  saveRenamedConversation: () => Promise<void>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  setRenameDialog: React.Dispatch<React.SetStateAction<RenameDialogState | null>>;
  toolsOpen: boolean;
  compareBusy: boolean;
  compareSynthesisBusy: boolean;
  bookmarkBusy: boolean;
  closeTools: () => void;
  toolsRef: React.RefObject<HTMLDivElement | null>;
  toolsTab: "compare" | "chatbot";
  comparePrompt: string;
  setComparePrompt: React.Dispatch<React.SetStateAction<string>>;
  llmModels: GatewayModel[];
  compareModels: string[];
  setCompareModels: React.Dispatch<React.SetStateAction<string[]>>;
  compareMode: WebSearchMode;
  setCompareMode: React.Dispatch<React.SetStateAction<WebSearchMode>>;
  addCompareAttachment: () => Promise<void>;
  compareAttachments: PickedAttachment[];
  setCompareAttachments: React.Dispatch<React.SetStateAction<PickedAttachment[]>>;
  compareConfirmed: boolean;
  setCompareConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
  compareStopRef: React.RefObject<(() => void) | null>;
  startCompare: () => Promise<void>;
  compareRun: CompareRun | null;
  continueCompare: (runId: string, selectedModel: string) => Promise<void>;
  compareSynthesisReady: boolean;
  compareSynthesisModelAvailable: boolean;
  compareSynthesisStopRef: React.RefObject<(() => void) | null>;
  startCompareSynthesis: () => Promise<void>;
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
  searchOpen: boolean;
  closeSearch: () => void;
  searchRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  searchResults: ThreadSearchResult[];
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectThread: (id: string) => Promise<void>;
  settingsOpen: boolean;
  settingsDraft: AppSettings | null;
  settingsSaving: boolean;
  closeSettings: () => void;
  settingsRef: React.RefObject<HTMLDivElement | null>;
  modelId: string;
  setSettingsDraft: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  saveGlobalSettings: () => Promise<void>;
};

export function AppDialogs({ renameDialog, closeRename, renameRef, saveRenamedConversation, renameInputRef, setRenameDialog, toolsOpen, compareBusy, compareSynthesisBusy, bookmarkBusy, closeTools, toolsRef, toolsTab, comparePrompt, setComparePrompt, llmModels, compareModels, setCompareModels, compareMode, setCompareMode, addCompareAttachment, compareAttachments, setCompareAttachments, compareConfirmed, setCompareConfirmed, compareStopRef, startCompare, compareRun, continueCompare, compareSynthesisReady, compareSynthesisModelAvailable, compareSynthesisStopRef, startCompareSynthesis, bookmarkDraft, setBookmarkDraft, saveBookmark, bookmarks, openChatbot, loadChatbotUsage, setBookmarks, setError, chatbotUsage, projectsOpen, projectBusy, closeProjects, projectsRef, selectedProjectId, setSelectedProjectId, setProjectDraft, projects, projectDraft, saveProject, removeProjectDocument, addDocumentToProject, thread, assignCurrentThreadToProject, createProjectThread, removeProject, keyReplaceOpen, keyReplacing, closeKeyReplace, keyReplaceRef, replacementKey, setReplacementKey, replaceApiKey, searchOpen, closeSearch, searchRef, searchQuery, setSearchQuery, searchResults, setSearchOpen, selectThread, settingsOpen, settingsDraft, settingsSaving, closeSettings, settingsRef, modelId, setSettingsDraft, saveGlobalSettings }: Props) {
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
        if (event.target === event.currentTarget && !compareBusy && !compareSynthesisBusy && !bookmarkBusy) closeTools();
      }}><div className={`dialog-card workspace-tools-dialog${compareRun && toolsTab === "compare" ? " has-results" : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="workspace-tools-title" ref={toolsRef} tabIndex={-1}>
        <div className="dialog-title">{toolsTab === "compare" ? <Columns3 size={21} /> : <Bot size={21} />}<h3 id="workspace-tools-title">{toolsTab === "compare" ? "모델 비교" : "Studio Chatbot"}</h3>
          <button type="button" className="icon-button dialog-close" aria-label="워크스페이스 도구 닫기" onClick={closeTools}
            disabled={compareBusy || compareSynthesisBusy || bookmarkBusy}><X size={18} /></button></div>
        {toolsTab === "compare" ? <section className="compare-panel" aria-label="모델 답변 비교">
          <p>같은 질문과 준비된 자료를 2~3개 모델에 각각 전송합니다. 웹 근거는 한 번만 조사해 모든 모델에 동일하게 제공합니다.</p>
          <details className="compare-configuration" open><summary>비교 설정 <span>{compareModels.length}/3개 모델 선택</span></summary>
          <label className="settings-field">질문
            <textarea value={comparePrompt} maxLength={100000} disabled={compareBusy || compareSynthesisBusy}
              onChange={(event) => setComparePrompt(event.target.value)} placeholder="비교할 질문을 입력하세요" />
          </label>
          <fieldset className="compare-models"><legend>모델 2~3개</legend>{llmModels.map((model) => <label key={model.id}>
            <input type="checkbox" checked={compareModels.includes(model.id)} disabled={compareBusy || compareSynthesisBusy ||
              !compareModels.includes(model.id) && compareModels.length >= 3} onChange={(event) => setCompareModels((items) =>
                event.target.checked ? [...items, model.id] : items.filter((id) => id !== model.id))} />
            <span>{modelLabel(model.id)}</span></label>)}</fieldset>
          <div className="compare-controls"><label>웹 근거<select value={compareMode} disabled={compareBusy || compareSynthesisBusy}
            onChange={(event) => setCompareMode(event.target.value as WebSearchMode)}>
            <option value="always">항상 검색 · 공통 1회</option><option value="auto">필요할 때 검색</option>
            <option value="deep">딥리서치 · 최대 5회 조사 + 모델별 합성</option><option value="off">검색 안 함</option>
          </select></label><button type="button" className="secondary-button" disabled={compareBusy || compareSynthesisBusy}
            onClick={() => void addCompareAttachment()}><Paperclip size={14} /> 첨부</button></div>
          {compareAttachments.length > 0 && <><div className="attachment-row">{compareAttachments.map((item) =>
            <span className="attachment-chip" key={item.id}>{item.name}<button type="button" disabled={compareBusy || compareSynthesisBusy}
              onClick={() => { void window.mmllm.discardAttachments([item.id]);
                setCompareAttachments((items) => items.filter((value) => value.id !== item.id)); }}><X size={12} /></button></span>)}</div>
            <label className="deid-check"><input type="checkbox" checked={compareConfirmed} disabled={compareBusy || compareSynthesisBusy}
              onChange={(event) => setCompareConfirmed(event.target.checked)} />
              환자 식별정보나 개인정보를 제거했습니다. 자료는 선택한 모델 수만큼 외부 전송·과금될 수 있습니다.</label></>}
          <div className="compare-run-actions">{compareBusy
            ? <button type="button" className="secondary-button" onClick={() => compareStopRef.current?.()}><Square size={14} /> 중단</button>
            : <button type="button" className="primary-button" disabled={compareSynthesisBusy || !comparePrompt.trim() || compareModels.length < 2}
              onClick={() => void startCompare()}><Columns3 size={15} /> 비교 실행</button>}</div></details>
          {compareRun && <><h4 className="compare-step">모델별 답변 <small>관점과 근거를 나란히 검토하세요</small></h4><div className="compare-results" aria-live="polite">{compareRun.results.map((result) => <article key={result.modelId}>
            <header><strong>{modelLabel(result.modelId)}</strong><span>{{ running: "답변 중", completed: "완료", incomplete: "일부 완료", failed: "실패", cancelled: "중단" }[result.status]}</span></header>
            <div className="compare-result-body">{result.error
              ? <span className="compare-result-plain">{result.error}</span>
              : result.text ? <MarkdownText text={result.text} />
                : <span className="compare-result-plain">응답을 기다리는 중…</span>}</div>
            {result.text && result.status !== "running" && <button type="button" className="secondary-button"
              disabled={compareBusy || compareSynthesisBusy}
              onClick={() => void continueCompare(compareRun.id, result.modelId)}>이 모델과 대화 이어가기</button>}
          </article>)}</div>
          {compareSynthesisReady && <div className="compare-synthesis-actions">
            <button type="button" className={compareSynthesisBusy ? "secondary-button" : "primary-button"}
              disabled={!compareSynthesisModelAvailable}
              onClick={() => compareSynthesisBusy ? compareSynthesisStopRef.current?.() : void startCompareSynthesis()}>
              {compareSynthesisBusy ? <><Square size={14} /> 종합분석 중단</> : <><Sparkles size={15} />
                {compareRun.synthesis?.text ? "다시 분석" : "종합분석"}</>}
            </button>
            <small>{compareSynthesisModelAvailable
              ? "GPT-5.6 Sol이 답변 A·B·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다."
              : "현재 API 키에서 GPT-5.6 Sol을 사용할 수 없어 종합분석을 실행할 수 없습니다."}</small>
          </div>}
          {compareRun.synthesis && <section className="compare-synthesis" aria-live="polite">
            <p className="compare-synthesis-warning">답변 간 합의만으로 정답이 확정되지는 않습니다.
              아래의 사실 검토와 불확실성을 함께 확인해 주세요.
              {compareRun.sharedEvidence ? " 공통 웹 근거를 비교 자료에 포함했습니다." : " 공통 웹 근거가 없어 별도 출처 확인이 필요합니다."}</p>
            {compareRun.synthesis.text && <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => {
                void navigator.clipboard.writeText(serializeCompareAnalysis(compareRun)).catch(() => setError("종합분석 복사에 실패했습니다."));
              }}>종합분석 복사</button>
              <button type="button" className="secondary-button" disabled={compareSynthesisBusy}
                onClick={() => void window.mmllm.exportCompareRun(compareRun.id).catch((error) => setError(errorText(error)))}>Markdown 저장</button>
            </div>}
            <header><span><Sparkles size={16} /><strong>{modelLabel(compareRun.synthesis.modelId)} 종합 분석</strong></span>
              <span>{{ running: "분석 중", completed: "완료", incomplete: "일부 완료", failed: "실패",
                cancelled: "중단됨" }[compareRun.synthesis.status]}</span></header>
            <div className="compare-synthesis-legend">{compareRun.results.map((result, index) =>
              <span key={result.modelId}>답변 {String.fromCharCode(65 + index)} · {modelLabel(result.modelId)}</span>)}</div>
            <div className="compare-synthesis-body">{compareRun.synthesis.text
              ? <MarkdownText text={compareRun.synthesis.text} />
              : <span className="compare-result-plain">{compareRun.synthesis.error ??
                (compareRun.synthesis.status === "running" ? "종합분석 응답을 기다리는 중…"
                  : "표시할 종합분석 결과가 없습니다. 종합분석을 다시 실행해 주세요.")}</span>}</div>
            {compareRun.synthesis.error && compareRun.synthesis.text &&
              <div className="compare-synthesis-warning" role="status">{compareRun.synthesis.error}</div>}
          </section>}
          </>}
        </section> : <section className="chatbot-panel" aria-label="Studio Chatbot 관리">
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
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeTools}
          disabled={compareBusy || compareSynthesisBusy || bookmarkBusy}>닫기</button></div>
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
      {searchOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSearch();
      }}><div className="dialog-card search-dialog" role="dialog"
        aria-modal="true" aria-labelledby="search-title" ref={searchRef} tabIndex={-1}>
        <div className="dialog-title"><Search size={21} /><h3 id="search-title">대화 검색</h3></div>
        <input className="dialog-search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="제목이나 대화 내용 검색" aria-label="대화 검색어" />
        <div className="search-results">{searchQuery.trim() && !searchResults.length &&
          <div className="empty-models">검색 결과가 없습니다.</div>}
          {searchResults.map((item) => <button type="button" key={item.id} onClick={() => {
            setSearchOpen(false); void selectThread(item.id);
          }}><strong>{item.title}</strong><small>{item.snippet}</small></button>)}</div>
        <button type="button" className="secondary-button" onClick={closeSearch}>닫기</button>
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
