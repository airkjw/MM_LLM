import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isThemePreference, readThemePreference, writeThemePreference } from "../src/main/theme-state.ts";
import { applyWindowTheme, backgroundColorForTheme, resolveThemePreference } from "../src/main/theme-application.ts";
import { ThemePersistence } from "../src/renderer/src/theme-persistence.ts";

test("appearance state accepts the three theme preferences", () => {
  for (const value of ["system", "light", "dark"]) assert.equal(isThemePreference(value), true);
  for (const value of ["", null, { preference: "dark" }]) assert.equal(isThemePreference(value), false);
});

test("appearance state is bounded, atomic, owner-only, and rejects malformed records", () => {
  const root = mkdtempSync(join(tmpdir(), "mmllm-theme-"));
  try {
    assert.equal(readThemePreference(root), null);
    writeThemePreference(root, "system");
    assert.equal(readThemePreference(root), "system");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "appearance.json"), "utf8")), { preference: "system" });
    if (process.platform !== "win32") {
      const mode = statSync(join(root, "appearance.json")).mode & 0o777;
      assert.equal(mode, 0o600);
    }
    writeThemePreference(root, "light");
    assert.equal(readThemePreference(root), "light");
    writeFileSync(join(root, "appearance.json"), JSON.stringify({ preference: "dark", extra: true }));
    assert.equal(readThemePreference(root), null);
    writeFileSync(join(root, "appearance.json"), JSON.stringify({ theme: "dark" }));
    assert.equal(readThemePreference(root), null, "v0.3.0의 해석된 테마 값은 선호값으로 오인하지 않습니다.");
    writeFileSync(join(root, "appearance.json"), "{".repeat(129));
    assert.equal(statSync(join(root, "appearance.json")).size, 129);
    assert.equal(readThemePreference(root), null, "oversized files are rejected before their contents are read");
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test("appearance state removes its temporary file when atomic rename fails", () => {
  const root = mkdtempSync(join(tmpdir(), "mmllm-theme-rename-"));
  try {
    writeThemePreference(root, "dark");
    let cleanedPath = "";
    assert.throws(() => writeThemePreference(root, "light", {
      rename() { throw new Error("simulated rename failure"); },
      unlink(path) { cleanedPath = path; unlinkSync(path); }
    }), /simulated rename failure/);
    assert.match(cleanedPath, /appearance\.json\..+\.tmp$/);
    assert.equal(readThemePreference(root), "dark", "the previous complete record survives");
    assert.deepEqual(readdirSync(root), ["appearance.json"], "no temporary file remains");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("theme preferences resolve against the current OS theme", () => {
  assert.equal(resolveThemePreference("system", true), "dark");
  assert.equal(resolveThemePreference("system", false), "light");
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference("light", true), "light");
});

test("window background colors follow the Console theme surfaces", () => {
  assert.equal(backgroundColorForTheme("dark"), "#0D0E10");
  assert.equal(backgroundColorForTheme("light"), "#F6F7F8");
});

test("live window theme applies the native theme source before the background", () => {
  const calls = [];
  assert.equal(applyWindowTheme("dark", false, null, {
    setThemeSource: (preference) => calls.push(["source", preference]),
    setBackgroundColor: (color) => calls.push(["background", color]),
    persist: (preference) => calls.push(["persist", preference])
  }), "dark");
  assert.deepEqual(calls, [["source", "dark"], ["background", "#0D0E10"], ["persist", "dark"]]);
});

test("live window theme resolves the system preference after the native source changes", () => {
  // Electron reports shouldUseDarkColors for the current themeSource, so a stale "dark" source
  // must not leak into the background chosen for a new "system" preference on a light OS.
  let source = "dark";
  const backgrounds = [];
  applyWindowTheme("system", () => source === "dark", "dark", {
    setThemeSource: (preference) => { source = preference; },
    setBackgroundColor: (color) => backgrounds.push(color),
    persist() {}
  });
  assert.deepEqual(backgrounds, ["#F6F7F8"]);
});

test("live window theme changes even when preference persistence fails, and the same preference can retry", () => {
  const backgrounds = [];
  const sources = [];
  let writes = 0;
  const failing = {
    setThemeSource: (preference) => sources.push(preference),
    setBackgroundColor: (color) => backgrounds.push(color),
    persist() { writes++; throw new Error("disk unavailable"); }
  };
  assert.throws(() => applyWindowTheme("system", true, null, failing), /disk unavailable/);
  assert.deepEqual(sources, ["system"]);
  assert.deepEqual(backgrounds, ["#0D0E10"]);
  assert.equal(writes, 1);

  let persisted = null;
  const recovered = applyWindowTheme("system", true, persisted, {
    setThemeSource: (preference) => sources.push(preference),
    setBackgroundColor: (color) => backgrounds.push(color),
    persist(theme) { writes++; persisted = theme; }
  });
  assert.equal(recovered, "system");
  assert.equal(persisted, "system");
  assert.equal(writes, 2);
  assert.deepEqual(sources, ["system", "system"]);
  assert.deepEqual(backgrounds, ["#0D0E10", "#0D0E10"]);
});

test("live window background still updates for an already persisted preference without rewriting it", () => {
  const backgrounds = [];
  const sources = [];
  let writes = 0;
  assert.equal(applyWindowTheme("system", false, "system", {
    setThemeSource: (preference) => sources.push(preference),
    setBackgroundColor: (color) => backgrounds.push(color),
    persist() { writes++; }
  }), "system");
  assert.deepEqual(sources, ["system"]);
  assert.deepEqual(backgrounds, ["#F6F7F8"]);
  assert.equal(writes, 0);
});

test("renderer theme persistence deduplicates success and retries the same theme after rejection", async () => {
  const attempts = [];
  let fail = true;
  const persistence = new ThemePersistence(async (theme) => {
    attempts.push(theme);
    if (fail) { fail = false; throw new Error("first write failed"); }
  });
  await assert.rejects(persistence.sync("dark"), /first write failed/);
  await persistence.sync("dark");
  await persistence.sync("dark");
  assert.deepEqual(attempts, ["dark", "dark"], "success is change-only but rejection does not suppress retry");
  await persistence.sync("light");
  assert.deepEqual(attempts, ["dark", "dark", "light"]);
});

test("renderer theme persistence serializes writes and lets the latest request win", async () => {
  const attempts = [];
  const releases = [];
  const persistence = new ThemePersistence((theme) => {
    attempts.push(theme);
    return new Promise((resolve) => releases.push(resolve));
  });

  const first = persistence.sync("dark");
  await Promise.resolve();
  assert.deepEqual(attempts, ["dark"]);

  const superseded = persistence.sync("light");
  const latest = persistence.sync("dark");
  assert.deepEqual(attempts, ["dark"], "writes remain serialized while the first request is delayed");

  releases.shift()();
  await Promise.all([first, superseded, latest]);
  assert.deepEqual(attempts, ["dark"], "the delayed light request cannot overwrite the latest dark request");

  await persistence.sync("dark");
  assert.deepEqual(attempts, ["dark"], "the settled theme is change-only");
});

test("renderer theme persistence writes a different latest request after an in-flight write", async () => {
  const attempts = [];
  const releases = [];
  const persistence = new ThemePersistence((theme) => {
    attempts.push(theme);
    return new Promise((resolve) => releases.push(resolve));
  });

  const dark = persistence.sync("dark");
  await Promise.resolve();
  const light = persistence.sync("light");
  releases.shift()();
  await dark;
  await Promise.resolve();
  assert.deepEqual(attempts, ["dark", "light"]);
  releases.shift()();
  await light;
});
