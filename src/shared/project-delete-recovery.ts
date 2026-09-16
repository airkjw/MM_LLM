export type ProjectDeletionOps = {
  listLinkedThreadIds(): Promise<string[]>;
  unlinkThread(id: string): Promise<void>;
  deleteVault(): Promise<void>;
  clearJournal(): Promise<void>;
};

/** Completes the journaled delete in an order that is safe to repeat after any interruption. */
export async function completeJournaledProjectDeletion(ops: ProjectDeletionOps): Promise<void> {
  for (const id of await ops.listLinkedThreadIds()) await ops.unlinkThread(id);
  await ops.deleteVault();
  await ops.clearJournal();
}
