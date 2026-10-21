// Dependency walk: collects the effective labels of values.
//
// Mirrors get_all_sources / get_all_readers in src/camel/capabilities/utils.py:
//   sources = union of the sources of the value and everything it depends on
//   readers = intersection of the readers of the value and everything it depends on
//
// One deliberate difference from Python: when the walk reaches a container
// (array/object), it also includes the elements' OWN labels, not only their
// dependencies. Anything that hands a whole container to an operation or tool
// exposes all of its content, so all of it counts. Reading a single element
// (`list[0]`) depends only on the container's shell (see labeled.shellOf), so
// sibling elements do not make it stricter than necessary.

import {
  Capabilities,
  PUBLIC,
  capabilitiesToJSON,
  intersectReaders,
  isTrustedSource,
  sourceKey,
} from "./capabilities.js";
import { Kind, assertLabeled, shellOf } from "./labeled.js";

/**
 * Effective capabilities of `values` taken together.
 * @param {Iterable<import("./labeled.js").Labeled>} values
 * @returns {Capabilities}
 */
export function collectCapabilities(values) {
  const sources = new Map();
  let readers = PUBLIC;
  const visited = new Set();
  const stack = [...values];

  while (stack.length > 0) {
    const value = assertLabeled(stack.pop(), "dependency walk");
    if (visited.has(value)) continue;
    visited.add(value);

    for (const source of value.caps.sources) sources.set(sourceKey(source), source);
    readers = intersectReaders(readers, value.caps.readers);

    stack.push(...value.deps);
    if (value.kind === Kind.Array) stack.push(...value.raw);
    else if (value.kind === Kind.Object) stack.push(...value.raw.values());
  }
  return new Capabilities(sources.values(), readers);
}

/** Mirrors `is_trusted`: every source in the walk must be trusted. */
export function isTrusted(...values) {
  return collectCapabilities(values).sources.every(isTrustedSource);
}

/** Mirrors `is_public`. */
export function isPublic(...values) {
  return collectCapabilities(values).readers === PUBLIC;
}

/** Mirrors `can_readers_read_value`: every reader in `principals` may read all of `values`. */
export function canRead(principals, ...values) {
  const readers = collectCapabilities(values).readers;
  return readers === PUBLIC || [...principals].every((p) => readers.has(p));
}

/** Flattened labels for the bridge: what the policy engine in Python needs. */
export function flattenLabels(...values) {
  return capabilitiesToJSON(collectCapabilities(values));
}

/**
 * A value as a tree whose every node carries its EFFECTIVE labels (own + dependencies).
 * Used for tool arguments: the Python host rebuilds CaMeL values from it without any
 * dependency chain, so per-field labels must already be complete. Keeping a label per
 * node matters: in `send_email({recipients, body})` the policy checks `recipients`
 * on its own, so it must not inherit the body's labels.
 */
export function toFlattenedJSON(value) {
  assertLabeled(value, "toFlattenedJSON");
  let raw;
  switch (value.kind) {
    // An element also depends on its container's own label and dependencies.
    case Kind.Array:
      raw = value.raw.map((e) => toFlattenedJSON(e.withDeps(shellOf(value))));
      break;
    case Kind.Object:
      raw = Object.fromEntries([...value.raw].map(([k, v]) => [k, toFlattenedJSON(v.withDeps(shellOf(value)))]));
      break;
    case Kind.Function:
    case Kind.Namespace:
    case Kind.Shell:
      throw new TypeError(`cannot pass a ${value.kind} to a tool`);
    default:
      raw = value.raw === undefined ? null : value.raw;
  }
  return { raw, labels: flattenLabels(value) };
}
