import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeValue, isAssertSafe } from "./dom-assert.ts";

const testsDir = new URL("./", import.meta.url);

// --- runtime regression: failing DOM-node comparisons fail fast, short and bounded -------------------------

const CHILD_RSS_LIMIT_KB = 300 * 1024;
const children = new Set();
const killChildren = () => { for (const child of children) child.kill("SIGKILL"); };
process.on("exit", killChildren);
after(killChildren);

/** Runs the fixture child and kills it as soon as its RSS passes the limit, so a regression cannot eat the host. */
function runChild() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--max-old-space-size=256", "--no-warnings",
      fileURLToPath(new URL("./fixtures/dom-assert-guard-child.mjs", import.meta.url))], { stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
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
    child.on("close", (status, signal) => { clearInterval(watch); children.delete(child); resolve({ status, signal, stdout, stderr, killedFor }); });
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
    "sameNodeHelper", "deepList", "windowCompare", "matchOnNode", "nestedObject", "mapOfNodes", "classList", "computedStyle", "nestedArray"];
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
  assert.match(report.results.nestedObject.message, /actual \{ a: \{ b: <button\.primary> "저장" \} \}, expected \{ a: \{ b: null \} \}/);
  assert.match(report.results.mapOfNodes.message, /\[Map\(1\)\]/);
  assert.match(report.results.classList.message, /\[DOMTokenList\(1\): "primary"\]/);
  assert.match(report.results.computedStyle.message, /actual \[CSSStyleDeclaration/);
  assert.match(report.results.nestedArray.message, /actual \[\[<button\.primary> "저장"\]\]/);
});

test("only provably plain data goes to node:assert; everything else is described, not inspected", () => {
  for (const safe of [1, "a", null, undefined, [1, "a", null], { a: { b: [1, { c: new Date(0) }] } }, new Map([[1, { a: 1 }]]), new Set([1]),
    /x/, new Error("e"), new Uint8Array(2), () => 1, { fn() {} }]) {
    assert.equal(isAssertSafe(safe), true, describeValue(safe));
  }
  const cyclic = { name: "loop" }; cyclic.self = cyclic;
  assert.equal(isAssertSafe(cyclic), true, "cycles terminate through the visited set");
  assert.equal(isAssertSafe({ nodeType: 1 }), true, "a bare nodeType is not a DOM node");
  assert.equal(isAssertSafe({ nodeType: 1, nodeName: "DIV" }), false, "duck-typed nodes are never plain data");
  assert.equal(isAssertSafe({ get x() { throw new Error("getter must not run"); } }), false);
  assert.equal(isAssertSafe(new (class Thing {})()), false, "class instances are described, not inspected");
  assert.equal(isAssertSafe(Promise.resolve()), false);
  assert.equal(isAssertSafe(new Map([[1, { addEventListener() {}, dispatchEvent() {} }]])), false);
  let deep = {}; const root = deep;
  for (let i = 0; i < 40; i++) deep = deep.next = {};
  assert.equal(isAssertSafe(root), false, "the walk is depth-bounded");
  assert.equal(describeValue("x".repeat(500)).length < 100, true);
  assert.equal(describeValue({ a: 1, b: [1, 2] }), "{ a: 1, b: [1, 2] }");
  assert.equal(describeValue(new Map([[1, 2]])), "[Map(1)]");
});

test("plain-data deepEqual keeps node:assert's message and diff", async () => {
  const guarded = (await import("./dom-assert.ts")).default;
  const nodeAssert = (await import("node:assert/strict")).default;
  const messageOf = (assertion) => { try { assertion(); } catch (error) { return error.message; } };
  const actual = { calls: ["a", "b"], total: 2 };
  const expected = { calls: ["a", "c"], total: 3 };
  const original = messageOf(() => nodeAssert.deepEqual(actual, expected));
  assert.ok(original.includes("+ actual - expected"), "node:assert still produces its diff");
  assert.equal(messageOf(() => guarded.deepEqual(actual, expected)), original);
  assert.equal(messageOf(() => guarded.equal(1, 2, "counts")), messageOf(() => nodeAssert.equal(1, 2, "counts")));
});

// --- static guard: every happy-dom test must use the guarded assert ----------------------------------------

const GUARD_IMPORT = /^import\s+assert(?:\s*,\s*\{[^}]*\})?\s+from\s+["'](?:\.\/|\.\.\/)dom-assert\.ts["'];?\s*$/m;
const RAW_ASSERT_IMPORT = /(?:from\s+|require\(\s*|import\s*\(\s*|import\s+|getBuiltinModule\(\s*)["'](?:node:)?assert(?:\/strict)?["']/;
// node:test's TestContext carries its own node:assert (t.assert.equal, ctx.assert, const { assert } = t).
const CONTEXT_ASSERT = /(?<!console)\.assert\b|\{[^}]*\bassert\b[^}]*\}\s*=\s*(?!require|await)\w/;

/** Returns the reasons a happy-dom test source is not protected from the DOM-node inspect OOM. */
export function domAssertViolations(source) {
  const problems = [];
  if (RAW_ASSERT_IMPORT.test(source)) problems.push("imports node:assert directly");
  if (CONTEXT_ASSERT.test(source)) problems.push("uses the test context's own assert (t.assert)");
  if (!GUARD_IMPORT.test(source)) problems.push('does not `import assert from "./dom-assert.ts"`');
  return problems;
}

/** Every .ts/.tsx/.mjs under tests/ that is a UI DOM suite or loads happy-dom at all (helpers and fixtures included). */
function domTestFiles(dir = testsDir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) { found.push(...domTestFiles(new URL(`${name}/`, dir))); continue; }
    if (!/\.(tsx|ts|mjs)$/.test(name) || name === "dom-assert-guard.test.mjs") continue;
    const source = readFileSync(url, "utf8");
    if (/-ui-dom\.test\.tsx$/.test(name) || /(?:from\s+|require\(\s*|import\s*\(\s*)["']happy-dom["']/.test(source)) {
      found.push(fileURLToPath(url).slice(fileURLToPath(testsDir).length));
    }
  }
  return found;
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
  assert.ok(domAssertViolations('import assert from "./dom-assert.ts";\ntest("x", (t) => { t.assert.equal(document.activeElement, el); });').some((p) => p.includes("t.assert")));
  assert.ok(domAssertViolations('import assert from "./dom-assert.ts";\ntest("x", (ctx) => { ctx.assert.ok(1); });').some((p) => p.includes("t.assert")));
  assert.ok(domAssertViolations('import assert from "./dom-assert.ts";\ntest("x", (t) => { const { assert: a } = t; });').some((p) => p.includes("t.assert")));
  assert.ok(domAssertViolations('import assert from "./dom-assert.ts";\nconst raw = process.getBuiltinModule("node:assert");').includes("imports node:assert directly"));
  assert.ok(domAssertViolations('import assert from "./dom-assert.ts";\nconst raw = process.getBuiltinModule(\'assert/strict\');').includes("imports node:assert directly"));
  assert.deepEqual(domAssertViolations('import assert from "../dom-assert.ts";\nconsole.assert(true);'), []);
  assert.deepEqual(domAssertViolations('import assert, { assertFocused } from "./dom-assert.ts";\nassert.equal(1, 1);'), []);
  assert.deepEqual(domAssertViolations('import assert from "./dom-assert.ts";'), []);
});
