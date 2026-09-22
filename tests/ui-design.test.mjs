import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { auditCss, auditUiCssFile, contrastRatio } from "../scripts/audit-ui-css.mjs";
import { auditThemeStartup } from "../scripts/audit-theme-startup.mjs";

const CSS_PATH = new URL("../src/renderer/src/styles.css", import.meta.url);
const APP_PATH = new URL("../src/renderer/src/App.tsx", import.meta.url);
const INDEX_PATH = new URL("../src/renderer/index.html", import.meta.url);
const BOOTSTRAP_PATH = new URL("../src/renderer/public/theme-bootstrap.js", import.meta.url);
const PRELOAD_PATH = new URL("../src/preload/index.ts", import.meta.url);
const MAIN_PATH = new URL("../src/main/index.ts", import.meta.url);

function readSource(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

const css = readSource(CSS_PATH);
const app = [readSource(APP_PATH), ...["ChatPanel", "MediaPanel", "Login", "ModelPicker", "ui-shared", "AppDialogs"].map((name) =>
  readSource(new URL(`../src/renderer/src/${name}.tsx`, import.meta.url)))].join("\n");

function expectMutationError(name, mutate, pattern) {
  test(`UI audit rejects ${name}`, () => {
    const changed = mutate(css);
    assert.notEqual(changed, css, `mutation fixture for ${name} must change CSS`);
    const result = auditCss(changed);
    assert.ok(result.errors.some((error) => pattern.test(error)), result.errors.join("\n"));
  });
}

function startupSources() {
  return {
    index: readSource(INDEX_PATH),
    bootstrap: readSource(BOOTSTRAP_PATH),
    preload: readSource(PRELOAD_PATH),
    main: readSource(MAIN_PATH)
  };
}

function expectStartupMutation(name, mutate, pattern) {
  test(`startup theme audit rejects ${name}`, () => {
    const original = startupSources();
    const changed = mutate(original);
    assert.notDeepEqual(changed, original, `mutation fixture for ${name} must change a source`);
    const errors = auditThemeStartup(changed);
    assert.ok(errors.some((error) => pattern.test(error)), errors.join("\n"));
  });
}

test("Neutral blue workspace CSS keeps semantic tokens, contrast, controls, and state guards", () => {
  const result = auditUiCssFile();
  assert.deepEqual(result.errors, []);
  assert.ok(result.metrics.themeTokenCount.light >= 33);
  assert.equal(result.metrics.themeTokenCount.light, result.metrics.themeTokenCount.dark);
  assert.equal(result.metrics.hardcodedColorsOutsideTokens, 0);
  assert.equal(result.metrics.selectorDarkOverrides, 0);
  assert.equal(result.metrics.gradients, 1);
  assert.ok(result.metrics.contrastPairs >= 40);
  assert.ok(result.metrics.controlBoundaryMappings >= 16);
  assert.ok(result.metrics.disabledMappings >= 5);
});

test("contrast calculation follows WCAG relative luminance", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.ok(contrastRatio("#245DCE", "#FFFFFF") >= 4.5);
});

