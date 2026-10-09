// Stage 4 (contract D4.2): the three display settings added to `settings:update`. Main-side boundary and storage
// tests; every value here is synthetic and no API key, conversation or document leaves the temporary directory.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertAllowedKeys, IPC_ALLOWED_KEYS, validatedSettingsUpdate } from "../src/shared/request-validation.ts";
import { DEFAULT_INSTRUCTION, normalizeAppSettings } from "../src/main/storage-logic.ts";

const base = { defaultInstruction: "합성 지침", theme: "system", fontSize: "medium" };

test("settings:update allows exactly the existing keys plus density, reduceMotion and shortcutHints", () => {
  assert.deepEqual([...IPC_ALLOWED_KEYS.settingsUpdate].sort(), [
    "defaultInstruction", "density", "favoriteModels", "fontSize", "recentModels", "reduceMotion", "shortcutHints", "theme"
  ].sort());
  assert.throws(() => assertAllowedKeys({ ...base, motion: true }, IPC_ALLOWED_KEYS.settingsUpdate, "앱"),
    /^Error: 지원하지 않는 앱 설정입니다\.$/);
});

test("validatedSettingsUpdate keeps explicit fields only and type-checks the new display settings", () => {
  assert.deepEqual(validatedSettingsUpdate({ ...base, density: "compact", reduceMotion: true, shortcutHints: false }),
    { ...base, density: "compact", reduceMotion: true, shortcutHints: false });
  // Absent optional fields stay absent (no undefined keys are written).
  const legacy = validatedSettingsUpdate({ ...base });
  assert.deepEqual(legacy, base);
  assert.deepEqual(Object.keys(legacy).sort(), ["defaultInstruction", "fontSize", "theme"]);
  // Model preferences have their own mutation path; they are accepted on input but never written from here.
  assert.deepEqual(validatedSettingsUpdate({ ...base, favoriteModels: ["x"], recentModels: ["y"] }), base);
  assert.equal(validatedSettingsUpdate({ ...base, defaultInstruction: `  ${"가".repeat(13_000)}  ` }).defaultInstruction.length, 12_000);
  assert.equal(validatedSettingsUpdate({ theme: "dark", fontSize: "large" }).defaultInstruction, "");
});

test("validatedSettingsUpdate treats an explicit undefined optional field as absent but still rejects wrong types", () => {
  const cleared = validatedSettingsUpdate({ ...base, density: undefined, reduceMotion: undefined, shortcutHints: undefined });
  assert.deepEqual(cleared, base);
  assert.deepEqual(Object.keys(cleared).sort(), ["defaultInstruction", "fontSize", "theme"], "no undefined key is returned");
  assert.deepEqual(validatedSettingsUpdate({ ...base, density: undefined, reduceMotion: false }), { ...base, reduceMotion: false });
  for (const patch of [{ density: null }, { reduceMotion: null }, { shortcutHints: null }, { density: 0 }, { reduceMotion: "false" }]) {
    assert.throws(() => validatedSettingsUpdate({ ...base, density: undefined, ...patch }), /^Error: 화면 설정이 올바르지 않습니다\.$/);
  }
  assert.throws(() => validatedSettingsUpdate({ ...base, density: undefined, injected: undefined }), /^Error: 지원하지 않는 앱 설정입니다\.$/,
    "an unknown key is rejected even when its value is undefined");
});

test("validatedSettingsUpdate rejects unknown keys, non-objects and wrong types with the existing wording", () => {
  for (const raw of [null, "settings", [], 3]) assert.throws(() => validatedSettingsUpdate(raw), /^Error: 설정이 올바르지 않습니다\.$/);
  assert.throws(() => validatedSettingsUpdate({ ...base, injected: true }), /^Error: 지원하지 않는 앱 설정입니다\.$/);
  assert.throws(() => validatedSettingsUpdate({ ...base, __proto__: { polluted: true }, constructor: "x" }), /지원하지 않는 앱 설정/);
  const invalid = [
    { density: "wide" }, { density: "" }, { density: 1 }, { density: null },
    { reduceMotion: "true" }, { reduceMotion: 1 }, { reduceMotion: null },
    { shortcutHints: "false" }, { shortcutHints: 0 }, { shortcutHints: {} },
    { theme: "sepia" }, { fontSize: "huge" }
  ];
  for (const patch of invalid) {
    assert.throws(() => validatedSettingsUpdate({ ...base, ...patch }), /^Error: 화면 설정이 올바르지 않습니다\.$/,
      `rejects ${JSON.stringify(patch)}`);
  }
});

test("the main settings:update handler validates through validatedSettingsUpdate before saveSettings", () => {
  const source = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const start = source.indexOf('ipcMain.handle("settings:update"');
  assert.ok(start > 0);
  const handler = source.slice(start, source.indexOf("ipcMain.handle(", start + 10));
  assert.match(handler, /trustedInvoke\(event\); assertSessionStable\(\);/);
  assert.match(handler, /return saveSettings\(validatedSettingsUpdate\(raw\)\);/);
});

