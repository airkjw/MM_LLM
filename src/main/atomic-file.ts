import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/** Same-directory replacement keeps the previous committed file intact on write/rename failure. */
export async function writeAtomic(path: string, bytes: Uint8Array, io = { open, rename, unlink }): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await io.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    await io.rename(temporary, path);
    // Directory syncing is unsupported on Windows and some mounted filesystems.
    let directory: Awaited<ReturnType<typeof open>> | undefined;
    try { directory = await io.open(dirname(path), "r"); await directory.sync(); }
    catch (error) {
      if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    } finally { await directory?.close(); }
  } finally {
    await handle?.close().catch(() => undefined);
    await io.unlink(temporary).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