test("chat and media surfaces use the compact header without decorative eyebrows or login orbs", () => {
  assert.doesNotMatch(app, /MEDICAL MBA WORKSPACE|CREATE WITH CHATKHU/);
  assert.doesNotMatch(app, /className="login-orb/);
  assert.equal((app.match(/className="eyebrow"/g) ?? []).length, 2, "branding remains only on login and welcome");
});

test("startup theme uses the isolated preload bridge and a CSP-safe head bootstrap", () => {
  assert.deepEqual(auditThemeStartup(startupSources()), []);
});

expectMutationError("raw hex colors", (source) => `${source}\n.raw-color { color: #fff; }`, /Raw colors/);
expectMutationError("escaped raw color values", (source) => `${source}\n.raw-color { color: \\72 ed; }`, /Named colors/);
expectMutationError("named colors", (source) => `${source}\n.named-color { color: red; }`, /Named colors/);
expectMutationError("complete named colors", (source) => `${source}\n.named-color { color: rebeccapurple; }`, /Named colors/);
expectMutationError("system colors", (source) => `${source}\n.system-color { color: CanvasText; }`, /Named colors/);
expectMutationError("modern raw colors", (source) => `${source}\n.modern-color { color: oklch(60% .2 20); }`, /Modern raw colors/);
expectMutationError("alternate dark selectors", (source) => `${source}\nhtml[data-theme='dark'] .x { color: var(--color-text); }`, /dark overrides/);
expectMutationError("dark theme classes", (source) => `${source}\n.theme-dark .x { color: var(--color-text); }`, /dark overrides/);
expectMutationError("dark media queries", (source) => `${source}\n@media (prefers-color-scheme: dark) { .x { color: var(--color-text); } }`, /dark overrides/);
expectMutationError("unsafe font-size paths", (source) => `${source}\n.tiny { font-size: .7rem; }`, /below 12px/);
expectMutationError("context-dependent font-size paths", (source) => `${source}\n.tiny { font-size: .95em; }`, /Unverified font-size/);
expectMutationError("unverifiable font-size paths", (source) => `${source}\n.tiny { font-size: calc(1rem - 8px); }`, /Unverified font-size/);
expectMutationError("font shorthand sizes", (source) => `${source}\n.tiny { font: 11px sans-serif; }`, /Font shorthand/);
expectMutationError("local typography token redefinition", (source) => `${source}\n.tiny { --text-xs: 1px; }`, /Typography token redefined/);
expectMutationError("escaped typography token redefinition", (source) => `${source}\n.tiny { --\\74 ext-xs: 1px; }`, /Typography token redefined/);
expectMutationError("local color token redefinition", (source) => `${source}\n.tiny { --color-bg: var(--color-bg); }`, /Color token redefined/);
expectMutationError("escaped local color token redefinition", (source) =>
  `${source}\n.tiny { --\\63 olor-bg: var(--color-bg); }`, /Color token redefined/);
expectMutationError("additional light theme roots", (source) => `${source}\n:root { color-scheme: light; }`, /exactly one :root/);
expectMutationError("additional equivalent dark theme roots", (source) =>
  `${source}\n:root[data-theme='dark'] { color-scheme: dark; }`, /exactly one dark theme root/);
expectMutationError("missing theme roots without crashing", (source) => source.replace(
  /:root\s*\{[^}]*\}/, ""
), /exactly one :root/);
expectMutationError("asymmetric theme tokens", (source) => source.replace(
  "  --color-speaker-6: #F2A89A;\n", ""
), /same color tokens/);
expectMutationError("missing disabled mappings", (source) => source.replaceAll("button:disabled", "button[data-disabled]"), /disabled mapping: button:disabled/);
expectMutationError("later conflicting disabled mappings", (source) => `${source}\nbutton:disabled { background: var(--color-bg); }`, /disabled mapping: button:disabled/);
expectMutationError("legacy aliases", (source) => `${source}\n:root { --surface: var(--color-bg); }`, /Legacy alias/);
expectMutationError("incorrect control boundaries", (source) => source.replace(
  /(.media-textarea[^{}]*\{[^{}]*border:\s*1px solid )var\(--color-border-control\)/,
  "$1var(--color-border-strong)"
), /Control boundary.*media-textarea/);
expectMutationError("later conflicting control boundaries", (source) => `${source}\n.media-textarea { border-color: var(--color-border); }`, /Control boundary.*media-textarea/);
expectMutationError("higher-specificity control boundary conflicts", (source) =>
  `${source}\n.app-shell .model-trigger { border-color: var(--color-border); }`, /audited-selector conflict.*model-trigger/);
expectMutationError(":is control boundary conflicts", (source) =>
  `${source}\n:is(.model-trigger) { border-color: var(--color-border); }`, /audited-selector conflict.*model-trigger/);
expectMutationError("typed control boundary conflicts", (source) =>
  `${source}\nbutton.model-trigger { border-color: var(--color-border); }`, /audited-selector conflict.*model-trigger/);
expectMutationError("stateful control boundary conflicts", (source) =>
  `${source}\n.model-trigger:hover { border-color: var(--color-border); }`, /audited-selector conflict.*model-trigger/);
expectMutationError("non-text accent contrast failures", (source) => source.replace(
  /(--color-accent-graphic:\s*)#A4C5FF/,
  "$1#1C2F4B"
), /accent-graphic\/accent-subtle/);
expectMutationError("the stop-button semantic map", (source) => source.replace(
  ".send-button.stop, .send-button.stop:hover:not(:disabled) { background: var(--color-text); color: var(--color-bg); }",
  ".send-button.stop, .send-button.stop:hover:not(:disabled) { background: var(--color-border); color: var(--color-text); }"
), /send-button\.stop/);
expectMutationError("the active navigation contrast map", (source) => source.replace(
  ".creation-tile.active { border-color: var(--color-accent); color: var(--color-accent-text); background: var(--color-accent-subtle); font-weight: 600; }",
  ".creation-tile.active { border-color: var(--color-accent); color: var(--color-text-tertiary); background: var(--color-accent-subtle); font-weight: 600; }"
), /creation-tile\.active must use/);
expectMutationError("higher-specificity active navigation conflicts", (source) =>
  `${source}\n.app-shell .creation-tile.active { color: var(--color-text-tertiary); }`, /audited-selector conflict/);
expectMutationError("escaped higher-specificity active navigation conflicts", (source) =>
  `${source}\n.app-shell .creation-tile.active { color: v\\61 r(--color-text-tertiary); }`, /audited-selector conflict/);
expectMutationError(":is active navigation conflicts", (source) =>
  `${source}\n:is(.creation-tile.active) { color: var(--color-text-tertiary); }`, /audited-selector conflict.*creation-tile\.active/);
expectMutationError("typed active navigation conflicts", (source) =>
  `${source}\nbutton.creation-tile.active { color: var(--color-text-tertiary); }`, /audited-selector conflict.*creation-tile\.active/);
expectMutationError("stateful active navigation conflicts", (source) =>
  `${source}\n.creation-tile.active:hover { color: var(--color-text-tertiary); }`, /audited-selector conflict.*creation-tile\.active/);
expectMutationError("speaker token contrast failures", (source) => source.replace(
  /(--color-speaker-3:\s*)#14745B/, "$1#EEF0F3"
), /speaker-3\/bg/);
expectMutationError("duplicate speaker categorical tokens", (source) => source.replace(
  /(--color-speaker-6:\s*)#8A3B2E/, "$1#245DCE"
), /six speaker colors must be distinct/);
expectMutationError("speaker categorical mapping changes", (source) => source.replace(
  ".speaker-5 { --speaker-color: var(--color-speaker-6); }",
  ".speaker-5 { --speaker-color: var(--color-speaker-1); }"
), /speaker-5 must map/);
expectMutationError(":is speaker categorical mapping changes", (source) =>
  `${source}\n:is(.speaker-5) { --speaker-color: var(--color-speaker-1); }`, /audited-selector conflict.*speaker-5/);
expectMutationError("speaker names using categorical color", (source) => source.replace(
  "color: var(--color-text-secondary);\n  font-size: var(--text-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }",
  "color: var(--speaker-color);\n  font-size: var(--text-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }"
), /speaker names/);
expectMutationError(":is speaker names using categorical color", (source) =>
  `${source}\n:is(.segment-speaker) { color: var(--speaker-color); }`, /audited-selector conflict.*segment-speaker/);
expectMutationError(":is disabled state conflicts", (source) =>
  `${source}\n:is(button:disabled) { background: var(--color-bg); }`, /audited-selector conflict.*button:disabled/);
expectMutationError("stateful disabled state conflicts", (source) =>
  `${source}\nbutton:disabled:hover { background: var(--color-bg); }`, /audited-selector conflict.*button:disabled/);
expectMutationError("malformed CSS", (source) => `${source}\n.broken {`, /CSS parse failed/);

expectStartupMutation("comment-spoofed bootstrap tag", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<!-- <script vite-ignore src="./theme-bootstrap.js"></script> -->')
}), /theme bootstrap/);
expectStartupMutation("deferred theme bootstrap", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<script vite-ignore defer src="./theme-bootstrap.js"></script>')
}), /classic blocking/);
expectStartupMutation("async theme bootstrap", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<script vite-ignore async src="./theme-bootstrap.js"></script>')
}), /classic blocking/);
expectStartupMutation("module theme bootstrap", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<script vite-ignore type="module" src="./theme-bootstrap.js"></script>')
}), /classic blocking/);
expectStartupMutation("script before theme bootstrap", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<script src="./decoy.js"></script><script vite-ignore src="./theme-bootstrap.js"></script>')
}), /first script/);
expectStartupMutation("stylesheet before theme bootstrap", (sources) => ({
  ...sources,
  index: sources.index.replace('<script vite-ignore src="./theme-bootstrap.js"></script>',
    '<link rel="stylesheet" href="./early.css"><script vite-ignore src="./theme-bootstrap.js"></script>')
}), /precede stylesheets/);
expectStartupMutation("comment-spoofed dataset assignment", (sources) => ({
  ...sources,
  bootstrap: sources.bootstrap.replace(
    'if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;',
    '// document.documentElement.dataset.theme = theme;'
  )
}), /validate light\/dark/);
expectStartupMutation("uncalled-function dataset assignment", (sources) => ({
  ...sources,
  bootstrap: `function applyTheme() {\n${sources.bootstrap}\n}`
}), /direct synchronous top-level/);
expectStartupMutation("setTimeout dataset assignment", (sources) => ({
  ...sources,
  bootstrap: `setTimeout(() => {\n${sources.bootstrap}\n}, 0);`
}), /direct synchronous top-level/);
expectStartupMutation("Promise callback dataset assignment", (sources) => ({
  ...sources,
  bootstrap: `Promise.resolve().then(() => {\n${sources.bootstrap}\n});`
}), /direct synchronous top-level/);
expectStartupMutation("async IIFE dataset assignment", (sources) => ({
  ...sources,
  bootstrap: `(async () => {\n${sources.bootstrap}\n})();`
}), /direct synchronous top-level/);
expectStartupMutation("comment-spoofed preload bridge", (sources) => ({
  ...sources,
  preload: sources.preload.replace('contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme }));',
    '// contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme }));')
}), /expose the isolated/);
expectStartupMutation("unreachable preload bridge", (sources) => ({
  ...sources,
  preload: sources.preload.replace('contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme }));',
    'if (false) contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme }));')
}), /expose the isolated/);
expectStartupMutation("function-decoy preload bridge", (sources) => ({
  ...sources,
  preload: sources.preload.replace('contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme }));',
    'function exposeDecoy() { contextBridge.exposeInMainWorld("mmllmBootstrap", Object.freeze({ initialTheme })); }')
}), /expose the isolated/);
expectStartupMutation("missing BrowserWindow background", (sources) => ({
  ...sources,
  main: sources.main.replace('    backgroundColor: initialTheme === "dark" ? "#12161D" : "#FFFFFF",\n', "")
}), /initial background/);
expectStartupMutation("unreachable BrowserWindow construction", (sources) => ({
  ...sources,
  main: sources.main.replace("  mainWindow = new BrowserWindow({", "  if (false) mainWindow = new BrowserWindow({")
}), /reachable from the top-level/);
expectStartupMutation("unreachable createWindow call", (sources) => ({
  ...sources,
  main: sources.main.replace("  await createWindow();", "  if (false) await createWindow();")
}), /reachable from the top-level/);
