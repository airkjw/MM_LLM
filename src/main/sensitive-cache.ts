export type SensitiveBufferEntry = { bytes: Buffer; touchedAt: number };

export function wipeBuffer(bytes: Buffer): void {
  bytes.fill(0);
}

export function deleteSensitiveEntry<T extends SensitiveBufferEntry>(entries: Map<string, T>, id: string): boolean {
  const entry = entries.get(id);
  if (!entry) return false;
  wipeBuffer(entry.bytes);
  return entries.delete(id);
}

export function clearSensitiveEntries<T extends SensitiveBufferEntry>(entries: Map<string, T>): void {
  for (const entry of entries.values()) wipeBuffer(entry.bytes);
  entries.clear();
}

export function sweepSensitiveEntries<T extends SensitiveBufferEntry>(
  entries: Map<string, T>, ttlMs: number, now = Date.now()
): number {
  let removed = 0;
  for (const [id, entry] of entries) {
    if (now - entry.touchedAt <= ttlMs) continue;
    if (deleteSensitiveEntry(entries, id)) removed++;
  }
  return removed;
}
