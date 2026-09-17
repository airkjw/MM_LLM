import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { creditBalancePresentation, creditPresentation } from "../src/shared/credit-usage.ts";

const sidebar = readFileSync(new URL("../src/renderer/src/components/Sidebar.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const interactionDocs = readFileSync(new URL("../docs/SIDEBAR_INTERACTIONS.md", import.meta.url), "utf8");

test("credit presentation only draws a ratio with a meaningful denominator", () => {
  assert.deepEqual(creditPresentation(undefined), {
    quota: undefined, used: undefined, remaining: undefined, empty: false, low: false
  });
  assert.deepEqual(creditPresentation({ remaining: 8 }), {
    quota: undefined, used: undefined, remaining: 8, empty: false, low: false
  });
  assert.deepEqual(creditPresentation({ used: 92, remaining: 8 }), {
    quota: 100, used: 92, remaining: 8, empty: false, low: true
  });
  assert.deepEqual(creditPresentation({ quota: 100, used: 100, remaining: 0 }), {
    quota: 100, used: 100, remaining: 0, empty: true, low: false
  });
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = creditPresentation({ quota: invalid, used: invalid, remaining: invalid });
    assert.equal(result.quota, undefined);
    assert.equal(result.used, undefined);
    assert.equal(result.remaining, undefined);
    assert.equal(result.empty, false, `${String(invalid)} is unknown, not an empty balance`);
  }
  assert.deepEqual(creditPresentation({ quota: 100, remaining: 120 }), {
    quota: undefined, used: undefined, remaining: 120, empty: false, low: false
  });
  assert.deepEqual(creditBalancePresentation({ purchased: { remaining: 12 } }), {
    quota: undefined, used: undefined, remaining: 12, empty: false, low: false, source: "purchased"
  });
  assert.deepEqual(creditBalancePresentation({ monthly_allocated: { remaining: 0 } }), {
    quota: undefined, used: undefined, remaining: 0, empty: false, low: false, source: "monthly"
  }, "a zero monthly subtotal cannot prove that the whole account is empty");
  assert.deepEqual(creditBalancePresentation({
    monthly_allocated: { remaining: 10 }, purchased: { remaining: Number.NaN }
  }), {
    quota: undefined, used: undefined, remaining: undefined, empty: false, low: false, source: "unknown"
  }, "one invalid existing component makes the fallback aggregate unknown");
  assert.deepEqual(creditBalancePresentation({
    monthly_allocated: { remaining: Number.MAX_VALUE }, purchased: { remaining: Number.MAX_VALUE }
  }), {
    quota: undefined, used: undefined, remaining: undefined, empty: false, low: false, source: "unknown"
  }, "aggregate overflow is normalized to unavailable");
  assert.deepEqual(creditBalancePresentation({
    monthly_allocated: { quota: 100, used: 20, remaining: 80 },
    purchased: { quota: 50, used: 5, remaining: 45 }
  }), { quota: 150, used: 25, remaining: 125, empty: false, low: false, source: "components" });
  assert.deepEqual(creditBalancePresentation({
    monthly_allocated: { quota: Number.MAX_VALUE, used: Number.MAX_VALUE, remaining: 4 },
    purchased: { quota: Number.MAX_VALUE, used: Number.MAX_VALUE, remaining: 6 }
  }), { quota: undefined, used: undefined, remaining: 10, empty: false, low: false, source: "components" },
  "overflowing quota and usage are suppressed while a finite remaining aggregate stays usable");
});

test("sidebar exposes the accepted compact navigation and account semantics", () => {
  assert.doesNotMatch(sidebar, /className="sidebar-caption"|className="nav-item"|thread-tools|credit-card/);
  assert.match(sidebar, />만들기</);
  assert.match(sidebar, /role="dialog" aria-modal="false"/);
  assert.match(sidebar, /role="menu"/);
  assert.match(sidebar, /role="menuitem"/);
  assert.match(sidebar, /잔액 없음/);
  assert.match(sidebar, /업데이트 오류/);
  assert.match(sidebar, /대화 삭제/);
  assert.doesNotMatch(sidebar, /402/);
  assert.doesNotMatch(sidebar, /API에서 제공한 남은 잔액/);
  assert.doesNotMatch(app, /id: "chat", label: "대화"/);
  assert.match(app, /useResponsiveSidebarState\(\)/);
});

test("sidebar CSS keeps one scroll region and the agreed responsive widths", () => {
  assert.match(css, /\.sidebar \{[^}]*width: 264px;[^}]*overflow: hidden;/s);
  assert.match(css, /\.thread-list \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
  assert.match(css, /\.sidebar-account-area \{[^}]*flex: 0 0 52px;/s);
  assert.match(css, /min-width: 721px\) and \(max-width: 1100px\)[^{]*\{[\s\S]*?\.sidebar \{ width: 240px;/);
  assert.match(css, /max-width: 720px[\s\S]*?\.sidebar \{[^}]*position: fixed;[^}]*width: 264px;/);
  assert.match(css, /forced-colors: active[\s\S]*?\.thread-list[^}]*scrollbar-color: auto;/);
});

test("UI interaction checks are headless DOM checks and never launch bare Electron", () => {
  assert.match(packageJson.scripts["ui:check"], /sidebar-ui-dom\.test\.tsx/);
  assert.doesNotMatch(packageJson.scripts["ui:check"], /\belectron\b|default_app|Electron\.app/);
  assert.match(interactionDocs, /does not start Electron/);
  assert.match(interactionDocs, /does not claim to measure pixels/);
  assert.match(interactionDocs, /already open and visible desktop sidebar/);
  assert.match(packageJson.scripts.test, /npm run ui:check/);
});
