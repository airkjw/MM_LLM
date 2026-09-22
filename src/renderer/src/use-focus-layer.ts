import { useCallback, useEffect, useRef, type RefObject } from "react";

export type FocusLayerCloseReason = "escape" | "outside" | "programmatic";
export type FocusLayerMode = "modal" | "nonmodal" | "menu";

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])", "select:not([disabled])", "summary", "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

type RestoreDecision = { reason: FocusLayerCloseReason; restore?: boolean };

function usableFocusTarget(target: HTMLElement | null | undefined): target is HTMLElement {
  if (!target?.isConnected || target === document.body || target === document.documentElement) return false;
  if (target.closest("[hidden], [aria-hidden='true']")) return false;
  const collapsedSidebar = target.closest<HTMLElement>(".sidebar.collapsed");
  if (collapsedSidebar && (collapsedSidebar.dataset.compact === "true" ||
    !target.matches(".sidebar-toggle") && !target.closest(".rail-actions, .rail-footer"))) return false;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS" && !parent.hasAttribute("open")) {
      const summary = parent.querySelector(":scope > summary");
      if (!summary?.contains(target)) return false;
    }
  }
  if (target.matches(".sidebar-mobile-open:not(.visible)")) return false;
  if (target instanceof HTMLButtonElement && target.disabled) return false;
  return true;
}

function focusableWithin(layer: HTMLElement | null, selector = FOCUSABLE) {
  return Array.from(layer?.querySelectorAll<HTMLElement>(selector) ?? []).filter(usableFocusTarget);
}

