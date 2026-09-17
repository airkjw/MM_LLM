import {
  closeSync, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type ThemePreference = "system" | "light" | "dark";

const THEME_STATE_FILE = "appearance.json";
const MAX_THEME_STATE_BYTES = 128;

type ThemeStateIo = {
  rename(source: string, target: string): void;
  unlink(path: string): void;
};

const defaultThemeStateIo: ThemeStateIo = {
  rename: renameSync,
  unlink: unlinkSync
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function themeStatePath(userData: string): string {
  return join(userData, THEME_STATE_FILE);
}

/**
 * Reads only the non-sensitive color-scheme preference used to avoid a startup flash.
 * A missing, malformed, or extended record is ignored and the caller uses the OS theme.
 */
export function readThemePreference(userData: string): ThemePreference | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(themeStatePath(userData), "r");
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size > MAX_THEME_STATE_BYTES) return null;
    const buffer = Buffer.alloc(status.size);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== status.size) return null;
    const raw = buffer.toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !isThemePreference(record.preference)) return null;
    return record.preference;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* A read failure is already represented by null. */ }
    }
  }
}

/** Atomic write with owner-only permissions where the platform supports POSIX modes. */
export function writeThemePreference(
  userData: string, preference: ThemePreference, io: ThemeStateIo = defaultThemeStateIo
): void {
  if (!isThemePreference(preference)) throw new Error("화면 테마가 올바르지 않습니다.");
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const target = themeStatePath(userData);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ preference }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    io.rename(temporary, target);
  } catch (error) {
    try { io.unlink(temporary); } catch { /* Nothing was committed. */ }
    throw error;
  }
}
