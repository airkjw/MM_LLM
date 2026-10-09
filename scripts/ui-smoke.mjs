#!/usr/bin/env node
/**
 * Dev-only UI smoke (contract §C). Not shipped: package.json `build.files` includes only `out/**`.
 *
 * Launches the built app in mock mode (`MM_LLM_MOCK=1`, `!app.isPackaged`) under Xvfb with Chromium's standard
 * `--remote-debugging-port`, then drives it through the Chrome DevTools Protocol using the existing `ws` dependency.
 * No product code carries a test hook: screens are reached with mouse and keyboard events only, and theme / font
 * size are changed through the real settings screen. Everything is synthetic: the only key typed is "mock-key".
 *
 *   npm run build
 *   systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 --quiet -- \
 *     env NODE_OPTIONS=--max-old-space-size=3072 timeout 300 node scripts/ui-smoke.mjs --stage 5 --shots DIR
 *
 * Options: --stage N (required) --shots DIR (required) [--port 9333] [--viewports 1280x900,980x1180,640x820]
 *   [--themes light,dark] [--fonts small,medium,large] [--screens a,b,…] [--no-states]
 * Output: DIR/stage{N}/{NN}-{screen}-{w}x{h}-{theme}-{font}.png, probes.json and probe-table.md.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const stage = args.stage;
if (!stage || !/^\d+$/.test(stage) || !args.shots) {
  console.error("usage: node scripts/ui-smoke.mjs --stage N --shots DIR [--port 9333] [--viewports WxH,…] [--themes light,dark] [--fonts small,medium,large] [--screens a,b] [--no-states]");
  process.exit(2);
}
const port = Number(args.port ?? 9333);
const viewports = (args.viewports ?? "1280x900,980x1180,640x820").split(",").map((item) => {
  const [width, height] = item.split("x").map(Number);
  if (!width || !height) throw new Error(`bad viewport ${item}`);
  return { width, height };
});
const themes = (args.themes ?? "light,dark").split(",");
const fonts = (args.fonts ?? "small,medium,large").split(",");
const fontLabel = { small: "작게", medium: "기본", large: "크게" };
const themeLabel = { light: "라이트", dark: "다크", system: "시스템" };
const SCREENS = ["start", "model-picker", "palette", "compare", "media", "research", "voice", "projects", "chatbot", "settings"];
const wanted = new Set((args.screens ?? SCREENS.join(",")).split(","));
const shotsDir = resolve(args.shots, `stage${stage}`);
mkdirSync(shotsDir, { recursive: true });

if (!existsSync(join(root, "out/main/index.js"))) { console.error("out/ is missing: run `npm run build` first."); process.exit(2); }
// The mock userData directory is `<TMPDIR>/mmllm-ui-smoke`; a private TMPDIR keeps every run empty and out of /tmp.
const scratch = mkdtempSync(join(tmpdir(), "mmllm-smoke-"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let child = null;
let cdp = null;
function stopApp() {
  if (cdp) { try { cdp.close(); } catch { /* already closed */ } cdp = null; }
  if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } child = null; }
}
process.on("SIGINT", () => { stopApp(); process.exit(130); });
process.on("SIGTERM", () => { stopApp(); process.exit(143); });

function parseArgs(list) {
  const out = {};
  for (let index = 0; index < list.length; index++) {
    if (!list[index].startsWith("--")) continue;
    const name = list[index].slice(2);
    const next = list[index + 1];
    if (next === undefined || next.startsWith("--")) out[name.replace(/^no-/, "no_")] = true;
    else { out[name] = next; index++; }
  }
  return out;
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map();
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      const entry = message.id ? this.pending.get(message.id) : null;
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function launch(extraFlags = []) {
  const env = { ...process.env, MM_LLM_MOCK: "1", ELECTRON_ENABLE_LOGGING: "1", TMPDIR: scratch };
  rmSync(join(scratch, "mmllm-ui-smoke"), { recursive: true, force: true });
  const electron = join(root, "node_modules/.bin/electron");
  let exited = false;
  child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1600x1200x24", electron, ".", ...extraFlags, `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1", "--disable-gpu"], { cwd: root, env, detached: true, stdio: ["ignore", "ignore", "ignore"] });
  child.on("exit", () => { exited = true; child = null; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) return null;
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* the app is still starting */ }
    await sleep(400);
  }
  throw new Error("the app did not expose a CDP page target within 60s");
}
/** Runs with the OS sandbox first. Hosts without a configured chrome-sandbox (this repo's CI/dev boxes) abort at once; the
 * mock-only smoke then retries with Chromium's `--no-sandbox`. The product's own `sandbox: true` window option is untouched. */
