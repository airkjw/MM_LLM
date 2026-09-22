import { useCallback, useState } from "react";
import { X } from "lucide-react";

export type NoticeState = { id: number; tone: "error" | "info" | "success"; text: string };
export function useNotice() {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const show = useCallback((tone: NoticeState["tone"], text: string) => {
    setNotice(text ? { tone, text, id: Date.now() } : null);
  }, []);
  const setError = useCallback((text: string) => show("error", text), [show]);
  const setInfo = useCallback((text: string) => show("info", text), [show]);
  const setSuccess = useCallback((text: string) => show("success", text), [show]);
  const clear = useCallback(() => setNotice(null), []);
  return { notice, setError, setInfo, setSuccess, clear };
}

export function Notice({ notice, onClose, floating = false }: {
  notice: NoticeState | null; onClose: () => void; floating?: boolean;
}) {
  if (!notice) return null;
  return <div className={`${floating ? "app-error" : "inline-error"} notice-${notice.tone}`}
    role={notice.tone === "error" ? "alert" : "status"} aria-atomic="true">
    <span>{notice.tone === "error" ? "오류: " : notice.tone === "success" ? "완료: " : "안내: "}{notice.text}</span>
    <button type="button" aria-label="알림 닫기" onClick={onClose}><X size={14} /></button>
  </div>;
}
