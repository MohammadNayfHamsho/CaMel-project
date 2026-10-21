// Labeled values: every value inside a running plan is a `Labeled`.
//
// Mirrors CaMeLValue in src/camel/interpreter/value.py:
//   raw      - the actual data. Primitives stay primitive; arrays hold Labeled
//              elements; objects are a Map<string, Labeled>.
//   caps     - this value's own Capabilities (sources + readers).
//   deps     - the values it was computed from (or that decided it was computed).
//
// JS cannot overload operators, so a wrapper that reaches a native operator
// (`+`, template literal, `${}`, String()) would silently lose its labels.
// To turn that silent bug into a loud one, wrappers refuse to be converted
// to primitives. The interpreter always works on `.raw` explicitly.

import { Capabilities, capabilitiesFromJSON, capabilitiesToJSON } from "./capabilities.js";

export const Kind = Object.freeze({
  Undefined: "undefined",
  Null: "null",
  Boolean: "boolean",
  Number: "number",
  String: "string",
  Array: "array",
  Object: "object",
  Function: "function", // tools and built-in functions
  Namespace: "namespace", // console, Math, Object, JSON, Array
  Shell: "shell", // a container's own label without its elements (see shellOf)
});

export class Labeled {
  /**
   * @param {string} kind
   * @param {*} raw
   * @param {Capabilities} caps
   * @param {Labeled[]} deps
   */
  constructor(kind, raw, caps, deps = []) {
    this.kind = kind;
    this.raw = raw;
    this.caps = caps;
    this.deps = Object.freeze([...deps]);
    Object.freeze(this);
  }

  get isContainer() {
    return this.kind === Kind.Array || this.kind === Kind.Object;
  }

  /** Same value, extra dependencies (mirrors `new_with_dependencies`). */
  withDeps(...extra) {
    if (extra.length === 0) return this;
    return new Labeled(this.kind, this.raw, this.caps, [...this.deps, ...extra]);
  }

  toString() {
    throw new Error("BUG: Labeled value used as a plain value (toString)");
  }

  valueOf() {
    throw new Error("BUG: Labeled value used as a plain value (valueOf)");
  }

  [Symbol.toPrimitive]() {
    throw new Error("BUG: Labeled value used as a plain value (toPrimitive)");
  }

  toJSON() {
    throw new Error("BUG: Labeled value passed to JSON.stringify; use toLabeledJSON()");
  }
}

export function isLabeled(value) {
  return value instanceof Labeled;
}

/** Throws if an unwrapped value escaped into the interpreter. */
export function assertLabeled(value, where) {
  if (!(value instanceof Labeled)) {
    throw new Error(`BUG: unwrapped value escaped in ${where}`);
  }
  return value;
}

// ---------------------------------------------------------------- constructors

function kindOfPrimitive(raw) {
  if (raw === undefined) return Kind.Undefined;
  if (raw === null) return Kind.Null;
  switch (typeof raw) {
    case "boolean":
      return Kind.Boolean;
    case "number":
      return Kind.Number;
    case "string":
      return Kind.String;
    default:
      throw new TypeError(`not a supported primitive: ${typeof raw}`);
  }
}

/** A primitive value with explicit capabilities. */
export function primitive(raw, caps, deps = []) {
  return new Labeled(kindOfPrimitive(raw), raw, caps, deps);
}

/** A literal from the plan: source User, readers Public (interpreter.py:326-327). */
export function literal(raw) {
  return primitive(raw, Capabilities.user());
}

/** An array of Labeled elements. */
export function array(elements, caps, deps = []) {
  elements.forEach((e, i) => assertLabeled(e, `array element ${i}`));
  return new Labeled(Kind.Array, Object.freeze([...elements]), caps, deps);
}

/** An object as an ordered Map<string, Labeled>. */
export function object(entries, caps, deps = []) {
  const map = new Map(entries);
  for (const [key, v] of map) {
    if (typeof key !== "string") throw new TypeError("object keys must be strings");
    assertLabeled(v, `object property ${key}`);
  }
  return new Labeled(Kind.Object, map, caps, deps);
}

/**
 * A new value computed by the interpreter from `inputs`.
 * The single helper for creating derived values, so dependencies are never forgotten.
 * Plain arrays/objects in `raw` are wrapped element-wise, each element depending on the inputs.
 */