async function launchApp() {
  const first = await launch();
  if (first) return first;
  console.log("  note: Electron exited at start (no usable OS sandbox); retrying with --no-sandbox (dev smoke, mock mode only)");
  const second = await launch(["--no-sandbox"]);
  if (!second) throw new Error("Electron exited at start even with --no-sandbox");
  return second;
}

async function connect(url) {
  const socket = new WebSocket(url, { perMessageDeflate: false });
  await new Promise((done, fail) => { socket.once("open", done); socket.once("error", fail); });
  cdp = new Cdp(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
}

// ---- page helpers (events only; nothing sets React state) -------------------------------------------------------
const q = JSON.stringify;
async function waitFor(expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdp.eval(`Boolean(${expression})`)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}
/** JS expression evaluating to the first visible element whose text/title/aria-label matches. */
const byText = (selector, text) => `[...document.querySelectorAll(${q(selector)})].find((el) => el.getClientRects().length && ` +
  `((el.getAttribute("aria-label") ?? "") === ${q(text)} || (el.getAttribute("title") ?? "") === ${q(text)} || (el.textContent ?? "").trim() === ${q(text)}))`;
async function rectOf(elementExpression) {
  return cdp.eval(`(() => { const el = ${elementExpression}; if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
}
async function mouse(type, x, y, extra = {}) {
  await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}
async function hover(elementExpression) {
  const rect = await rectOf(elementExpression);
  if (!rect) throw new Error(`hover target missing: ${elementExpression}`);
  await mouse("mouseMoved", rect.x + rect.width / 2, rect.y + rect.height / 2, { button: "none", clickCount: 0 });
  return rect;
}
async function click(elementExpression) {
  const rect = await hover(elementExpression);
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y);
  await sleep(120);
}
const KEYS = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  k: { key: "k", code: "KeyK", vk: 75 }, n: { key: "n", code: "KeyN", vk: 78 }
};
const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function press(name, modifiers = 0) {
  const spec = KEYS[name];
  const base = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk, modifiers };
  await cdp.send("Input.dispatchKeyEvent", { type: spec.text && !modifiers ? "keyDown" : "rawKeyDown", ...base, ...(spec.text && !modifiers ? { text: spec.text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(100);
}
async function typeText(text) { await cdp.send("Input.insertText", { text }); await sleep(100); }
async function setViewport({ width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
}
async function shot(name, clip) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(join(shotsDir, name), Buffer.from(data, "base64"));
}

// ---- metric probe -----------------------------------------------------------------------------------------------
const COLUMN = {
  start: ".sidebar", "model-picker": ".sidebar", palette: ".sidebar", compare: ".sidebar", media: ".media-layout > :first-child",
  research: ".research-column", voice: ".voice-settings", projects: ".project-list-column", chatbot: ".screen-column",
  settings: ".settings-column", login: null
};
const EXPECTED_COLUMN = { start: 260, "model-picker": 260, palette: 260, compare: 260, media: 340, research: 320, voice: 320,
  projects: 260, chatbot: null, settings: 240, login: null };
/** The conversation list column steps down to 240 between 721 and 1100px (styles.css `min-width: 721px and max-width: 1100px`). */
const expectedColumnAt = (screen, width) => EXPECTED_COLUMN[screen] === 260 && ["start", "model-picker", "palette", "compare"].includes(screen) &&
  width > 720 && width <= 1100 ? 240 : EXPECTED_COLUMN[screen];
async function probe(screen, viewport, theme, font) {
  const selector = COLUMN[screen] ?? null;
  const data = await cdp.eval(`(() => {
    const width = (sel) => { const el = sel && document.querySelector(sel); return el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().width) : null; };
    const header = [...document.querySelectorAll(".panel-header")].find((el) => el.getClientRects().length);
    const scroller = document.scrollingElement;
    const wide = [...document.querySelectorAll("body *")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : ""));
    const active = document.activeElement;
    // JetBrains Mono has a mono-width space but no Hangul: Hangul words separated by spaces in a mono field look gapped.
    const named = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "");
    const describe = (el) => (el.parentElement ? named(el.parentElement) + " > " : "") + named(el);
    const hangulSpaced = /[가-힣]\\s+\\S|\\S\\s+[가-힣]/;
    const monoHangul = [...document.querySelectorAll("body *")].filter((el) => el.getClientRects().length && !el.classList.contains("sr-only") && /JetBrains Mono/.test(getComputedStyle(el).fontFamily) &&
      (el.tagName === "SELECT" ? hangulSpaced.test(el.selectedOptions[0]?.text ?? "") : [...el.childNodes].some((node) => node.nodeType === 3 && hangulSpaced.test(node.textContent ?? ""))))
      .slice(0, 6).map(describe);
    const placeholderMono = [...document.querySelectorAll("input[placeholder], textarea[placeholder]")].filter((el) => el.getClientRects().length &&
      /[가-힣]/.test(el.placeholder) && /JetBrains Mono/.test(getComputedStyle(el, "::placeholder").fontFamily)).slice(0, 4).map(describe);
    return { monoHangul, placeholderMono, rail: width(".rail"), column: width(${q(selector)}), header: header ? Math.round(header.getBoundingClientRect().height) : null,
      scrollWidth: scroller.scrollWidth, innerWidth, noHorizontalScroll: scroller.scrollWidth <= innerWidth,
      overflowing: wide, bg: getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
      dataTheme: document.documentElement.dataset.theme ?? null, dataFont: document.documentElement.dataset.fontSize ?? null,
      rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      ariaCurrentPage: document.querySelectorAll('[aria-current="page"]').length,
      focusLabel: active && active !== document.body ? (active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 40) ?? active.tagName) : null };
  })()`);
  const expectedColumn = expectedColumnAt(screen, viewport.width);
  const wide = viewport.width > 720;
  const checks = {
    rail56: data.rail === 56,
    header52: data.header === null || data.header === 52,
    column: !wide || expectedColumn == null || data.column == null || data.column === expectedColumn,
    noHorizontalScroll: data.noHorizontalScroll,
    noMonoHangulGap: data.monoHangul.length === 0 && data.placeholderMono.length === 0,
    oneCurrent: screen === "login" || data.ariaCurrentPage === 1
  };
  if (screen === "login") { checks.rail56 = data.rail === null; checks.header52 = true; }
  return { screen, viewport: `${viewport.width}x${viewport.height}`, theme, font, ...data, expectedColumn, checks,
    pass: Object.values(checks).every(Boolean) };
}

const records = [];
let sequence = 0;
async function capture(screen, viewport, theme, font) {
  await sleep(150);
  const record = await probe(screen, viewport, theme, font);
  sequence++;
  const name = `${String(sequence).padStart(3, "0")}-${screen}-${viewport.width}x${viewport.height}-${theme}-${font}.png`;
  await shot(name);
  records.push({ file: name, ...record });
  if (!record.pass) console.log(`  ! ${name}: ${Object.entries(record.checks).filter(([, ok]) => !ok).map(([key]) => key).join(", ")}`);
}

// ---- navigation -------------------------------------------------------------------------------------------------
const rail = (label) => byText("nav.rail button", label);
async function goRail(label, ready) {
  await click(rail(label));
  if (ready) await waitFor(ready, `${label} screen`);
  await sleep(150);
}
async function escapeAll() { await press("Escape"); await press("Escape"); await sleep(100); }

async function login(viewport) {
  const input = `document.querySelector("#api-key")`;
  await click(input);
  await typeText("mock-key");
  await press("Enter");
  await waitFor(`document.querySelector("nav.rail")`, "the rail after login", 30_000);
  await waitFor(`document.querySelector(".chat-panel, .template-card, .composer-input")`, "the conversation", 30_000);
  await sleep(400);
  void viewport;
}

async function chooseRadio(group, label) {
  const expression = `[...document.querySelectorAll('[role="radiogroup"][aria-label=${q(group)}] [role="radio"]')].find((el) => (el.textContent ?? "").includes(${q(label)}))`;
  await click(expression);
  await sleep(250);
}
async function setAppearance(theme, font) {
  await goRail("앱 설정", `document.querySelector(".settings-screen")`);
  await click(byText(".settings-categories button", "화면"));
  await waitFor(`document.querySelector('[role="radiogroup"][aria-label="화면 모드"]')`, "display settings");
  await chooseRadio("화면 모드", themeLabel[theme]);
  await waitFor(`document.documentElement.dataset.theme === ${q(theme)}`, `${theme} theme`);
  await chooseRadio("글자 크기", fontLabel[font]);
  await waitFor(`document.documentElement.dataset.fontSize === ${q(font)}`, `${font} font size`);
}

async function ensureProject() {
  await goRail("프로젝트", `document.querySelector(".project-screen")`);
  const hasProject = await cdp.eval(`Boolean(document.querySelector(".project-nav button"))`);
  if (hasProject) return;
  await click(`document.querySelector(".project-new input")`);
  await typeText("스모크 합성 프로젝트");
  await click(byText(".project-new button", "프로젝트 만들기"));
  await waitFor(`document.querySelector(".project-nav button")`, "the created project", 20_000);
}

async function newConversation() {
  await goRail("대화", `document.querySelector(".chat-panel")`);
  await press("n", MODIFIER.ctrl);
  await waitFor(`document.querySelector(".template-card, .chat-welcome")`, "a fresh conversation");
  await sleep(250);
}

async function runScreens(viewport, theme, font) {
  const compact = viewport.width <= 720;
  const tag = [viewport, theme, font];
  if (wanted.has("start") || wanted.has("model-picker") || wanted.has("palette") || wanted.has("compare")) {
    await newConversation();
    if (wanted.has("start")) await capture("start", ...tag);
    if (wanted.has("model-picker")) {
      await click(`document.querySelector(".composer-model-add")`);
      await waitFor(`document.querySelector(".model-popover")`, "the model picker");
      await capture("model-picker", ...tag);
      await escapeAll();
    }
    if (wanted.has("palette")) {
      await press("k", MODIFIER.ctrl);
      await waitFor(`document.querySelector(".command-palette")`, "the command palette");
      await typeText("대기");
      await sleep(250);
      await capture("palette", ...tag);
      await escapeAll();
    }
    if (wanted.has("compare")) {
      // Two more model tokens with Shift+Enter in the picker, then a question; the mock stream answers for free.
      await click(`document.querySelector(".composer-model-add")`);
      await waitFor(`document.querySelector(".model-popover")`, "the model picker");
      await press("Enter", MODIFIER.shift);            // row 1 (the conversation model is a later row, so this adds a second model)
      await press("ArrowDown"); await press("ArrowDown"); await press("Enter", MODIFIER.shift);
      await escapeAll();
      await waitFor(`document.querySelectorAll(".composer-model-token").length >= 3`, "three model tokens");
      await click(`document.querySelector(".composer-input")`);
      await typeText("병원 외래 대기시간을 줄이는 방법을 비교해 주세요.");
      await press("Enter");
      await waitFor(`document.querySelectorAll(".compare-inline-column").length === 3 && document.querySelectorAll(".compare-continue").length === 3`,
        "three completed comparison columns", 30_000);
      await capture("compare", ...tag);
      if (compact) {
        const stacked = await cdp.eval(`getComputedStyle(document.querySelector(".compare-inline-columns")).gridTemplateColumns.trim().split(/\\s+/).length`);
        records.at(-1).compareColumnTracks = stacked;
        records.at(-1).checks.compareStacked = stacked === 1;
        records.at(-1).pass = Object.values(records.at(-1).checks).every(Boolean);
      }
    }
  }
  if (compact) {
    // The list column is an overlay sheet at ≤720px: opening it must put a visible, in-viewport column over the body.
    await goRail("대화", `document.querySelector(".chat-panel")`);
    await click(`document.querySelector(".rail .sidebar-mobile-open.visible")`);
    await waitFor(`document.querySelector(".sidebar:not(.collapsed)")`, "the list sheet");
    await sleep(250);
    await capture("list-sheet", ...tag);
    const sheet = await cdp.eval(`(() => { const r = document.querySelector(".sidebar").getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; })()`);
    const last = records.at(-1);
    last.listSheet = sheet; last.checks.listSheetInViewport = sheet.width > 0 && sheet.right <= viewport.width + 1;
    last.pass = Object.values(last.checks).every(Boolean);
    await escapeAll();
  }
  const screens = [
    ["media", "미디어", `document.querySelector(".media-layout")`], ["research", "논문·법령 리서치", `document.querySelector(".research-column")`],
    ["voice", "음성", `document.querySelector(".voice-screen")`], ["projects", "프로젝트", `document.querySelector(".project-screen")`],
    ["chatbot", "챗봇", `document.querySelector(".screen-layout, .chatbot-screen")`], ["settings", "앱 설정", `document.querySelector(".settings-screen")`]
  ];
  for (const [screen, label, ready] of screens) {
    if (!wanted.has(screen)) continue;
    await goRail(label, ready);
    if (screen === "settings") {
      await click(byText(".settings-categories button", "화면"));
      await waitFor(`document.querySelector('[role="radiogroup"][aria-label="화면 모드"]')`, "display settings");
    }
    await capture(screen, ...tag);
  }
}

// ---- component state captures (README 13/14), driven by hover / focus / disabled via input events --------------
async function stateCaptures(theme) {
  const dir = (name) => `state-${name}-${theme}.png`;
  const clipOf = async (expression, pad = 10) => {
    const rect = await rectOf(expression);
    if (!rect) return null;
    return { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 };
  };
  const record = async (name, expression, pad) => {
    const clip = await clipOf(expression, pad);
    if (!clip) { records.push({ file: dir(name), screen: `state:${name}`, theme, skipped: "element missing" }); return; }
    await shot(dir(name), clip);
    records.push({ file: dir(name), screen: `state:${name}`, theme, pass: true });
  };
  await setViewport(viewports[0]);
  // Settings: buttons, segment, toggle, notice-like rows.
  await goRail("앱 설정", `document.querySelector(".settings-screen")`);
  await click(byText(".settings-categories button", "일반"));
  const refresh = byText(".settings-body button", "모델 목록 새로고침");
  await record("secondary-default", refresh);
  await hover(refresh); await record("secondary-hover", refresh);
  await mouse("mouseMoved", 5, 5, { button: "none", clickCount: 0 });
  await cdp.eval(`${refresh}.focus()`); await press("Tab", MODIFIER.shift); await press("Tab");
  await record("secondary-focus", refresh);
  await record("update-row-disabled", `${byText(".settings-body button", "업데이트 확인")}`);
  await click(byText(".settings-categories button", "화면"));
  await waitFor(`document.querySelector('[role="radiogroup"][aria-label="글자 크기"]')`, "display settings");
  await record("segment", `document.querySelector('[role="radiogroup"][aria-label="글자 크기"]')`);
  await record("toggle", `document.querySelector('[role="switch"]')`);
  await record("theme-cards", `document.querySelector(".theme-cards")`);
  await click(byText(".settings-categories button", "응답 기본값"));
  await record("textarea-default", `document.querySelector(".settings-field textarea")`);
  await click(`document.querySelector(".settings-field textarea")`);
  await record("textarea-focus", `document.querySelector(".settings-field textarea")`);
  await click(byText(".settings-categories button", "계정 · API 키"));
  await record("danger-logout", byText(".settings-body button", "로그아웃"));
  // Start screen: primary send button disabled, model picker search focus, badges and menu rows.
  await newConversation();
  await record("send-disabled", `document.querySelector(".send-button")`);
  await click(`document.querySelector(".composer-model-add")`);
  await waitFor(`document.querySelector(".model-popover")`, "the model picker");
  await record("picker-search-focus", `document.querySelector(".model-search")`);
  await record("picker-rows-badges", `document.querySelector(".model-options")`, 4);
  await escapeAll();
  await record("composer", `document.querySelector(".composer-card")`);
  // Thread menu (README MENU): the first row's actions.
  const rowMenu = `document.querySelector(".thread-item .thread-menu-trigger, .thread-item [aria-haspopup]")`;
  if (await cdp.eval(`Boolean(${rowMenu})`)) {
    await click(rowMenu);
    await sleep(200);
    await record("menu", `document.querySelector('[role="menu"]')`, 6);
    await escapeAll();
  }
}

// ---- main ---------------------------------------------------------------------------------------------------------
function table() {
  const rows = records.filter((item) => item.checks);
  const head = "| # | screen | viewport | theme | font | rail | column (exp) | header | scrollW/innerW | bg | current | pass |\n|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((item, index) => `| ${index + 1} | ${item.screen} | ${item.viewport} | ${item.theme} | ${item.font} | ${item.rail ?? "-"} | ` +
    `${item.column ?? "-"} (${item.expectedColumn ?? "-"}) | ${item.header ?? "-"} | ${item.scrollWidth}/${item.innerWidth} | ${item.bg} | ${item.ariaCurrentPage} | ${item.pass ? "PASS" : "FAIL"} |`);
  return `${head}\n${lines.join("\n")}\n`;
}

try {
  console.log(`ui-smoke stage ${stage}: ${viewports.length} viewport(s) × ${themes.length} theme(s) × ${fonts.length} font(s) → ${shotsDir}`);
  const wsUrl = await launchApp();
  await connect(wsUrl);
  await setViewport(viewports[0]);
  await waitFor(`document.querySelector("#api-key, nav.rail")`, "the login screen", 30_000);
  // Login screen first (before logging in), at every viewport.
  if (wanted.has("login") || args.screens === undefined) {
    for (const viewport of viewports) {
      await setViewport(viewport);
      await capture("login", viewport, "light", "medium");
    }
    await setViewport(viewports[0]);
  }
  await login(viewports[0]);
  const models = await cdp.eval(`window.mmllm.getSession().then((session) => session.models.map((model) => model.id).slice(0, 3))`);
  if (!models.includes("gpt-6-astra")) throw new Error("the app is not running the mock gateway; refusing to continue");
  if (wanted.has("projects")) await ensureProject();
  for (const font of fonts) {
    for (const theme of themes) {
      await setViewport(viewports[0]);
      await setAppearance(theme, font);
      for (const viewport of viewports) {
        await setViewport(viewport);
        console.log(`  ${viewport.width}x${viewport.height} ${theme} ${font}`);
        await runScreens(viewport, theme, font);
      }
    }
  }
  if (!args.no_states) {
    for (const theme of themes) {
      await setViewport(viewports[0]);
      await setAppearance(theme, "medium");
      await stateCaptures(theme);
    }
  }
  const failures = records.filter((item) => item.checks && !item.pass);
  writeFileSync(join(shotsDir, "probes.json"), JSON.stringify({ stage, generatedAt: new Date().toISOString(), records }, null, 2));
  writeFileSync(join(shotsDir, "probe-table.md"), table());
  console.log(`${records.length} captures, ${failures.length} probe failure(s). Table: ${join(shotsDir, "probe-table.md")}`);
  process.exitCode = failures.length ? 1 : 0;
} catch (error) {
  console.error(`ui-smoke failed: ${error.message}`);
  writeFileSync(join(shotsDir, "probes.partial.json"), JSON.stringify({ stage, error: error.message, records }, null, 2));
  process.exitCode = 1;
} finally {
  stopApp();
  rmSync(scratch, { recursive: true, force: true });
}