test("normalizeAppSettings keeps valid display settings, drops invalid ones and leaves legacy settings unchanged", () => {
  assert.deepEqual(normalizeAppSettings(undefined), { defaultInstruction: DEFAULT_INSTRUCTION, theme: "system", fontSize: "medium" });
  const legacy = { defaultInstruction: "합성", theme: "dark", fontSize: "large", favoriteModels: ["a"] };
  assert.deepEqual(normalizeAppSettings(legacy), legacy);
  assert.deepEqual(normalizeAppSettings({ ...legacy, density: "compact", reduceMotion: false, shortcutHints: true }),
    { ...legacy, density: "compact", reduceMotion: false, shortcutHints: true });
  assert.deepEqual(normalizeAppSettings({ ...legacy, density: "wide", reduceMotion: "yes", shortcutHints: 1 }), legacy);
  assert.equal("density" in normalizeAppSettings({ ...legacy, density: undefined }), false);
});

let root; let machine = "settings-first-machine";
globalThis.__mmllmStorageElectron = {
  app: { getPath: () => root },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`${machine}\0${value}`),
    decryptStringAsync: async (bytes) => {
      const value = bytes.toString();
      if (!value.startsWith(`${machine}\0`)) throw new Error("wrong machine keychain");
      return { result: value.slice(machine.length + 1), shouldReEncrypt: false };
    }
  }
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "mmllm-test:electron", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const url = new URL(specifier, context.parentURL);
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) {
        return next(url.href + ".ts", context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mmllm-test:electron") return { format: "module", source: "export const { app, safeStorage } = globalThis.__mmllmStorageElectron;", shortCircuit: true };
    return next(url, context);
  }
});

test("display settings survive save -> load -> backup -> restore, and legacy settings and backups restore unchanged", async () => {
  const first = await mkdtemp(join(tmpdir(), "mmllm-settings-source-"));
  const second = await mkdtemp(join(tmpdir(), "mmllm-settings-destination-"));
  const third = await mkdtemp(join(tmpdir(), "mmllm-settings-legacy-"));
  root = first;
  try {
    const storage = await import("../src/main/storage.ts");
    await storage.activateProfileForKey("SYNTHETIC-SETTINGS-KEY-A"); await storage.saveKey("SYNTHETIC-SETTINGS-KEY-A");
    // A settings file written before Stage 4 (no display fields) loads unchanged.
    await storage.saveSettings({ defaultInstruction: "합성 이전 설정", theme: "light", fontSize: "small" });
    assert.deepEqual(await storage.loadSettings(), { defaultInstruction: "합성 이전 설정", theme: "light", fontSize: "small" });
    const legacyBackup = await storage.exportPortableBackup();
    assert.deepEqual(legacyBackup.settings, { defaultInstruction: "합성 이전 설정", theme: "light", fontSize: "small" });

    const saved = await storage.saveSettings(validatedSettingsUpdate({
      defaultInstruction: "합성 연구 설정", theme: "dark", fontSize: "large", density: "compact", reduceMotion: true, shortcutHints: false
    }));
    const expected = { defaultInstruction: "합성 연구 설정", theme: "dark", fontSize: "large", density: "compact", reduceMotion: true, shortcutHints: false };
    assert.deepEqual(saved, expected);
    assert.deepEqual(await storage.loadSettings(), expected);
    // A later save that omits a field removes it (explicit fields only), so the toggle can return to the OS default.
    await storage.saveSettings({ ...expected, reduceMotion: undefined });
    assert.equal("reduceMotion" in await storage.loadSettings(), false);
    await storage.saveSettings(expected);

    const portable = await storage.exportPortableBackup();
    assert.deepEqual(portable.settings, expected);
    assert.equal(JSON.stringify(portable).includes("SYNTHETIC-SETTINGS-KEY-A"), false);

    root = second; machine = "settings-second-machine"; storage.clearActiveProfile();
    await storage.activateProfileForKey("SYNTHETIC-SETTINGS-KEY-B"); await storage.saveKey("SYNTHETIC-SETTINGS-KEY-B");
    await storage.restorePortableBackup(JSON.parse(JSON.stringify(portable)));
    assert.deepEqual(await storage.loadSettings(), expected);

    root = third; machine = "settings-third-machine"; storage.clearActiveProfile();
    await storage.activateProfileForKey("SYNTHETIC-SETTINGS-KEY-C"); await storage.saveKey("SYNTHETIC-SETTINGS-KEY-C");
    await storage.restorePortableBackup(JSON.parse(JSON.stringify(legacyBackup)));
    assert.deepEqual(await storage.loadSettings(), { defaultInstruction: "합성 이전 설정", theme: "light", fontSize: "small" });

    // A tampered backup cannot smuggle invalid display values into storage.
    await storage.restorePortableBackup({ ...JSON.parse(JSON.stringify(portable)),
      settings: { ...expected, density: "wide", reduceMotion: "yes", shortcutHints: 0 } });
    assert.deepEqual(await storage.loadSettings(), { defaultInstruction: "합성 연구 설정", theme: "dark", fontSize: "large" });
  } finally {
    hooks.deregister(); delete globalThis.__mmllmStorageElectron;
    await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true });
    await rm(third, { recursive: true, force: true });
  }
});
