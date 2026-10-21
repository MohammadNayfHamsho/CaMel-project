// Built-in functions, methods, and namespaces available to plans.
//
// Mirrors src/camel/interpreter/library.py. Only what is listed here exists;
// anything else is rejected. Every built-in follows the same pattern:
//   unwrap -> compute on raw values with native JS -> derive() the result
// so the result depends on the inputs whose content it reveals.
//
// Mutating methods (push, sort, reverse, ...) are deliberately absent, as in
// CaMeL (value.py:236-242 rejects calls with side effects).

import {
  Kind,
  array,
  callable,
  derive,
  namespace,
  shellOf,
  toDisplayString,
  toPlain,
} from "./labeled.js";
import { Capabilities } from "./capabilities.js";
import { PlanTypeError } from "./errors.js";

// ---------------------------------------------------------------- semantics helpers

/** JS truthiness of a Labeled value's content. */
export function isTruthy(value) {
  switch (value.kind) {
    case Kind.Array:
    case Kind.Object:
    case Kind.Function:
    case Kind.Namespace:
      return true;
    default:
      return Boolean(value.raw);
  }
}

/** `===` on content: primitives by value, containers and functions by identity. */
export function strictEquals(a, b) {
  return a.kind === b.kind && a.raw === b.raw;
}

/** JS `typeof` of a Labeled value's content. */
export function typeOf(value) {
  switch (value.kind) {
    case Kind.Array:
    case Kind.Object:
    case Kind.Null:
    case Kind.Namespace:
      return "object";
    default:
      return value.kind;
  }
}

function expectKind(value, kinds, what, node) {
  if (!kinds.includes(value.kind)) {
    throw new PlanTypeError(`${what} expects ${kinds.join(" or ")}, got ${typeOf(value)}`, { node, deps: [value] });
  }
  return value.raw;
}

const PRIMITIVE_KINDS = [Kind.String, Kind.Number, Kind.Boolean, Kind.Null, Kind.Undefined];

function primitiveArgs(args, what, node) {
  return args.map((a) => expectKind(a, PRIMITIVE_KINDS, what, node));
}

function undefinedResult(...inputs) {
  return derive(undefined, ...inputs);
}

/** One element read out of a container: keeps its own label, depends on the container's shell. */
function elementOf(container, element, ...extraDeps) {
  return element.withDeps(shellOf(container), ...extraDeps);
}

// ---------------------------------------------------------------- string methods

function stringMethod(name) {
  return ({ receiver, args, node }) => {
    const plainArgs = primitiveArgs(args, `String.prototype.${name}`, node);
    const result = String.prototype[name].apply(receiver.raw, plainArgs);
    // The result reveals the receiver's content and depends on the arguments.
    // derive() wraps array results (split) element by element.
    return derive(result, receiver, ...args);
  };
}

const STRING_METHODS = {
  includes: stringMethod("includes"),
  startsWith: stringMethod("startsWith"),
  endsWith: stringMethod("endsWith"),
  indexOf: stringMethod("indexOf"),
  slice: stringMethod("slice"),
  split: stringMethod("split"),
  trim: stringMethod("trim"),
  toLowerCase: stringMethod("toLowerCase"),
  toUpperCase: stringMethod("toUpperCase"),
  replaceAll: stringMethod("replaceAll"),
};

// ---------------------------------------------------------------- array methods

const ARRAY_METHODS = {
  includes: ({ receiver, args }) => {
    const [needle = derive(undefined)] = args;
    return derive(
      receiver.raw.some((e) => strictEquals(e, needle)),
      receiver,
      needle,
    );
  },
  indexOf: ({ receiver, args }) => {
    const [needle = derive(undefined)] = args;
    return derive(
      receiver.raw.findIndex((e) => strictEquals(e, needle)),
      receiver,
      needle,
    );
  },
  slice: ({ receiver, args, node }) => {
    const bounds = args.map((a) => expectKind(a, [Kind.Number, Kind.Undefined], "Array.prototype.slice", node));
    const picked = receiver.raw.slice(...bounds);
    // Elements keep their own labels; which ones were picked depends on the bounds.
    return array(
      picked.map((e) => elementOf(receiver, e, ...args)),
      Capabilities.camel(),
      [shellOf(receiver), ...args],
    );
  },
  concat: ({ receiver, args, node }) => {
    const parts = [receiver, ...args];
    parts.forEach((p) => expectKind(p, [Kind.Array], "Array.prototype.concat", node));
    const elements = parts.flatMap((p) => p.raw.map((e) => elementOf(p, e)));
    return array(elements, Capabilities.camel(), parts.map(shellOf));
  },
  join: ({ receiver, args, node }) => {
    const [separator] = primitiveArgs(args, "Array.prototype.join", node);
    const text = receiver.raw
      .map((e) => (e.kind === Kind.Null || e.kind === Kind.Undefined ? "" : toDisplayString(e)))
      .join(separator === undefined ? "," : separator);
    return derive(text, receiver, ...args);
  },
};

