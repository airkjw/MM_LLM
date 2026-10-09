import { useRef } from "react";
import { Bot, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ChatbotBookmark, ChatbotUsageReport } from "../../shared/contracts";

export type ChatbotStatus = "connected" | "check";
/** List metadata: "studio" plus a status only when getChatbotUsage answered (D4.4: no guessing). */
export function chatbotMeta(status: ChatbotStatus | undefined): string {
  return status === "connected" ? "studio · 연결됨" : status === "check" ? "studio · 권한 확인 필요" : "studio";
}

export type ChatbotScreenProps = {
  bookmarks: ChatbotBookmark[]; selectedId: string | null; onSelect: (id: string) => void;
  status: Record<string, ChatbotStatus>; busy: boolean;
  draft: { alias: string; chatbotId: string }; onDraftChange: (draft: { alias: string; chatbotId: string }) => void;
  onSave: () => void; onOpen: (id: string) => void; onUsage: (id: string) => void; onDelete: (bookmark: ChatbotBookmark) => void;
  usage: { bookmarkId: string; report: ChatbotUsageReport } | null;
  /** True when the kept-alive conversation next to this column is the selected chatbot's thread. */
  conversationShown: boolean;
};

/**
 * Studio chatbot screen (contract D4.4): the bookmark list takes the second column. The body is either the
 * existing ChatPanel in chatbot-target mode (the App's single conversation slot, rendered beside this column) or,
 * before a conversation is started, the selected bookmark's actions, the existing bookmark form and usage report.
 */
export function ChatbotScreen({ bookmarks, selectedId, onSelect, status, busy, draft, onDraftChange, onSave, onOpen, onUsage,
  onDelete, usage, conversationShown }: ChatbotScreenProps) {
  const aliasRef = useRef<HTMLInputElement>(null);
  const selected = bookmarks.find((item) => item.id === selectedId) ?? null;
  return <>
    <div className="screen-column chatbot-column" role="group" aria-label="Studio 챗봇 목록">
      <div className="list-header"><h2 className="list-title">Studio 챗봇</h2>
        <div className="list-header-actions"><button type="button" className="icon-button new-chat-button" aria-label="새 챗봇 추가"
          title="새 챗봇 추가" onClick={() => {
            onSelect("");
            window.requestAnimationFrame(() => aliasRef.current?.focus());
          }}><Plus size={16} aria-hidden="true" /></button></div></div>
      <div className="chatbot-list thread-list">
        {bookmarks.length === 0 && <p className="list-empty">저장된 챗봇이 없습니다. ChatKHU Studio에서 받은 ID를 직접 등록하세요.</p>}
        {bookmarks.map((bookmark) => <div key={bookmark.id} className={`thread-item${bookmark.id === selectedId ? " selected" : ""}`}>
          <button type="button" className="list-row" aria-current={bookmark.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(bookmark.id)}>
            <span className="thread-title">{bookmark.alias}</span>
            <span className="thread-meta">{chatbotMeta(status[bookmark.id])}</span></button></div>)}
      </div>
      <div className="chatbot-list-note"><strong>챗봇은 텍스트만 주고받습니다</strong>
        <small>파일 첨부·웹 검색·모델 비교는 일반 대화에서 사용하세요.</small></div>
    </div>
    {!conversationShown && <section className="chatbot-detail" aria-labelledby="chatbot-detail-title">
      <div className="panel-header"><div className="panel-heading"><h2 id="chatbot-detail-title">
        {selected ? selected.alias : "새 챗봇 추가"}</h2></div>
        {selected && <span className="chatbot-badge">ChatKHU Studio</span>}</div>
      <div className="chatbot-detail-body">
        <div className="audit-notice" role="note"><ShieldCheck size={16} aria-hidden="true" />Studio Chatbot은 원격 서비스에 대화 감사 로그를 저장할 수 있습니다.
          모델·전역/프로젝트 지침·첨부는 전송하지 않고 문서화된 텍스트 메시지만 보냅니다.</div>
        {selected && <div className="chatbot-actions">
          <span className="chatbot-id"><Bot size={16} aria-hidden="true" />{selected.chatbotId}</span>
          <button type="button" className="primary-button" disabled={busy} onClick={() => onOpen(selected.id)}>대화 시작</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onUsage(selected.id)}>사용량</button>
          <button type="button" className="icon-button" aria-label={`${selected.alias} 삭제`} disabled={busy}
            onClick={() => onDelete(selected)}><Trash2 size={14} aria-hidden="true" /></button>
        </div>}
        {usage && usage.bookmarkId === selected?.id && <section className="chatbot-usage" aria-live="polite"><strong>챗봇 사용량</strong>
          <small>{new Date(usage.report.retrievedAt).toLocaleString("ko-KR")}</small>
          {usage.report.summary.map((line) => <div key={line} className="chatbot-usage-line">{line}</div>)}
          <details><summary>안전하게 정규화된 상세 응답</summary>
            <pre>{JSON.stringify(usage.report.data, null, 2)}</pre></details></section>}
        <h3 className="settings-section-title">챗봇 북마크 추가</h3>
        <div className="bookmark-form"><label>별칭<input ref={aliasRef} value={draft.alias} maxLength={80} disabled={busy}
          onChange={(event) => onDraftChange({ ...draft, alias: event.target.value })} /></label>
          <label>Chatbot ID<input value={draft.chatbotId} maxLength={200} disabled={busy}
            onChange={(event) => onDraftChange({ ...draft, chatbotId: event.target.value })} /></label>
          <button type="button" className="primary-button" disabled={busy || !draft.alias.trim() || !draft.chatbotId.trim()}
            onClick={onSave}>북마크 저장</button></div>
      </div>
    </section>}
  </>;
}
