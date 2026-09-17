import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAppliedTheme, readAppliedTheme, writeAppliedTheme } from "../src/main/theme-state.ts";
import { applyWindowTheme } from "../src/main/theme-application.ts";
import { ThemePersistence } from "../src/renderer/src/theme-persistence.ts";

test("appearance state accepts only the two applied themes", () => {
  assert.equal(isAppliedTheme("light"), true);
  assert.equal(isAppliedTheme("dark"), true);
  for (const value of ["system", "", null, { theme: "dark" }]) assert.equal(isAppliedTheme(value), false);
});

test("appearance state is bounded, atomic, owner-only, and rejects malformed records", () => {
  const root = mkdtempSync(join(tmpdir(), "mmllm-theme-"));
  try {
    assert.equal(readAppliedTheme(root), null);
    writeAppliedTheme(root, "dark");
    assert.equal(readAppliedTheme(root), "dark");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "appearance.json"), "utf8")), { theme: "dark" });
    if (process.platform !== "win32") {
      const mode = statSync(join(root, "appearance.json")).mode & 0o777;
      assert.equal(mode, 0o600);
    }
    writeAppliedTheme(root, "light");
    assert.equal(readAppliedTheme(root), "light");
    writeFileSync(join(root, "appearance.json"), JSON.stringify({ theme: "dark", extra: true }));
    assert.equal(readAppliedTheme(root), null);
    writeFileSync(join(root, "appearance.json"), JSON.stringify({ theme: "system" }));
    assert.equal(readAppliedTheme(root), null);
    writeFileSync(join(root, "appearance.json"), "{".repeat(129));
    assert.equal(statSync(join(root, "appearance.json")).size, 129);
    assert.equal(readAppliedTheme(root), null, "oversized files are rejected before their contents are read");
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test("appearance state removes its temporary file when atomic rename fails", () => {
  const root = mkdtempSync(join(tmpdir(), "mmllm-theme-rename-"));
  try {
    writeAppliedTheme(root, "dark");
    let cleanedPath = "";
    assert.throws(() => writeAppliedTheme(root, "light", {
      rename() { throw new Error("simulated rename failure"); },
      unlink(path) { cleanedPath = path; unlinkSync(path); }
    }), /simulated rename failure/);
    assert.match(cleanedPath, /appearance\.json\..+\.tmp$/);
    assert.equal(readAppliedTheme(root), "dark", "the previous complete record survives");
    assert.deepEqual(readdirSync(root), ["appearance.json"], "no temporary file remains");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live window theme changes even when appearance persistence fails, and the same theme can retry", () => {
  const backgrounds = [];
  let writes = 0;
  const failing = {
    setBackgroundColor: (color) => backgrounds.push(color),
    persist() { writes++; throw new Error("disk unavailable"); }
  };
  assert.throws(() => applyWindowTheme("dark", null, failing), /disk unavailable/);
  assert.deepEqual(backgrounds, ["#18171C"]);
  assert.equal(writes, 1);

  let persisted = null;
  const recovered = applyWindowTheme("dark", persisted, {
    setBackgroundColor: (color) => backgrounds.push(color),
    persist(theme) { writes++; persisted = theme; }
  });
  assert.equal(recovered, "dark");
  assert.equal(persisted, "dark");
  assert.equal(writes, 2);
  assert.deepEqual(backgrounds, ["#18171C", "#18171C"]);
});

test("live window background still updates for an already persisted theme without rewriting it", () => {
  const backgrounds = [];
  let writes = 0;
  assert.equal(applyWindowTheme("light", "light", {
    setBackgroundColor: (color) => backgrounds.push(color),
    persist() { writes++; }
  }), "light");
  assert.deepEqual(backgrounds, ["#FFFFFF"]);
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
