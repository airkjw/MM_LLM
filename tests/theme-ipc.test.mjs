import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { applyThemePreference, publishResolvedTheme } from "../src/main/theme-application.ts";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Mirrors Electron's nativeTheme: shouldUseDarkColors honors themeSource before the OS value. */
function fakeNativeTheme(systemIsDark) {
  return {
    themeSource: "system",
    systemIsDark,
    get shouldUseDarkColors() { return this.themeSource === "system" ? this.systemIsDark : this.themeSource === "dark"; }
  };
}

function fakeWindow() {
  const backgrounds = [];
  const sent = [];
  return { backgrounds, sent, setBackgroundColor: (color) => backgrounds.push(color), sendResolvedTheme: (theme) => sent.push(theme) };
}

function fakeApplication(native, options = {}) {
  const persisted = [];
  return {
    persisted,
    setThemeSource: (preference) => { native.themeSource = preference; },
    setBackgroundColor() {},
    persist(preference) { if (options.fail) throw new Error("disk unavailable"); persisted.push(preference); }
  };
}

test("a native theme update resolves from shouldUseDarkColors and pushes exactly once", () => {
  const native = fakeNativeTheme(true);
  const window = fakeWindow();
  assert.equal(publishResolvedTheme(native, window), "dark");
  assert.deepEqual(window.sent, ["dark"]);
  assert.deepEqual(window.backgrounds, ["#0D0E10"]);
  native.systemIsDark = false;
  assert.equal(publishResolvedTheme(native, window), "light");
  assert.deepEqual(window.sent, ["dark", "light"]);
  assert.deepEqual(window.backgrounds, ["#0D0E10", "#F6F7F8"]);
});

test("a native theme update without a live window is ignored safely", () => {
  assert.equal(publishResolvedTheme(fakeNativeTheme(false), null), "light");
});

test("setting a theme applies the native source and pushes the resolved theme once", () => {
  const native = fakeNativeTheme(false);
  const window = fakeWindow();
  const application = fakeApplication(native);
  assert.equal(applyThemePreference("dark", native, null, application, window), "dark");
  assert.equal(native.themeSource, "dark");
  assert.deepEqual(application.persisted, ["dark"]);
  assert.deepEqual(window.sent, ["dark"]);

  assert.equal(applyThemePreference("system", native, "dark", application, window), "system");
  assert.equal(native.themeSource, "system");
  assert.deepEqual(window.sent, ["dark", "light"], "a stale dark source does not leak into the system push");
});

test("setting a theme still pushes the live theme when persistence fails", () => {
  const native = fakeNativeTheme(false);
  const window = fakeWindow();
  assert.throws(() => applyThemePreference("dark", native, null, fakeApplication(native, { fail: true }), window), /disk unavailable/);
  assert.equal(native.themeSource, "dark");
  assert.deepEqual(window.sent, ["dark"]);
  assert.equal(window.backgrounds.at(-1), "#0D0E10");
});

test("explicit light and dark preferences keep the resolved theme when the OS theme changes", () => {
  for (const preference of ["light", "dark"]) {
    const native = fakeNativeTheme(preference === "light");
    const window = fakeWindow();
    applyThemePreference(preference, native, null, fakeApplication(native), window);
    native.systemIsDark = !native.systemIsDark;
    publishResolvedTheme(native, window);
    native.systemIsDark = !native.systemIsDark;
    publishResolvedTheme(native, window);
    assert.deepEqual(window.sent, [preference, preference, preference]);
  }
});

