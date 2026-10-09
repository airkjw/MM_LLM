function activeModal(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
}

export function hasBlockingModal(root: ParentNode): boolean {
  return Boolean(activeModal(root));
}

export function appShortcutBlocked(root: ParentNode, key: string): boolean {
  const modal = activeModal(root);
  if (!modal) return false;
  return !(key.toLowerCase() === "b" && modal.matches(".sidebar[data-compact='true']"));
}

const EDITABLE = "input, textarea, select, [contenteditable='true']";

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(EDITABLE));
}

/** Cmd/Ctrl+K, Cmd/Ctrl+N and Cmd/Ctrl+Shift+C stay global inside text fields (contract D3.8); other keys do not. */
export function worksInsideEditable(key: string, shiftKey: boolean): boolean {
  const value = key.toLowerCase();
  return value === "k" || value === "n" && !shiftKey || value === "c" && shiftKey;
}

/**
 * Plain digit shortcuts (start cards 1–4, compare columns 1–3). They act only when nothing editable has focus and
 * no dialog, popover or menu is open, so typing "1" in the composer always inserts the character.
 */
export function digitShortcut(event: KeyboardEvent, root: ParentNode = document): number | null {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return null;
  if (hasBlockingModal(root) || root.querySelector("[data-focus-layer]")) return null;
  return Number(event.key);
}
