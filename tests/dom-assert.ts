// Shared assertion guard for the happy-dom UI tests (tests/*-ui-dom.test.tsx).
//
// Why this exists: when a node:assert comparison fails, AssertionError formats both operands with a deep
// util.inspect (customInspect disabled, unbounded depth). With a happy-dom Node/Window/Event operand that walks
// the whole object graph, and the process grew to 15-17 GB until the OOM killer took the Orca host down.
// util.inspect.custom cannot help because AssertionError ignores it, so the comparison itself is guarded:
// operands are only handed to node:assert when they are provably plain data (isAssertSafe, an allow-list);
// anything else (DOM nodes, classList, computed styles, class instances, nested containers of those) is compared
// by identity here and a failure reports a one-line description without ever handing the objects to node:assert.
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

const SAFE_DEPTH = 12;
const SAFE_BUDGET = 20_000;

/**
 * Allow-list: true only when node:assert may format the value, i.e. it is made of primitives, functions and
 * plain data (arrays, plain objects, Map/Set, Date, RegExp, Error, typed arrays) with no DOM object, accessor or
 * exotic object anywhere inside. The walk is bounded (depth, size, visited set); running out of budget counts as
 * unsafe. Everything else (DOM nodes, classList, getComputedStyle results, class instances, promises, ...) is
 * compared by identity and described by describeValue, so a failure never deep-inspects its object graph.
 */
export function isAssertSafe(value: Operand): boolean {
  const seen = new Set<object>();
  let budget = SAFE_BUDGET;
  const walk = (current: Operand, depth: number): boolean => {
    if (current === null || (typeof current !== "object")) return true; // primitives and functions
    if (seen.has(current)) return true;
    seen.add(current);
    if (depth > SAFE_DEPTH || --budget < 0 || isDomObject(current)) return false;
    if (current instanceof Date || current instanceof RegExp || ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return true;
    if (current instanceof Map) return [...current].every(([key, item]) => walk(key, depth + 1) && walk(item, depth + 1));
    if (current instanceof Set) return [...current].every((item) => walk(item, depth + 1));
    const proto = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && proto !== Object.prototype && proto !== null && !(current instanceof Error)) return false;
    // Errors: V8's own stack/message properties are engine-managed; only enumerable props and cause carry user data.
    const keys = current instanceof Error ? [...Object.keys(current), ...("cause" in current ? ["cause"] : [])] : Reflect.ownKeys(current);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!("value" in descriptor)) return false; // accessors are never invoked, and are not plain data
      if (!walk(descriptor.value, depth + 1)) return false;
    }
    return true;
  };
  return walk(value, 0);
}

function shorten(text: string, limit = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function isPlainObject(value: object) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** One-line, bounded description of any value; never inspects an arbitrary object's property graph. */
export function describeValue(value: Operand, depth = 0): string {
  if (value === null || value === undefined) return String(value);
  if (isDomObject(value)) {
    const node = value as { nodeType?: number; nodeName?: string; textContent?: string | null; id?: string;
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
  const name = (value as object).constructor?.name ?? "Object";
  if (Array.isArray(value)) {
    if (depth > 2) return `[array(${value.length})]`;
    return `[${value.slice(0, 8).map((item) => describeValue(item, depth + 1)).join(", ")}${value.length > 8 ? ", …" : ""}]`;
  }
  if (value instanceof Map || value instanceof Set) return `[${name}(${value.size})]`;
  if (isPlainObject(value)) {
    if (depth > 2) return "[object]";
    const keys = Object.keys(value);
    const entries = keys.slice(0, 6).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return `${key}: ${descriptor && "value" in descriptor ? describeValue(descriptor.value, depth + 1) : "[accessor]"}`;
    });
    return `{ ${entries.join(", ")}${keys.length > 6 ? ", …" : ""} }`;
  }
  // Array-like host collections (NodeList, HTMLCollection, DOMTokenList) list their first items; other objects only their class.
  const list = value as { item?: unknown; length?: unknown };
  if (typeof list.item === "function" && typeof list.length === "number") {
    const items = Array.from(value as ArrayLike<unknown>).slice(0, 8).map((item) => describeValue(item, depth + 1));
    return `[${name}(${list.length}): ${items.join(", ")}${list.length > 8 ? ", …" : ""}]`;
  }
  return `[${name}]`;
}

type Verdict = "same" | "different" | "unknown";

/** A Map key / Set item without an identical counterpart: DOM objects differ by identity, other objects might still deep-match. */
function unmatched(item: Operand): Verdict {
  return typeof item === "object" && item !== null && !isDomObject(item) ? "unknown" : "different";
}

function ownKeys(value: object) {
  return [...Object.keys(value), ...Object.getOwnPropertySymbols(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key))];
}

