import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export const COMPACT_SIDEBAR_QUERY = "(max-width: 720px)";

/** Compact navigation starts closed; returning to desktop restores the visible workspace rail. */
export function sidebarOpenForViewport(compact: boolean): boolean {
  return !compact;
}

export function useResponsiveSidebarState() {
  const desktopOpen = useRef(true);
  const [open, updateOpen] = useState(() =>
    sidebarOpenForViewport(window.matchMedia(COMPACT_SIDEBAR_QUERY).matches));
  const setOpen = useCallback((value: SetStateAction<boolean>) => {
    updateOpen((current) => {
      const next = typeof value === "function" ? value(current) : value;
      if (!window.matchMedia(COMPACT_SIDEBAR_QUERY).matches) desktopOpen.current = next;
      return next;
    });
  }, []);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const changed = (event: MediaQueryListEvent) => updateOpen(event.matches ? false : desktopOpen.current);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return [open, setOpen] as const;
}
