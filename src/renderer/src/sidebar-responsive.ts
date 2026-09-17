import { useEffect, useState } from "react";

export const COMPACT_SIDEBAR_QUERY = "(max-width: 720px)";

/** Compact navigation starts closed; returning to desktop restores the visible workspace rail. */
export function sidebarOpenForViewport(compact: boolean): boolean {
  return !compact;
}

export function useResponsiveSidebarState() {
  const [open, setOpen] = useState(() =>
    sidebarOpenForViewport(window.matchMedia(COMPACT_SIDEBAR_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const changed = (event: MediaQueryListEvent) => setOpen(sidebarOpenForViewport(event.matches));
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return [open, setOpen] as const;
}
