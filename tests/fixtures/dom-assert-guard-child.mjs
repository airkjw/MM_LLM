// Child process for tests/dom-assert-guard.test.mjs: runs deliberately failing DOM-node comparisons through the
// shared guard and prints one JSON line per case. The parent starts it with a small V8 heap, so a regression
// (node:assert deep-inspecting happy-dom nodes) dies on the heap cap instead of consuming the machine.
import { Window } from "happy-dom";
import assert, { assertAbsent, assertFocused, assertSameNode } from "../dom-assert.ts";

const browser = new Window({ url: "https://mm-llm.local/" });
browser.document.write("<!doctype html><html><body><main><button class='primary' aria-label='저장'>저장</button><input id='name'></main></body></html>");
const { document } = browser;
globalThis.document = document; // assertFocused reads the global, like the UI DOM suites
const button = document.querySelector("button");
const input = document.querySelector("input");
button.focus();

const cases = {
  focus: () => assert.equal(document.activeElement, input, "focus moves to the name field"),
  focusHelper: () => assertFocused(input, "focus helper"),
  queryVsNull: () => assert.equal(document.querySelector("button"), null),
  absentHelper: () => assertAbsent(document, "button"),
  closestVsNull: () => assert.strictEqual(button.closest("main"), null),
  notEqualSame: () => assert.notEqual(document.querySelector("button"), button),
  sameNodeHelper: () => assertSameNode(button, input),
  deepList: () => assert.deepEqual([...document.querySelectorAll("main > *")], [input, button]),
  windowCompare: () => assert.equal(browser, document),
  matchOnNode: () => assert.match(button, /저장/),
  // Forms that used to slip past a shallow DOM check and reach node:assert's deep inspect.
  nestedObject: () => assert.deepEqual({ a: { b: button } }, { a: { b: null } }),
  mapOfNodes: () => assert.deepEqual(new Map([[1, button]]), new Map()),
  classList: () => assert.equal(button.classList, null),
  computedStyle: () => assert.equal(browser.getComputedStyle(button), null),
  nestedArray: () => assert.deepEqual([[button]], [[null]])
};
const results = {};
const started = Date.now();
for (const [name, run] of Object.entries(cases)) {
  try { run(); results[name] = { threw: false }; }
  catch (error) {
    results[name] = { threw: true, name: error.name, code: error.code, message: error.message, hasActual: error.actual !== undefined };
  }
}
// Passing comparisons stay silent (plain data keeps node:assert semantics).
assert.deepEqual({ a: [1, { b: "x" }], c: new Map([[1, "y"]]) }, { a: [1, { b: "x" }], c: new Map([[1, "y"]]) });
assert.equal(button.classList, button.classList);
assert.deepEqual({ a: { b: button } }, { a: { b: button } });
assert.equal(document.activeElement, button);
assert.notEqual(document.activeElement, input);
assert.equal(document.querySelector(".missing"), null);
assert.deepEqual([...document.querySelectorAll("main > *")], [button, input]);
assertFocused(button);
assertAbsent(document, ".missing");
console.log(JSON.stringify({ results, elapsedMs: Date.now() - started, maxRssKb: process.resourceUsage().maxRSS }));
