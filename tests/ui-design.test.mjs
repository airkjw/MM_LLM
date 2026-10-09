import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
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
  /(--color-accent-graphic:\s*)#E5B04A/,
  "$1#2A2316"
), /accent-graphic\/accent-subtle/);
expectMutationError("the stop-button semantic map", (source) => source.replace(
  ".send-button.stop, .send-button.stop:hover:not(:disabled) { background: var(--color-text); color: var(--color-bg); }",
  ".send-button.stop, .send-button.stop:hover:not(:disabled) { background: var(--color-border); color: var(--color-text); }"
), /send-button\.stop/);
expectMutationError("the active navigation contrast map", (source) => source.replace(
  ".creation-tile.active { border-color: var(--color-accent-graphic); color: var(--color-accent-text); background: var(--color-accent-subtle); font-weight: 600; }",
  ".creation-tile.active { border-color: var(--color-accent-graphic); color: var(--color-text-tertiary); background: var(--color-accent-subtle); font-weight: 600; }"
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

// ---- Stage 1 (W1a): tokens, typography, fonts, transitions (contract §B1 D1.1-D1.6) ----
function rootTokens(source, selector) {
  const block = source.match(new RegExp(`^${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gim)].map((match) => [match[1], match[2].trim()]));
}
const lightTokens = rootTokens(css, ":root");
const darkTokens = rootTokens(css, ':root[data-theme="dark"]');

test("D1.1 contract overrides replace the tokens.css values that miss the audit thresholds", () => {
  assert.equal(lightTokens["--color-border-control"], "#858C96");
  assert.equal(lightTokens["--color-progress-fill"], "#A66F04");
  assert.equal(lightTokens["--color-success"], "#28764A");
  assert.equal(lightTokens["--color-text-tertiary"], "#5F6670");
  assert.equal(darkTokens["--color-text-tertiary"], "#898F98");
  for (const [token, light, dark] of [
    ["--color-bg", "#F6F7F8", "#0D0E10"], ["--color-bg-sidebar", "#FFFFFF", "#131518"],
    ["--color-accent", "#E5B04A", "#E5B04A"], ["--color-on-accent", "#1A1306", "#1A1306"],
    ["--color-accent-text", "#8A5A00", "#E5B04A"], ["--color-text-body", "#2E333A", "#C9CDD2"]
  ]) {
    assert.equal(lightTokens[token], light, `light ${token}`);
    assert.equal(darkTokens[token], dark, `dark ${token}`);
  }
});

test("D1.2 new tokens exist in both themes and the audit pairs cover them", () => {
  for (const token of ["--color-text-body", "--color-success", "--color-success-bg"]) {
    assert.ok(lightTokens[token] && darkTokens[token], `${token} must exist in both themes`);
  }
  for (const radius of ["xs", "sm", "md", "lg", "xl", "2xl"]) assert.ok(lightTokens[`--radius-${radius}`], `--radius-${radius}`);
  assert.match(lightTokens["--font-sans"], /^"Pretendard Variable"/);
  assert.match(lightTokens["--font-mono"], /^"JetBrains Mono"/);
  const result = auditUiCssFile();
  for (const pair of ["text-body/bg", "text-body/bg-sidebar", "text-tertiary/bg-subtle", "text-tertiary/bg-selected",
    "text-tertiary/bg-hover", "accent-text/bg-subtle", "success/success-bg", "success/bg-sidebar",
    "accent-graphic/bg", "accent-graphic/bg-sidebar", "accent-graphic/bg-subtle", "on-accent/accent", "on-accent/accent-hover"]) {
    for (const theme of ["light", "dark"]) assert.ok(result.contrasts[theme][pair] > 0, `${theme} ${pair} must be audited`);
  }
  for (const theme of ["light", "dark"]) {
    assert.equal(result.contrasts[theme]["accent/bg"], undefined, "amber surface is face-only and is not held to 3:1 against bg");
  }
  assert.ok(contrastRatio(lightTokens["--color-border-control"], lightTokens["--color-bg"]) >= 3);
  assert.ok(contrastRatio(lightTokens["--color-progress-fill"], lightTokens["--color-progress-track"]) >= 3);
});

test("D1.3 typography tokens move the README sizes onto rem so the font-size setting still scales them", () => {
  assert.deepEqual({
    xs: lightTokens["--text-xs"], sm: lightTokens["--text-sm"], base: lightTokens["--text-base"], md: lightTokens["--text-md"],
    lg: lightTokens["--text-lg"], xl: lightTokens["--text-xl"], xxl: lightTokens["--text-2xl"], display: lightTokens["--text-display"]
  }, {
    xs: "max(12px, 0.75rem)", sm: "max(12px, 0.8125rem)", base: "0.875rem", md: "0.9375rem",
    lg: "1.0625rem", xl: "1.375rem", xxl: "1.5rem", display: "clamp(1.9375rem, 3vw, 2.75rem)"
  });
  assert.doesNotMatch(css, /@media[^{]*prefers-color-scheme/);
});

test("D1.5 fonts are bundled locally with OFL licenses and public-root @font-face sources", () => {
  const dir = new URL("../src/renderer/public/fonts/", import.meta.url);
  for (const file of ["pretendard/PretendardVariable.woff2", "pretendard/OFL.txt", "jetbrains-mono/OFL.txt",
    "jetbrains-mono/JetBrainsMono-Regular.woff2", "jetbrains-mono/JetBrainsMono-Medium.woff2", "jetbrains-mono/JetBrainsMono-SemiBold.woff2"]) {
    assert.ok(existsSync(new URL(file, dir)) && statSync(new URL(file, dir)).size > 1000, `${file} must be bundled`);
  }
  for (const folder of ["pretendard", "jetbrains-mono"]) {
    assert.match(readFileSync(new URL(`${folder}/OFL.txt`, dir), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.equal(faces.length, 4, "Pretendard Variable plus JetBrains Mono 400/500/600");
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/);
    const url = face.match(/url\(["']?([^)"']+)["']?\)/)?.[1] ?? "";
    assert.match(url, /^\/fonts\/(?:pretendard|jetbrains-mono)\/[\w-]+\.woff2$/, "bundled public font path, rewritten relative by Vite");
    assert.ok(existsSync(new URL(url.replace("/fonts/", ""), dir)), `${url} must exist under public/fonts`);
  }
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//);
  assert.match(css, /^:root\s*\{[^}]*font-family:\s*var\(--font-sans\)/m);
});

test("D1.6 theme transition applies to the shell surfaces and is zeroed by both motion switches", () => {
  const rule = css.match(/^html, body, \.sidebar, \.rail, \.panel, \.composer-card, \.dialog-card \{([^}]*)\}/m);
  assert.ok(rule, "transition rule must list the contract selectors");
  assert.match(rule[1], /transition:\s*background-color \.25s ease, color \.25s ease, border-color \.25s ease/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition-duration:\s*0\.01ms !important/);
  assert.match(css, /:root\[data-reduce-motion="true"\] \*[^{]*\{[^}]*transition-duration:\s*0\.01ms !important/);
});

expectMutationError("text-body contrast failures", (source) => source.replace(
  /(--color-text-body:\s*)#2E333A/, "$1#C9CDD2"), /text-body\/bg/);
expectMutationError("missing text-body token", (source) => source.replaceAll(/\s*--color-text-body:[^;]+;/g, ""), /--color-text-body is missing/);
expectMutationError("missing success token", (source) => source.replaceAll(/\s*--color-success:[^;]+;/g, ""), /--color-success is missing/);
expectMutationError("missing success-bg token", (source) => source.replaceAll(/\s*--color-success-bg:[^;]+;/g, ""), /--color-success-bg is missing/);
expectMutationError("success badge contrast failures", (source) => source.replace(
  /(--color-success:\s*)#28764A/, "$1#7FBF9A"), /success\/success-bg/);
expectMutationError("tertiary text on hover surface failures", (source) => source.replace(
  /(--color-text-tertiary:\s*)#5F6670/, "$1#7A818B"), /text-tertiary\/bg-hover/);
expectMutationError("tertiary text on subtle surface failures in dark theme", (source) => source.replace(
  /(--color-text-tertiary:\s*)#898F98/, "$1#6A7078"), /text-tertiary\/bg-(?:subtle|selected)/);
expectMutationError("accent text on subtle surface failures", (source) => source.replace(
  /(--color-accent-text:\s*)#8A5A00/, "$1#C99A3A"), /accent-text\/bg-subtle/);
expectMutationError("accent graphic on base surface failures", (source) => source.replace(
  /(--color-accent-graphic:\s*)#B57F12/, "$1#E0C48A"), /accent-graphic\/bg(?:-sidebar)? is/);
expectMutationError("on-accent text on amber hover face failures", (source) => source.replace(
  /(--color-accent-hover:\s*)#D9A23A/, "$1#2A2316"), /on-accent\/accent-hover/);
expectMutationError("on-accent text on amber face failures", (source) => source.replace(
  /(--color-on-accent:\s*)#1A1306/, "$1#E5B04A"), /on-accent\/accent is/);
expectMutationError("text-md below the 12px floor", (source) => source.replace(
  /--text-md:\s*0\.9375rem;/, "--text-md: 0.7rem;"), /--text-md does not enforce/);
expectMutationError("text-md redefinition outside :root", (source) => `${source}\n.tiny { --text-md: 1px; }`, /Typography token redefined/);
expectMutationError("CSS @import of remote fonts", (source) => `@import url("https://fonts.example/x.css");\n${source}`, /@import is forbidden/);
expectMutationError("unresolved ./fonts/ @font-face sources", (source) => source.replace(
  "/fonts/pretendard/PretendardVariable.woff2", "./fonts/pretendard/PretendardVariable.woff2"), /@font-face source must be a bundled public/);
expectMutationError("remote @font-face sources", (source) => source.replace(
  "/fonts/pretendard/PretendardVariable.woff2", "https://fonts.example/Pretendard.woff2"), /@font-face source must be a bundled public/);
expectMutationError("@font-face without font-display swap", (source) => source.replace(
  /(@font-face \{[^}]*?)font-display:\s*swap;/, "$1font-display: block;"), /font-display: swap/);
expectMutationError("missing reduce-motion app setting selector", (source) => source.replaceAll(
  ':root[data-reduce-motion="true"]', ':root[data-reduce-motion-off="true"]'), /data-reduce-motion/);
expectMutationError("missing theme transition rule", (source) => source.replace(
  "transition: background-color .25s ease, color .25s ease, border-color .25s ease;", ""), /theme transition/);

expectMutationError("amber face used as a border on the active navigation tile", (source) => source.replace(
  ".creation-tile.active { border-color: var(--color-accent-graphic);", ".creation-tile.active { border-color: var(--color-accent);"), /Non-fill use of --color-accent.*creation-tile\.active/);
expectMutationError("amber face used as a composer focus indicator", (source) => source.replace(
  ".composer-card:focus-within { border-color: var(--color-accent-graphic);", ".composer-card:focus-within { border-color: var(--color-accent);"), /Non-fill use of --color-accent.*composer-card:focus-within/);
expectMutationError("amber face used as an input focus border", (source) => source.replace(
  ".login-card form input:focus { border-color: var(--color-accent-graphic);", ".login-card form input:focus { border-color: var(--color-accent);"), /Non-fill use of --color-accent.*login-card/);
expectMutationError("amber face used as an indicator shadow", (source) =>
  `${source}\n.rail-item[aria-current="page"] { box-shadow: inset 2px 0 var(--color-accent); }`, /Non-fill use of --color-accent.*rail-item/);
expectMutationError("amber hover face used as text color", (source) =>
  `${source}\n.x { color: var(--color-accent-hover); }`, /Non-fill use of --color-accent.*color: var\(--color-accent-hover\)/);
expectMutationError("amber face border on a rule that no longer fills it", (source) => source.replace(
  ".deid-check input:checked + .custom-check { background: var(--color-accent);",
  ".deid-check input:checked + .custom-check { background: var(--color-accent-subtle);"), /Non-fill use of --color-accent.*custom-check/);

test("amber fills, accent-color and same-face borders stay allowed by the non-fill rule", () => {
  const extra = `${css}\n.fill { background: var(--color-accent); }\n.fill:hover { background-color: var(--color-accent-hover); }\n` +
    `.check { accent-color: var(--color-accent); }`;
  assert.deepEqual(auditCss(extra).errors, []);
});

// Runs the real audit script with a source edit, in a temp dir whose node_modules points at the repo's.
async function mutatedAudit(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "audit-mutation-"));
  try {
    const root = fileURLToPath(new URL("..", import.meta.url));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    const original = readFileSync(join(root, "scripts/audit-ui-css.mjs"), "utf8");
    const changed = mutate(original);
    assert.notEqual(changed, original, "audit mutation must change the script");
    writeFileSync(join(dir, "audit.mjs"), changed);
    return await import(pathToFileURL(join(dir, "audit.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("D1.3 text-md is a verified font-size path in the audit", () => {
  assert.deepEqual(auditCss(`${css}\n.x { font-size: var(--text-md); }`).errors, []);
});

test("UI audit rejects removing md from the font-size token pattern", async () => {
  const probe = `${css}\n.x { font-size: var(--text-md); }`;
  const mutated = await mutatedAudit((source) => source.replace("text-(?:xs|sm|base|md|lg|", "text-(?:xs|sm|base|lg|"));
  assert.deepEqual(mutated.auditCss(css).errors, [], "mutated audit still passes CSS that does not use --text-md");
  assert.ok(mutated.auditCss(probe).errors.some((error) => /Unverified font-size path: var\(--text-md\)/.test(error)));
});

expectMutationError("missing bundled @font-face rules", (source) => source.replaceAll(/@font-face\s*\{[^}]*\}/g, ""), /Missing @font-face/);

test("D1.4 focus ring keeps the outline and adds the README inset ring plus halo", () => {
  const rule = css.match(/^button:focus-visible, input:focus-visible[^{]*\{([^}]*)\}/m)?.[1] ?? "";
  assert.match(rule, /outline:\s*2px solid var\(--color-focus-ring\)/);
  assert.match(rule, /box-shadow:\s*inset 0 0 0 1px var\(--color-focus-ring\), 0 0 0 3px var\(--color-focus-halo\)/);
  const forced = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(forced, /outline:\s*2px solid currentColor;\s*box-shadow:\s*none/);
});

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
