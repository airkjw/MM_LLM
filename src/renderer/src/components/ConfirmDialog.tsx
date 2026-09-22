import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "../use-focus-layer";

export type Confirmation = { title: string; message: string; confirmLabel: string; danger?: boolean };
const Context = createContext<((options: Confirmation) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Confirmation | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const titleId = useId(); const detailId = useId();
  const settle = useCallback((accepted: boolean) => {
    resolver.current?.(accepted); resolver.current = null; setPending(null);
  }, []);
  const close = useCallback(() => settle(false), [settle]);
  const ref = useDialogFocus(Boolean(pending), close);
  const confirm = useCallback((options: Confirmation) => {
    // Never silently replace an unanswered confirmation with another action.
    if (resolver.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; setPending(options); });
  }, []);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);
  return <Context.Provider value={confirm}>{children}{pending &&
    <div className="dialog-backdrop confirmation-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={detailId} ref={ref} tabIndex={-1}>
        <h2 id={titleId}>{pending.title}</h2><p id={detailId}>{pending.message}</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={close}>취소</button>
          <button type="button" className={pending.danger ? "danger-button" : "primary-button"}
            onClick={() => settle(true)}>{pending.confirmLabel}</button>
        </div>
      </div>
    </div>}
  </Context.Provider>;
}

export function useConfirm() {
  const confirm = useContext(Context);
  if (!confirm) throw new Error("ConfirmProvider is required");
  return confirm;
}