function loadPreload(argv = []) {
  const output = ts.transpileModule(readSource("../src/preload/index.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exposed = {};
  const listeners = new Map();
  const outbound = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
    ipcRenderer: {
      on(channel, listener) { listeners.set(channel, [...(listeners.get(channel) ?? []), listener]); },
      removeListener(channel, listener) { listeners.set(channel, (listeners.get(channel) ?? []).filter((item) => item !== listener)); },
      invoke: (channel, ...args) => { outbound.push(["invoke", channel, ...args]); return Promise.resolve(); },
      send: (channel, ...args) => { outbound.push(["send", channel, ...args]); },
      postMessage: (channel, ...args) => { outbound.push(["postMessage", channel, ...args]); }
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, process: { argv },
    require: (name) => { if (name !== "electron") throw new Error(`unexpected preload import ${name}`); return electron; }
  });
  const emit = (channel, ...args) => { for (const listener of listeners.get(channel) ?? []) listener({ sender: null }, ...args); };
  return { exposed, listeners, outbound, emit };
}

test("preload forwards only validated light/dark theme pushes and unsubscribes the exact listener", () => {
  const preload = loadPreload(["--mmllm-initial-theme=dark"]);
  assert.deepEqual({ ...preload.exposed.mmllmBootstrap }, { initialTheme: "dark" }, "bootstrap exposure is unchanged");
  const received = [];
  const unsubscribe = preload.exposed.mmllm.onThemeResolved((theme) => received.push(theme));
  assert.equal(typeof unsubscribe, "function");
  assert.equal(preload.listeners.get("appearance:resolved").length, 1);
  for (const value of ["dark", "light", "system", "DARK", "", null, undefined, 1, { theme: "dark" }, ["dark"]]) {
    preload.emit("appearance:resolved", value);
  }
  preload.emit("appearance:resolved", "light", "extra");
  assert.deepEqual(received, ["dark", "light", "light"]);
  assert.deepEqual(preload.outbound, [], "receiving a theme push sends nothing back to main");
  unsubscribe();
  assert.equal(preload.listeners.get("appearance:resolved").length, 0);
  preload.emit("appearance:resolved", "dark");
  assert.deepEqual(received, ["dark", "light", "light"]);
});

test("preload never sends on the main-to-renderer theme channel", () => {
  const preload = readSource("../src/preload/index.ts");
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|invoke|sendSync|postMessage)\(\s*["']appearance:resolved["']/);
  const main = readSource("../src/main/index.ts");
  assert.doesNotMatch(main, /ipcMain\.(?:on|once|handle|handleOnce)\(\s*["']appearance:resolved["']/);
  assert.match(main, /webContents\.send\("appearance:resolved", theme\)/);
});

function rendererSources(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return rendererSources(path);
    return /\.(?:ts|tsx)$/.test(name) ? [[path, readFileSync(path, "utf8")]] : [];
  });
}

test("renderer code never reads the OS color scheme; main's nativeTheme decides", () => {
  for (const name of ["App.tsx", "ChatPanel.tsx"]) {
    assert.doesNotMatch(readSource(`../src/renderer/src/${name}`), /prefers-color-scheme/, name);
  }
  for (const [path, source] of rendererSources(fileURLToPath(new URL("../src/renderer/src/", import.meta.url)))) {
    assert.doesNotMatch(source, /prefers-color-scheme/, path);
  }
});

function sourceFile(source) {
  return ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }

test("main sets nativeTheme.themeSource from the persisted preference before creating the window", () => {
  const file = sourceFile(readSource("../src/main/index.ts"));
  let readyBody = null;
  walk(file, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "then" &&
      node.expression.expression.getText(file) === "app.whenReady()" && node.arguments[0] &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0])) &&
      ts.isBlock(node.arguments[0].body)) readyBody = node.arguments[0].body;
  });
  assert.ok(readyBody, "app.whenReady().then(...) continuation exists");
  const statements = readyBody.statements.map((statement) => statement.getText(file));
  const readIndex = statements.indexOf('lastThemePreference = readThemePreference(app.getPath("userData"));');
  const sourceIndex = statements.indexOf('nativeTheme.themeSource = lastThemePreference ?? "system";');
  const windowIndex = statements.indexOf("await createWindow();");
  assert.ok(readIndex >= 0, "the persisted preference is read at the top level of the ready continuation");
  assert.ok(sourceIndex > readIndex, "themeSource is assigned from the persisted preference");
  assert.ok(windowIndex > sourceIndex, "themeSource is applied before createWindow");
});

test("main wires every nativeTheme update and set-theme request to one resolved push", () => {
  const main = readSource("../src/main/index.ts");
  assert.match(main, /const pushResolvedTheme = \(\) => \{ publishResolvedTheme\(nativeTheme, liveThemeWindow\(\)\); \};/,
    "the updated handler pushes regardless of the stored preference");
  assert.match(main, /nativeTheme\.on\("updated", pushResolvedTheme\);/);
  assert.match(main, /nativeTheme\.removeListener\("updated", pushResolvedTheme\);/);
  assert.match(main, /lastThemePreference = applyThemePreference\(rawTheme, nativeTheme, lastThemePreference, \{\n\s+setThemeSource: \(preference\) => \{ nativeTheme\.themeSource = preference; \},/);
  assert.match(main, /\}, liveThemeWindow\(\)\);/);
  assert.match(main, /if \(!isThemePreference\(rawTheme\)\) throw new Error\("화면 테마가 올바르지 않습니다\."\);/, "set-theme validation is unchanged");
  assert.match(main, /throw new Error\("화면 테마 상태를 저장하지 못했습니다\."\);/, "set-theme persistence error text is unchanged");
});

test("the packaged app protocol serves bundled woff2 fonts as font/woff2", () => {
  const main = readSource("../src/main/index.ts");
  const start = main.indexOf("async function registerAppProtocol()");
  const end = main.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, "registerAppProtocol exists");
  const protocolSource = main.slice(start, end);
  assert.match(protocolSource, /target\.endsWith\("\.woff2"\) \? "font\/woff2" :/);
  assert.ok(protocolSource.indexOf('"font/woff2"') < protocolSource.indexOf('"application/octet-stream"'),
    "woff2 is matched before the octet-stream fallback");
});