function adjacentControl(
  trigger: HTMLElement | null | undefined,
  layer: HTMLElement | null,
  boundary: HTMLElement | null,
  backwards: boolean
) {
  if (!trigger) return null;
  const controls = Array.from((boundary ?? document).querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((candidate) => !layer?.contains(candidate) && usableFocusTarget(candidate));
  const triggerIndex = controls.indexOf(trigger);
  if (triggerIndex < 0) return null;
  const nextIndex = triggerIndex + (backwards ? -1 : 1);
  if (boundary && controls.length) return controls[(nextIndex + controls.length) % controls.length];
  return controls[nextIndex] ?? trigger;
}

function keepTabInside(layer: HTMLElement | null, items: HTMLElement[], event: KeyboardEvent) {
  if (!items.length) { event.preventDefault(); layer?.focus(); return; }
  const first = items[0]; const last = items.at(-1)!;
  if (!layer?.contains(document.activeElement)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

export type FocusLayerOptions = {
  active: boolean;
  mode: FocusLayerMode;
  onClose: (reason: FocusLayerCloseReason) => void;
  canClose?: boolean;
  closeOnOutside?: boolean;
  restoreTo?: RefObject<HTMLElement | null>;
  restoreFallback?: () => HTMLElement | null;
};

/**
 * Shared keyboard/focus behavior for App dialogs and Sidebar layers.
 * Modal layers trap Tab. Menus use roving arrow focus. Non-modal layers leave Tab alone
 * unless they are nested in a modal, where they share only the parent's outer boundary.
 */
export function useFocusLayer<T extends HTMLElement>({
  active, mode, onClose, canClose = true, closeOnOutside = false, restoreTo, restoreFallback
}: FocusLayerOptions) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const restoreToRef = useRef(restoreTo);
  const restoreFallbackRef = useRef(restoreFallback);
  const closeDecisionRef = useRef<RestoreDecision | null>(null);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;
  restoreToRef.current = restoreTo;
  restoreFallbackRef.current = restoreFallback;

  const requestClose = useCallback((reason: FocusLayerCloseReason, restore?: boolean) => {
    if (!canCloseRef.current) {
      ref.current?.focus();
      return false;
    }
    closeDecisionRef.current = { reason, restore };
    onCloseRef.current(reason);
    return true;
  }, []);

  useEffect(() => {
    if (!active) return;
    closeDecisionRef.current = null;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackContainer = opener?.closest<HTMLElement>(
      '[role="dialog"], .sidebar, .thread-list, .main-area'
    ) ?? null;
    const layer = ref.current;
    layer?.setAttribute("data-focus-layer", mode);
    const focusable = () => focusableWithin(layer,
      mode === "menu" ? '[role="menuitem"]:not([aria-disabled="true"])' : FOCUSABLE
    );
    const frame = window.requestAnimationFrame(() => (focusable()[0] ?? layer)?.focus());
    const isTopLayer = () => Array.from(document.querySelectorAll<HTMLElement>("[data-focus-layer]")).at(-1) === layer;

    const keydown = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose("escape", true);
        return;
      }
      const items = focusable();
      if (mode === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
        event.preventDefault();
        const selected = items.indexOf(document.activeElement as HTMLElement);
        const current = selected < 0 ? 0 : selected;
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
        items.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
        items[next].focus();
        return;
      }
      if (mode === "menu" && event.key === "Tab") {
        const trigger = restoreToRef.current?.current;
        const containingModal = trigger?.closest<HTMLElement>('[data-focus-layer="modal"]');
        const destination = adjacentControl(trigger, layer, containingModal ?? null, event.shiftKey);
        // Closing a menu before the browser finishes its native Tab traversal can otherwise leave
        // focus on body. Move explicitly to the logical control beside the menu trigger. A compact
        // modal supplies the boundary; desktop traversal uses the surrounding document order.
        event.preventDefault();
        requestClose("programmatic", false);
        if (destination) window.requestAnimationFrame(() => destination.isConnected && destination.focus());
        return;
      }
      if (event.key !== "Tab") return;
      if (mode === "modal") { keepTabInside(layer, items, event); return; }
      if (mode !== "nonmodal") return;
      // A non-modal child remains free on desktop. Inside a compact modal it borrows the
      // parent's outer boundary, so repeated Tab/Shift+Tab cannot escape the modal while
      // the child is the top focus layer.
      const containingModal = layer?.closest<HTMLElement>('[data-focus-layer="modal"]') ??
        restoreToRef.current?.current?.closest<HTMLElement>('[data-focus-layer="modal"]');
      if (containingModal) keepTabInside(containingModal, focusableWithin(containingModal), event);
    };
    const pointerdown = (event: PointerEvent) => {
      if (!closeOnOutside || !isTopLayer()) return;
      const target = event.target;
      if (!(target instanceof Node) || layer?.contains(target) || restoreToRef.current?.current?.contains(target)) return;
      // Do not restore here: the clicked control must retain the browser's normal focus behavior.
      requestClose("outside", false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown);
      layer?.removeAttribute("data-focus-layer");
      const decision = closeDecisionRef.current ?? { reason: "programmatic" as const };
      const shouldRestore = decision.restore ?? (mode === "modal" || mode === "nonmodal" &&
        !restoreToRef.current?.current?.isConnected && Boolean(restoreFallbackRef.current));
      if (!shouldRestore) return;
      const explicit = restoreToRef.current?.current;
      if (usableFocusTarget(explicit)) { explicit.focus(); return; }
      if (usableFocusTarget(opener)) { opener.focus(); return; }
      const fallback = restoreFallbackRef.current?.();
      if (usableFocusTarget(fallback)) { fallback.focus(); return; }
      const stable = fallbackContainer?.isConnected
        ? fallbackContainer.querySelector<HTMLElement>(FOCUSABLE) ?? fallbackContainer
        : document.querySelector<HTMLElement>(
          '[role="dialog"] button:not([disabled]), .sidebar-toggle:not([disabled]), .main-area [tabindex="0"]'
        );
      if (usableFocusTarget(stable)) stable.focus();
    };
  }, [active, closeOnOutside, mode, requestClose]);

  return { ref, requestClose };
}

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onClose: () => void,
  canClose = true,
  restoreFallback?: () => HTMLElement | null
) {
  return useFocusLayer<T>({
    active, mode: "modal", onClose, canClose, restoreFallback
  }).ref;
}
