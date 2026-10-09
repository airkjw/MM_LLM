import { Check, Clock, FileText, Lock, MessageSquare, Paperclip, Plus, SquarePen, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { GatewayModel, ProjectDocument, ProjectSummary, ThreadSummary } from "../../shared/contracts";
import type { RetrievalStatus } from "../../shared/document-retrieval";
import { ProjectRetrievalSettings } from "./ProjectRetrievalSettings";

/** A media job the host associates with this project. Jobs carry no conversation link today, so the host passes none. */
export type ProjectMediaItem = { id: string; kind: "image" | "video" | "stt"; label: string; status: string };
type Result = void | Promise<void>;
export type ProjectsScreenProps = {
  /** Header search entry (the shell's Cmd/Ctrl+K button) shown in the standard 52px body header. */
  headerSearch?: ReactNode;
  projects: ProjectSummary[];
  /** `null` shows the new-project form. */
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  /** Every conversation; the screen keeps the ones whose `projectId` matches. */
  threads: ThreadSummary[];
  currentThread: Pick<ThreadSummary, "id" | "projectId" | "target"> | null;
  models: GatewayModel[];
  /** A project operation is running: every action is disabled. */
  busy: boolean;
  /** Create (`projectId` null) or update; the host owns persistence, refresh and error reporting. */
  onSaveProject: (input: { name: string; instruction: string }, projectId: string | null) => Result;
  onDeleteProject: (projectId: string) => Result;
  /** Pick a document (native dialog), confirm de-identification and add it. */
  onAddDocument: (projectId: string) => Result;
  /** Dropped files take the same confirm-and-add flow; without this the zone is click-only. */
  onDropDocuments?: (projectId: string, files: File[]) => Result;
  onRemoveDocument: (projectId: string, documentId: string) => Result;
  onAssignCurrentThread: (projectId: string | undefined) => Result;
  onNewThread: (projectId: string) => Result;
  onOpenThread: (threadId: string) => void;
  onEvidence: (text: string, ownsSource?: () => boolean) => void;
  mediaItems?: ProjectMediaItem[];
  onOpenMediaItem?: (item: ProjectMediaItem) => void;
};

type Tab = "documents" | "threads" | "media";
const TABS: ReadonlyArray<Tab> = ["documents", "threads", "media"];
const MAX_DOCUMENTS = 20;

function documentKind(document: ProjectDocument): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(document.name)?.[1]?.toUpperCase();
  if (extension) return extension;
  return document.mime === "application/pdf" ? "PDF" : document.mime.split(/[/.+]/).pop()?.toUpperCase() ?? "";
}
const isPdf = (document: ProjectDocument) => document.mime === "application/pdf" || /\.pdf$/i.test(document.name);
function documentSize(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.ceil(size / 1024))}KB`;
}

type Badge = { state: "loading" | "done" | "indexing" | "waiting" | "none"; label: string; completed?: number; total?: number; title?: string };
/** Index state from the real retrieval status; the counts are chunk counts and nothing is estimated. */
export function indexBadge(document: ProjectDocument, status: RetrievalStatus | null): Badge {
  if (!status) return { state: "loading", label: "확인 중" };
  const item = status.documents.find((entry) => entry.id === document.id);
  if (!item || item.total <= 0) return { state: "none", label: `텍스트 없음${isPdf(document) ? " · PDF 직접" : ""}` };
  if (item.completed >= item.total) return { state: "done", label: `완료 · ${item.completed}/${item.total}`, completed: item.completed, total: item.total };
  if (status.running) return { state: "indexing", label: `색인 중 · ${item.completed}/${item.total}`, completed: item.completed, total: item.total };
  return { state: "waiting", label: "대기", completed: item.completed, total: item.total,
    title: `${item.completed}/${item.total}청크 색인됨 · 시작 전까지 대기` };
}

function IndexBadge({ document, status }: { document: ProjectDocument; status: RetrievalStatus | null }) {
  const badge = indexBadge(document, status);
  return <div className="project-index">
    <span className="project-index-badge" data-state={badge.state} title={badge.title}>
      {badge.state === "done" && <Check size={13} aria-hidden="true" />}
      {badge.state === "waiting" && <Clock size={13} aria-hidden="true" />}
      {badge.label}</span>
    {badge.state === "indexing" && <div className="project-progress" role="progressbar" aria-label={`${document.name} 색인 진행`}
      aria-valuemin={0} aria-valuemax={badge.total} aria-valuenow={badge.completed}>
      <span style={{ width: `${Math.round((badge.completed! / badge.total!) * 100)}%` }} /></div>}
  </div>;
}

export function ProjectsScreen(props: ProjectsScreenProps) {
  const { projects, selectedProjectId, onSelectProject } = props;
  const project = selectedProjectId ? projects.find((item) => item.id === selectedProjectId) : undefined;
  return <section className="project-screen" aria-label="프로젝트">
    <aside className="project-list-column">
      <div className="project-list-head"><h2>프로젝트</h2>
        <button type="button" className="icon-button" aria-label="새 프로젝트" disabled={props.busy} onClick={() => onSelectProject(null)}>
          <Plus size={16} aria-hidden="true" /></button></div>
      <nav className="project-nav" aria-label="프로젝트 목록">
        {projects.map((item) => <button type="button" key={item.id} aria-current={item.id === selectedProjectId ? "true" : undefined}
          onClick={() => onSelectProject(item.id)}>
          <span className="project-nav-name">{item.name}</span>
          <span className="project-nav-meta">문서 {item.documents.length} · 대화 {item.threadCount}</span></button>)}
        {!projects.length && <p className="project-nav-empty">프로젝트가 없습니다. 오른쪽에서 새 프로젝트를 만드세요.</p>}
      </nav>
      <div className="project-list-note"><Lock size={13} aria-hidden="true" />원본·청크·벡터는 기기 안에 암호화 보관</div>
    </aside>
    {project ? <ProjectDetail key={project.id} {...props} project={project} /> : <NewProject {...props} />}
  </section>;
}

function NewProject({ busy, onSaveProject, headerSearch }: ProjectsScreenProps) {
  const [name, setName] = useState(""); const [instruction, setInstruction] = useState("");
  return <div className="project-main">
    <div className="panel-header"><div className="panel-heading"><h2>새 프로젝트</h2></div>{headerSearch}<div className="panel-actions" /></div>
    <form className="project-new" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !busy) void onSaveProject({ name, instruction }, null); }}>
      <p className="project-notice">의료경영 연구별 지침과 문서를 암호화해 이 기기에 보관합니다. 문서는 선택한 프로젝트 대화에만 사용됩니다.</p>
      <label className="settings-field">이름
        <input value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label className="settings-field">프로젝트 지침
        <textarea value={instruction} maxLength={12000} disabled={busy} placeholder="이 프로젝트의 역할, 분석 기준, 출력 형식을 적어 주세요."
          onChange={(event) => setInstruction(event.target.value)} />
        <small>전역 지침 다음에 적용되고, 대화별 지침이 가장 구체적으로 적용됩니다.</small></label>
      <button type="submit" className="primary-button project-save" disabled={busy || !name.trim()}>{busy ? "처리 중…" : "프로젝트 만들기"}</button>
    </form></div>;
}

function ProjectDetail(props: ProjectsScreenProps & { project: ProjectSummary }) {
  const { project, busy, threads, currentThread, models } = props;
  const [tab, setTab] = useState<Tab>("documents");
  const [status, setStatus] = useState<RetrievalStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: project.name, instruction: project.instruction });
  const [dropActive, setDropActive] = useState(false);
  const savingFrom = useRef<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const projectThreads = threads.filter((thread) => thread.projectId === project.id);
  const linked = currentThread?.projectId === project.id;
  const documentsFull = project.documents.length >= MAX_DOCUMENTS;
  // An edit closes once the host reports changed project data; a failed save leaves the editor and draft in place.
  useEffect(() => {
    if (savingFrom.current !== null && savingFrom.current !== project.updatedAt) { savingFrom.current = null; setEditing(false); }
  }, [project.updatedAt]);
  function openEditor() {
    setDraft({ name: project.name, instruction: project.instruction }); setEditing(true);
    setTimeout(() => nameInput.current?.focus(), 0);
  }
  function moveTab(event: ReactKeyboardEvent<HTMLButtonElement>, current: Tab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.indexOf(current);
    const next = TABS[event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next);
    setTimeout(() => document.getElementById(`project-tab-${next}`)?.focus(), 0);
  }
  const dropProps = props.onDropDocuments ? {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); setDropActive(true); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault(); setDropActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length && !busy) void props.onDropDocuments!(project.id, files);
    }
  } : {};
  const counts: Record<Tab, string> = { documents: String(project.documents.length), threads: String(projectThreads.length),
    media: props.mediaItems ? String(props.mediaItems.length) : "" };
  const labels: Record<Tab, string> = { documents: "문서", threads: "대화", media: "미디어" };
  return <div className="project-main">
    <div className="panel-header">
      <div className="panel-heading"><h2 title={project.name}>{project.name}</h2></div>
      {props.headerSearch}
      <div className="panel-actions project-head-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={openEditor}><SquarePen size={15} aria-hidden="true" />지침 편집</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void props.onNewThread(project.id)}>이 프로젝트에서 새 대화</button>
      </div>
    </div>
    <div className="project-head">
      <div className="project-tabs" role="tablist" aria-label="프로젝트 내용">
        {TABS.map((value) => <button type="button" role="tab" key={value} id={`project-tab-${value}`} aria-controls="project-tab-panel"
          aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => moveTab(event, value)}>
          {labels[value]}{counts[value] && <span className="project-tab-count">{counts[value]}</span>}</button>)}
      </div>
    </div>
    <div className="project-body">
      <div className="project-content" id="project-tab-panel" role="tabpanel" aria-labelledby={`project-tab-${tab}`}>
        {tab === "documents" && <div className="project-card project-docs">
          <div className="project-docs-head"><strong>문서 보관함</strong><span>{project.documents.length}/{MAX_DOCUMENTS}</span></div>
          {project.documents.length === 0 ? <p className="project-empty">저장된 문서가 없습니다.</p>
            : <table className="project-doc-table"><thead><tr><th scope="col">이름</th><th scope="col">형식</th><th scope="col">크기</th>
              <th scope="col">검색 색인</th><th scope="col"><span className="sr-only">작업</span></th></tr></thead>
              <tbody>{project.documents.map((document) => <tr key={document.id}>
                <td><span className="project-doc-name" title={document.name}><FileText size={15} aria-hidden="true" /><span>{document.name}</span></span></td>
                <td className="project-mono">{documentKind(document)}</td><td className="project-mono">{documentSize(document.size)}</td>
                <td><IndexBadge document={document} status={status} /></td>
                <td><button type="button" className="project-doc-remove" aria-label={`${document.name} 제거`} disabled={busy}
                  onClick={() => void props.onRemoveDocument(project.id, document.id)}><X size={14} aria-hidden="true" /></button></td></tr>)}</tbody></table>}
          <button type="button" className={dropActive ? "project-dropzone drop-active" : "project-dropzone"} disabled={busy || documentsFull}
            onClick={() => void props.onAddDocument(project.id)} {...dropProps}>
            {props.onDropDocuments ? <Upload size={16} aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}
            {documentsFull ? `문서는 프로젝트당 ${MAX_DOCUMENTS}개까지 보관합니다` : `PDF · DOCX · XLSX 문서를 ${props.onDropDocuments ? "끌어 놓거나 " : ""}선택`}</button>
        </div>}
        {tab === "threads" && <div className="project-card">
          {projectThreads.length === 0 ? <p className="project-empty">이 프로젝트에 연결된 대화가 없습니다.</p>
            : <ul className="project-thread-list">{projectThreads.map((thread) => <li key={thread.id}>
              <button type="button" className="project-thread-row" onClick={() => props.onOpenThread(thread.id)}>
                <MessageSquare size={15} aria-hidden="true" /><span className="project-thread-title">{thread.title}</span>
                <span className="project-mono">{thread.messageCount}개 메시지</span></button></li>)}</ul>}
        </div>}
        {tab === "media" && <div className="project-card">
          {props.mediaItems?.length ? <ul className="project-thread-list">{props.mediaItems.map((item) => <li key={item.id}>
            <button type="button" className="project-media-row" disabled={!props.onOpenMediaItem} onClick={() => props.onOpenMediaItem?.(item)}>
              <span className="project-thread-title">{item.label}</span>
              <span className="project-mono">{item.status === "completed" ? "완료" : item.status === "failed" ? "실패" : "진행 중"}</span></button></li>)}</ul>
            : <p className="project-media-note">미디어 작업은 대화와 연결해 저장하지 않아 이 프로젝트에 모아 보여 주지 않습니다. 결과는 미디어 화면의 작업 목록에서 확인하세요.</p>}
        </div>}
      </div>
      <aside className="project-side">
        <div className="project-card project-retrieval"><ProjectRetrievalSettings key={`${project.id}:${project.documents.map((document) => document.id).join()}`}
          project={project} models={models} onEvidence={props.onEvidence} onStatus={setStatus} /></div>
        <div className="project-card project-instruction-card">
          <div className="project-docs-head"><strong>프로젝트 지침</strong>
            {!editing && <button type="button" className="project-link-button" disabled={busy} onClick={openEditor}>편집</button>}</div>
          {editing ? <form className="project-editor-form" onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim() || busy) return;
            savingFrom.current = project.updatedAt; void props.onSaveProject(draft, project.id);
          }}>
            <label className="settings-field">프로젝트 이름
              <input ref={nameInput} value={draft.name} maxLength={80} disabled={busy} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></label>
            <label className="settings-field">프로젝트 지침
              <textarea value={draft.instruction} maxLength={12000} disabled={busy} placeholder="이 프로젝트의 역할, 분석 기준, 출력 형식을 적어 주세요."
                onChange={(event) => setDraft((value) => ({ ...value, instruction: event.target.value }))} />
              <small>전역 지침 다음에 적용되고, 대화별 지침이 가장 구체적으로 적용됩니다.</small></label>
            <div className="project-editor-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => { savingFrom.current = null; setEditing(false); }}>취소</button>
              <button type="submit" className="primary-button" disabled={busy || !draft.name.trim()}>{busy ? "처리 중…" : "변경 저장"}</button></div>
          </form> : <p className="project-instruction">{project.instruction || "지침이 없습니다. 전역 지침만 적용됩니다."}</p>}
        </div>
        <div className="project-card project-manage">
          <div className="project-docs-head"><strong>대화 연결</strong></div>
          <div className="project-actions">
            <button type="button" className="secondary-button" disabled={busy || !currentThread || linked || currentThread.target?.kind === "chatbot"}
              onClick={() => void props.onAssignCurrentThread(project.id)}>현재 대화 연결</button>
            {linked && <button type="button" className="secondary-button" disabled={busy} onClick={() => void props.onAssignCurrentThread(undefined)}>현재 대화 연결 해제</button>}
            <button type="button" className="danger-button" disabled={busy} onClick={() => void props.onDeleteProject(project.id)}><Trash2 size={14} aria-hidden="true" />프로젝트 삭제</button>
          </div></div>
      </aside>
    </div>
  </div>;
}
