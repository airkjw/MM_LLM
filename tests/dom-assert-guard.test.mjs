import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describeValue, involvesDom } from "./dom-assert.ts";

const testsDir = new URL("./", import.meta.url);

// --- runtime regression: failing DOM-node comparisons fail fast, short and bounded -------------------------

const CHILD_RSS_LIMIT_KB = 300 * 1024;

/** Runs the fixture child and kills it as soon as its RSS passes the limit, so a regression cannot eat the host. */
function runChild() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--no-warnings", new URL("./fixtures/dom-assert-guard-child.mjs", import.meta.url).pathname],
      { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let peakKb = 0; let killedFor = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const watch = setInterval(() => {
      try {
        const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, "utf8"));
        peakKb = Math.max(peakKb, Number(rss?.[1] ?? 0));
        if (peakKb > CHILD_RSS_LIMIT_KB) { killedFor = `RSS ${Math.round(peakKb / 1024)} MB`; child.kill("SIGKILL"); }
      } catch { /* no /proc on this platform, or the child already exited */ }
      if (Date.now() - started > 20_000) { killedFor = "timeout"; child.kill("SIGKILL"); }
    }, 20);
    child.on("close", (status, signal) => { clearInterval(watch); resolve({ status, signal, stdout, stderr, killedFor }); });
  });
}

test("failing DOM-node comparisons raise a short AssertionError within seconds and bounded memory", async () => {
  const child = await runChild();
  assert.equal(child.killedFor, "", `child was killed for ${child.killedFor}: node:assert is inspecting DOM nodes again`);
  assert.equal(child.status, 0, `child exited ${child.status} signal=${child.signal}: ${child.stderr.slice(0, 500)}`);
  const report = JSON.parse(child.stdout.trim().split("\n").at(-1));
  assert.ok(report.elapsedMs < 5000, `guarded failures took ${report.elapsedMs} ms`);
  assert.ok(report.maxRssKb < 300 * 1024, `child peak RSS ${Math.round(report.maxRssKb / 1024)} MB`);
  const expectedNames = ["focus", "focusHelper", "queryVsNull", "absentHelper", "closestVsNull", "notEqualSame",
    "sameNodeHelper", "deepList", "windowCompare", "matchOnNode"];
  assert.deepEqual(Object.keys(report.results), expectedNames);
  for (const [name, result] of Object.entries(report.results)) {
    assert.equal(result.threw, true, `${name} must fail`);
    assert.equal(result.name, "AssertionError", name);
    assert.equal(result.code, "ERR_ASSERTION", name);
    assert.ok(result.message.length < 400, `${name} message is ${result.message.length} chars`);
    assert.equal(result.hasActual, false, `${name} must not attach DOM nodes to the error`);
  }
  assert.match(report.results.focus.message, /focus moves to the name field/);
  assert.match(report.results.focus.message, /<button\.primary> "저장"/);
  assert.match(report.results.focus.message, /<input#name>/);
  assert.match(report.results.queryVsNull.message, /actual <button\.primary> "저장", expected null/);
  assert.match(report.results.closestVsNull.message, /<main>/);
  assert.match(report.results.notEqualSame.message, /expected values to differ/);
  assert.match(report.results.deepList.message, /\[<input#name>/);
});

test("the guard leaves non-DOM comparisons to node:assert unchanged", () => {
  assert.equal(involvesDom(1), false);
  assert.equal(involvesDom({ nodeType: 1 }), false, "a bare nodeType is not a DOM node");
  assert.equal(involvesDom([1, "a", null]), false);
  assert.equal(describeValue("x".repeat(500)).length < 100, true);
  assert.equal(describeValue({ a: 1, b: [1, 2] }), "{ a: 1, b: [array(2)] }");
});

// --- static guard: every happy-dom test must use the guarded assert ----------------------------------------

const GUARD_IMPORT = /^import\s+assert(?:\s*,\s*\{[^}]*\})?\s+from\s+["']\.\/dom-assert\.ts["'];?\s*$/m;
const RAW_ASSERT_IMPORT = /(?:from\s+|require\(\s*|import\s*\(\s*|import\s+)["'](?:node:)?assert(?:\/strict)?["']/;

/** Returns the reasons a happy-dom UI test source is not protected from the DOM-node inspect OOM. */
export function domAssertViolations(source) {
  const problems = [];
  if (RAW_ASSERT_IMPORT.test(source)) {
    problems.push("imports node:assert directly");
  }
  if (!GUARD_IMPORT.test(source)) problems.push('does not `import assert from "./dom-assert.ts"`');
  return problems;
}

function domTestFiles() {
  return readdirSync(testsDir)
    .filter((name) => /\.test\.(tsx|ts|mjs)$/.test(name) && name !== "dom-assert-guard.test.mjs")
    .filter((name) => /-ui-dom\.test\.tsx$/.test(name) || /from\s+["']happy-dom["']/.test(readFileSync(new URL(name, testsDir), "utf8")));
}

const HINT = "A failing node:assert comparison with a happy-dom node as operand deep-inspects the whole DOM and "
  + "OOM-kills the host (15-17 GB). Use `import assert from \"./dom-assert.ts\"` (and assertFocused/assertAbsent/"
  + "assertSameNode) in UI DOM tests. See tests/dom-assert.ts.";

test("every happy-dom UI test imports the guarded assert and never node:assert directly", () => {
  const files = domTestFiles();
  assert.ok(files.length >= 7, `expected the UI DOM suites, found ${files.join(", ")}`);
  for (const name of files) {
    const problems = domAssertViolations(readFileSync(new URL(name, testsDir), "utf8"));
    assert.deepEqual(problems, [], `${name}: ${problems.join("; ")}. ${HINT}`);
  }
});

test("the static rule catches unguarded DOM-node assertion files", () => {
  const unguarded = 'import assert from "node:assert/strict";\nassert.equal(document.activeElement, el);\n';
  assert.deepEqual(domAssertViolations(unguarded), ["imports node:assert directly", 'does not `import assert from "./dom-assert.ts"`']);
  assert.ok(domAssertViolations('import { equal } from "node:assert";').includes("imports node:assert directly"));
  assert.ok(domAssertViolations('import nodeAssert from "assert/strict";').includes("imports node:assert directly"));
  assert.ok(domAssertViolations('const a = require("node:assert");').includes("imports node:assert directly"));
  assert.ok(domAssertViolations('const a = await import("node:assert/strict");').includes("imports node:assert directly"));
  assert.deepEqual(domAssertViolations('import assert, { assertFocused } from "./dom-assert.ts";\nassert.equal(1, 1);'), []);
  assert.deepEqual(domAssertViolations('import assert from "./dom-assert.ts";'), []);
});
