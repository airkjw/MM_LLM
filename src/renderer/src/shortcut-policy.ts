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