// ---------------------------------------------------------------- properties

/** Built-in properties (not methods), e.g. `.length`. Returns null if none. */
export function getBuiltinProperty(receiver, name) {
  if (name !== "length") return null;
  if (receiver.kind === Kind.String) return derive(receiver.raw.length, receiver);
  // An array's length is a property of the container, not of its elements.
  if (receiver.kind === Kind.Array) return derive(receiver.raw.length, shellOf(receiver));
  return null;
}

/** Built-in method bound to `receiver`, or null if the method does not exist. */
export function getBuiltinMethod(receiver, name) {
  const table = receiver.kind === Kind.String ? STRING_METHODS : receiver.kind === Kind.Array ? ARRAY_METHODS : null;
  const impl = table && Object.hasOwn(table, name) ? table[name] : null;
  if (!impl) return null;
  return callable({ name: `${typeOf(receiver)}.${name}`, isTool: false, impl, receiver }, [receiver]);
}

// ---------------------------------------------------------------- global functions and namespaces

function fn(name, impl) {
  return callable({ name, isTool: false, impl });
}

function mathFn(name) {
  return fn(`Math.${name}`, ({ args, node }) => {
    const numbers = args.map((a) => expectKind(a, [Kind.Number], `Math.${name}`, node));
    return derive(Math[name](...numbers), ...args);
  });
}

function objectValuesOf(obj) {
  return [...obj.raw.values()].map((v) => elementOf(obj, v));
}

/**
 * Creates the root bindings for a run.
 * @param {(line: string) => void} print  receives console.log output
 */
export function createGlobals(print) {
  return {
    console: namespace("console", {
      log: fn("console.log", ({ args }) => {
        print(args.map(toDisplayString).join(" "));
        return undefinedResult(...args);
      }),
    }),

    Math: namespace("Math", {
      max: mathFn("max"),
      min: mathFn("min"),
      abs: mathFn("abs"),
      round: mathFn("round"),
      floor: mathFn("floor"),
      ceil: mathFn("ceil"),
    }),

    Object: namespace("Object", {
      keys: fn("Object.keys", ({ args: [obj], node }) => {
        expectKind(obj ?? derive(undefined), [Kind.Object], "Object.keys", node);
        return array(
          [...obj.raw.keys()].map((k) => derive(k, shellOf(obj))),
          Capabilities.camel(),
          [shellOf(obj)],
        );
      }),
      values: fn("Object.values", ({ args: [obj], node }) => {
        expectKind(obj ?? derive(undefined), [Kind.Object], "Object.values", node);
        return array(objectValuesOf(obj), Capabilities.camel(), [shellOf(obj)]);
      }),
      entries: fn("Object.entries", ({ args: [obj], node }) => {
        expectKind(obj ?? derive(undefined), [Kind.Object], "Object.entries", node);
        const pairs = [...obj.raw].map(([k, v]) =>
          array([derive(k, shellOf(obj)), elementOf(obj, v)], Capabilities.camel(), [shellOf(obj)]),
        );
        return array(pairs, Capabilities.camel(), [shellOf(obj)]);
      }),
    }),

    JSON: namespace("JSON", {
      stringify: fn("JSON.stringify", ({ args: [value] }) => {
        const v = value ?? derive(undefined);
        return derive(JSON.stringify(toPlain(v)), v);
      }),
    }),

    Array: namespace("Array", {
      isArray: fn("Array.isArray", ({ args: [value] }) => {
        const v = value ?? derive(undefined);
        return derive(v.kind === Kind.Array, v.isContainer ? shellOf(v) : v);
      }),
    }),

    String: fn("String", ({ args: [value] }) => {
      const v = value ?? derive("");
      return derive(toDisplayString(v), v);
    }),

    Number: fn("Number", ({ args: [value], node }) => {
      const v = value ?? derive(0);
      expectKind(v, PRIMITIVE_KINDS, "Number", node);
      return derive(Number(v.raw), v);
    }),

    Boolean: fn("Boolean", ({ args: [value] }) => {
      const v = value ?? derive(false);
      return derive(isTruthy(v), v);
    }),
  };
}

/** Names of all built-in functions and methods (for the system prompt). */
export const BUILTIN_SUMMARY = Object.freeze({
  functions: ["String", "Number", "Boolean", "console.log", "Math.max", "Math.min", "Math.abs", "Math.round",
    "Math.floor", "Math.ceil", "Object.keys", "Object.values", "Object.entries", "JSON.stringify", "Array.isArray"],
  stringMethods: ["length", ...Object.keys(STRING_METHODS)],
  arrayMethods: ["length", ...Object.keys(ARRAY_METHODS)],
});