/**
 * Three-valued strict structural comparison for operands that must not reach node:assert. DOM objects and every
 * object whose structure is not modelled here compare by identity; when two distinct such objects meet the verdict
 * is "unknown", which fails closed for positive and negated assertions alike (never pass where node:assert would fail).
 */
function compare(actual: Operand, expected: Operand, deep: boolean, depth = 0): Verdict {
  if (Object.is(actual, expected)) return "same";
  if (typeof actual !== "object" || typeof expected !== "object" || actual === null || expected === null) return "different";
  if (isDomObject(actual) || isDomObject(expected)) return "different";
  if (!deep) return "different";
  if (depth > 32) return "unknown";
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return "different";
  const all = (pairs: Iterable<[Operand, Operand]>): Verdict => {
    let unknown = false;
    for (const [left, right] of pairs) {
      const verdict = compare(left, right, deep, depth + 1);
      if (verdict === "different") return "different";
      if (verdict === "unknown") unknown = true;
    }
    return unknown ? "unknown" : "same";
  };
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime() ? "same" : "different";
  if (actual instanceof RegExp && expected instanceof RegExp) return String(actual) === String(expected) ? "same" : "different";
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const left = ownKeys(actual); const right = ownKeys(expected);
    if (actual.length !== expected.length || left.length !== right.length) return "different";
    // Own keys (not indices) so array holes differ from undefined, like node's strict comparison.
    if (left.some((key) => !Object.hasOwn(expected, key))) return "different";
    return all(left.map((key) => [(actual as never)[key], (expected as never)[key]] as [Operand, Operand]));
  }
  if (actual instanceof Map && expected instanceof Map) {
    if (actual.size !== expected.size) return "different";
    const pairs: [Operand, Operand][] = [];
    for (const [key, item] of actual) {
      if (!expected.has(key)) return unmatched(key); // object keys: node would deep-match them
      pairs.push([item, expected.get(key)]);
    }
    return all(pairs);
  }
  if (actual instanceof Set && expected instanceof Set) {
    if (actual.size !== expected.size) return "different";
    for (const item of actual) if (!expected.has(item)) return unmatched(item);
    return "same";
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const left = ownKeys(actual); const right = ownKeys(expected);
    if (left.length !== right.length || left.some((key) => !Object.hasOwn(expected, key))) return "different";
    return all(left.map((key) => [(actual as never)[key], (expected as never)[key]] as [Operand, Operand]));
  }
  return "unknown";
}

function failure(operator: string, actual: Operand, expected: Operand, message?: string | Error, negated = false, unknown = false): never {
  if (message instanceof Error) throw message;
  const verb = unknown ? "cannot compare these values structurally without inspecting them (fail-closed; compare their properties)"
    : negated ? "expected values to differ" : "values differ";
  const detail = `${verb} (${operator}): actual ${describeValue(actual)}, expected ${negated ? "not " : ""}${describeValue(expected)}`;
  // No actual/expected properties: those would carry the DOM objects into the test runner's error serialization.
  // The operator is renamed because node appends its own value diff to messages of the strictEqual family.
  throw new AssertionError({ message: message ? `${message}: ${detail}` : detail, operator: `${operator}-dom` });
}

type Comparison = (actual: Operand, expected: Operand, message?: string | Error) => void;

function guardComparison(operator: string, original: Comparison, deep: boolean, negated: boolean): Comparison {
  return (actual, expected, message) => {
    if (isAssertSafe(actual) && isAssertSafe(expected)) return original(actual, expected, message);
    const verdict = compare(actual, expected, deep);
    if (verdict === (negated ? "different" : "same")) return;
    return failure(operator, actual, expected, message, negated, verdict === "unknown");
  };
}

function guardMatch(operator: "match" | "doesNotMatch", original: (value: string, pattern: RegExp, message?: string | Error) => void) {
  return (value: string, pattern: RegExp, message?: string | Error) => {
    if (typeof value === "string" || isAssertSafe(value)) return original(value, pattern, message);
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
