// Shared assertion guard for the happy-dom UI tests (tests/*-ui-dom.test.tsx).
//
// Why this exists: when a node:assert comparison fails, AssertionError formats both operands with a deep
// util.inspect (customInspect disabled, unbounded depth). With a happy-dom Node/Window/Event operand that walks
// the whole object graph, and the process grew to 15-17 GB until the OOM killer took the Orca host down.
// util.inspect.custom cannot help because AssertionError ignores it, so the comparison itself is guarded:
// operands that involve DOM objects are compared by identity here and a failure reports a one-line description
// without ever handing the objects to node:assert.
//
// Usage: `import assert from "./dom-assert.ts"` instead of `node:assert/strict` (tests/dom-assert-guard.test.mjs
// enforces this for every UI DOM test). assertFocused / assertAbsent / assertSameNode are readable shortcuts.
import nodeAssert, { AssertionError } from "node:assert/strict";

type Operand = unknown;

/** True for happy-dom (or browser) Node, Window, EventTarget and Event objects, which have huge object graphs. */
export function isDomObject(value: Operand): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.nodeType === "number" && typeof candidate.nodeName === "string") return true;
  if (typeof candidate.addEventListener === "function" && typeof candidate.dispatchEvent === "function") return true;
  if (typeof candidate.composedPath === "function" && "target" in candidate) return true;
  return "happyDOM" in candidate;
}

function isListLike(value: Operand): value is ArrayLike<Operand> {
  return typeof value === "object" && value !== null
    && (Array.isArray(value) || (typeof (value as { item?: unknown }).item === "function"
      && typeof (value as { length?: unknown }).length === "number"));
}

/** True when the operand is, or directly holds, a DOM object (arrays, NodeLists and plain objects one level deep). */
export function involvesDom(value: Operand): boolean {
  if (isDomObject(value)) return true;
  if (isListLike(value)) return Array.from(value as ArrayLike<Operand>).some(isDomObject);
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).some(isDomObject);
  }
  return false;
}