export function derive(raw, ...inputs) {
  inputs.forEach((input, i) => assertLabeled(input, `derive input ${i}`));
  return wrapPlain(raw, Capabilities.camel(), inputs);
}

function wrapPlain(raw, caps, deps) {
  if (raw instanceof Labeled) return raw.withDeps(...deps);
  if (Array.isArray(raw)) {
    return array(
      raw.map((e) => wrapPlain(e, caps, deps)),
      caps,
      deps,
    );
  }
  if (raw !== null && typeof raw === "object") {
    return object(
      Object.entries(raw).map(([k, v]) => [k, wrapPlain(v, caps, deps)]),
      caps,
      deps,
    );
  }
  return primitive(raw, caps, deps);
}

/**
 * The container's own label without its elements.
 * Used as a dependency when reading ONE element (`list[0]`, `obj.key`), so the result
 * depends on who produced the container, but not on the sibling elements' contents.
 */
export function shellOf(container) {
  return new Labeled(Kind.Shell, undefined, container.caps, container.deps);
}

/** A callable: a tool (run by the host) or a built-in (run by the interpreter). */
export function callable({ name, isTool, impl = null, receiver = null }, deps = []) {
  return new Labeled(Kind.Function, Object.freeze({ name, isTool, impl, receiver }), Capabilities.camel(), deps);
}

export function namespace(name, members) {
  return new Labeled(Kind.Namespace, Object.freeze({ name, members }), Capabilities.camel());
}

// ---------------------------------------------------------------- conversion

/** Deep-unwraps to plain JS data (for printing, tool arguments, and native built-ins). */
export function toPlain(value) {
  assertLabeled(value, "toPlain");
  switch (value.kind) {
    case Kind.Array:
      return value.raw.map(toPlain);
    case Kind.Object:
      return Object.fromEntries([...value.raw].map(([k, v]) => [k, toPlain(v)]));
    case Kind.Function:
      return `[function ${value.raw.name}]`;
    case Kind.Namespace:
      return `[namespace ${value.raw.name}]`;
    case Kind.Shell:
      throw new Error("BUG: a shell has no content");
    default:
      return value.raw;
  }
}

/** JS string conversion semantics (String(x)) applied to a Labeled value's content. */
export function toDisplayString(value) {
  switch (value.kind) {
    case Kind.Array:
      return value.raw.map((e) => (e.kind === Kind.Null || e.kind === Kind.Undefined ? "" : toDisplayString(e))).join(",");
    case Kind.Object:
      return "[object Object]";
    case Kind.Function:
      return `function ${value.raw.name}() { [native code] }`;
    default:
      return String(value.raw);
  }
}

/**
 * Bridge format, one label per node so each element keeps its own capabilities:
 *   { "raw": primitive | [node, ...] | {"key": node, ...}, "labels": {sources, readers} }
 * Only the value's own capabilities are sent; dependencies stay on the interpreter side.
 */
export function toLabeledJSON(value) {
  let raw;
  switch (value.kind) {
    case Kind.Array:
      raw = value.raw.map(toLabeledJSON);
      break;
    case Kind.Object:
      raw = Object.fromEntries([...value.raw].map(([k, v]) => [k, toLabeledJSON(v)]));
      break;
    case Kind.Function:
    case Kind.Namespace:
    case Kind.Shell:
      throw new TypeError(`cannot serialize a ${value.kind}`);
    default:
      raw = value.raw === undefined ? null : value.raw;
  }
  return { raw, labels: capabilitiesToJSON(value.caps) };
}

/** Inverse of toLabeledJSON. Every node must carry labels: nothing enters unlabeled. */
export function fromLabeledJSON(node, deps = []) {
  if (!node || typeof node !== "object" || !("raw" in node) || !node.labels) {
    throw new TypeError(`invalid labeled value: ${JSON.stringify(node)}`);
  }
  const caps = capabilitiesFromJSON(node.labels);
  const { raw } = node;
  if (Array.isArray(raw)) {
    return array(
      raw.map((e) => fromLabeledJSON(e)),
      caps,
      deps,
    );
  }
  if (raw !== null && typeof raw === "object") {
    return object(
      Object.entries(raw).map(([k, v]) => [k, fromLabeledJSON(v)]),
      caps,
      deps,
    );
  }
  return primitive(raw, caps, deps);
}