function shorten(text: string, limit = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** One-line, bounded description of any value; never inspects a DOM object's property graph. */
export function describeValue(value: Operand, depth = 0): string {
  if (value === null || value === undefined) return String(value);
  if (isDomObject(value)) {
    const node = value as { nodeType?: number; nodeName?: string; textContent?: string | null; id?: string; className?: unknown;
      getAttribute?: (name: string) => string | null; tagName?: string };
    if (node.nodeType === 9) return "#document";
    if (typeof node.nodeType !== "number") return "#window-or-event";
    if (node.nodeType === 3 || node.nodeType === 8) return `${node.nodeName} "${shorten(node.textContent ?? "", 30)}"`;
    const tag = (node.tagName ?? node.nodeName ?? "node").toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const cls = typeof node.getAttribute === "function" ? node.getAttribute("class") : null;
    const label = typeof node.getAttribute === "function" ? node.getAttribute("aria-label") : null;
    const text = label ?? shorten(node.textContent ?? "", 30);
    return `<${tag}${id}${cls ? `.${shorten(cls, 40).replace(/ /g, ".")}` : ""}>${text ? ` "${text}"` : ""}`;
  }
  if (typeof value === "string") return JSON.stringify(shorten(value, 80));
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (typeof value !== "object") return String(value);
  if (depth > 0) return Array.isArray(value) ? `[array(${value.length})]` : "[object]";
  if (isListLike(value)) return `[${Array.from(value).slice(0, 8).map((item) => describeValue(item, 1)).join(", ")}${value.length > 8 ? ", …" : ""}]`;
  const entries = Object.entries(value).slice(0, 6).map(([key, item]) => `${key}: ${describeValue(item, 1)}`);
  return `{ ${entries.join(", ")} }`;
}

/** Structural equality where DOM objects (and anything non-plain) compare by identity. */
function sameShape(actual: Operand, expected: Operand, deep: boolean, depth = 0): boolean {
  if (Object.is(actual, expected)) return true;
  if (!deep || depth > 8) return false;
  if (isDomObject(actual) || isDomObject(expected)) return false;
  if (isListLike(actual) && isListLike(expected)) {
    if (actual.length !== expected.length) return false;
    return Array.from(actual).every((item, index) => sameShape(item, expected[index], deep, depth + 1));
  }
  const plain = (value: Operand) => typeof value === "object" && value !== null && !isListLike(value)
    && Object.getPrototypeOf(value) === Object.prototype;
  if (plain(actual) && plain(expected)) {
    const left = Object.entries(actual as object);
    const right = Object.keys(expected as object);
    return left.length === right.length
      && left.every(([key, item]) => key in (expected as object) && sameShape(item, (expected as Record<string, unknown>)[key], deep, depth + 1));
  }
  return false;
}

function failure(operator: string, actual: Operand, expected: Operand, message?: string | Error, negated = false): never {
  if (message instanceof Error) throw message;
  const verb = negated ? "expected values to differ" : "values differ";
  const detail = `${verb} (${operator}): actual ${describeValue(actual)}, expected ${negated ? "not " : ""}${describeValue(expected)}`;
  // No actual/expected properties: those would carry the DOM objects into the test runner's error serialization.
  // The operator is renamed because node appends its own value diff to messages of the strictEqual family.
  throw new AssertionError({ message: message ? `${message}: ${detail}` : detail, operator: `${operator}-dom` });
}

type Comparison = (actual: Operand, expected: Operand, message?: string | Error) => void;

function guardComparison(operator: string, original: Comparison, deep: boolean, negated: boolean): Comparison {
  return (actual, expected, message) => {
    if (!involvesDom(actual) && !involvesDom(expected)) return original(actual, expected, message);
    if (sameShape(actual, expected, deep) !== negated) return;
    return failure(operator, actual, expected, message, negated);
  };
}

function guardMatch(operator: "match" | "doesNotMatch", original: (value: string, pattern: RegExp, message?: string | Error) => void) {
  return (value: string, pattern: RegExp, message?: string | Error) => {
    if (typeof value === "string" || !involvesDom(value)) return original(value, pattern, message);
    return failure(operator, value, pattern, message);
  };
}

const strict = nodeAssert as typeof nodeAssert & Record<string, unknown>;
const guards = {
  equal: guardComparison("equal", strict.equal as Comparison, false, false),
  strictEqual: guardComparison("strictEqual", strict.strictEqual as Comparison, false, false),
  notEqual: guardComparison("notEqual", strict.notEqual as Comparison, false, true),
  notStrictEqual: guardComparison("notStrictEqual", strict.notStrictEqual as Comparison, false, true),
  deepEqual: guardComparison("deepEqual", strict.deepEqual as Comparison, true, false),
  deepStrictEqual: guardComparison("deepStrictEqual", strict.deepStrictEqual as Comparison, true, false),
  notDeepEqual: guardComparison("notDeepEqual", strict.notDeepEqual as Comparison, true, true),
  notDeepStrictEqual: guardComparison("notDeepStrictEqual", strict.notDeepStrictEqual as Comparison, true, true),
  match: guardMatch("match", strict.match as never),
  doesNotMatch: guardMatch("doesNotMatch", strict.doesNotMatch as never)
};

const guarded: typeof nodeAssert = Object.assign(
  ((value: unknown, message?: string | Error) => nodeAssert(value, message)) as typeof nodeAssert,
  nodeAssert,
  guards
);
guarded.strict = guarded;

export default guarded;

/** Asserts document.activeElement is `expected` (null/undefined means nothing is focused). */
export function assertFocused(expected: Element | null | undefined, message?: string): void {
  const active = document.activeElement;
  if (active === expected) return;
  failure("focus", active, expected, message);
}

/** Asserts nothing under `root` matches `selector` (replaces `assert.equal(root.querySelector(sel), null)`). */
export function assertAbsent(root: ParentNode, selector: string, message?: string): void {
  const found = root.querySelector(selector);
  if (found === null) return;
  failure("absent", found, null, message ?? `${selector} should not exist`);
}

/** Asserts two DOM references are the same node. */
export function assertSameNode(actual: unknown, expected: unknown, message?: string): void {
  if (Object.is(actual, expected)) return;
  failure("sameNode", actual, expected, message);
}
