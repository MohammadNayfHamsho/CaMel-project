// Capabilities: the label attached to every value.
//
// Mirrors src/camel/capabilities/ in the Python implementation:
//   - sources: where a value came from (who could have written it)
//   - readers: who is allowed to see it (PUBLIC, or a set of principals)

/** Built-in sources, mirroring `SourceEnum` in sources.py. */
export const Source = Object.freeze({
  User: "User",
  CaMeL: "CaMeL",
  Assistant: "Assistant",
  TrustedToolSource: "TrustedToolSource",
});

/** Sources that count as trusted, mirroring `_TRUSTED_SET` in utils.py. */
const TRUSTED_SOURCES = new Set(Object.values(Source));

/** Marker for "anyone may read this", mirroring `readers.Public`. */
export const PUBLIC = Object.freeze({ public: true });

/**
 * A tool source, mirroring `sources.Tool`.
 * `inner` lists who could have written the data (e.g. a file's editors);
 * the user's own address is represented by `Source.User`.
 */
export function toolSource(toolName, inner = []) {
  return Object.freeze({ tool: toolName, inner: Object.freeze([...new Set(inner)].sort()) });
}

export class Capabilities {
  /**
   * @param {Iterable<string|object>} sources
   * @param {typeof PUBLIC | Iterable<string>} readers
   */
  constructor(sources, readers) {
    this.sources = Object.freeze([...sources]);
    this.readers = readers === PUBLIC ? PUBLIC : Object.freeze(new Set(readers));
    Object.freeze(this);
  }

  /** Literals written by the P-LLM: they can only come from the user's prompt. */
  static user() {
    return USER_CAPS;
  }

  /** Values computed by the interpreter itself (e.g. the result of `a + b`). */
  static camel() {
    return CAMEL_CAPS;
  }
}

const USER_CAPS = new Capabilities([Source.User], PUBLIC);
const CAMEL_CAPS = new Capabilities([Source.CaMeL], PUBLIC);

/** Readers intersection, mirroring `Public.__and__` and frozenset `&`. */
export function intersectReaders(a, b) {
  if (a === PUBLIC) return b;
  if (b === PUBLIC) return a;
  return new Set([...a].filter((reader) => b.has(reader)));
}

/** Mirrors `_source_is_trusted` in utils.py. */
export function isTrustedSource(source) {
  if (typeof source === "string") return TRUSTED_SOURCES.has(source);
  return source.inner.length > 0 && source.inner.every((inner) => TRUSTED_SOURCES.has(inner));
}

/** A stable key so equal sources can be deduplicated in a Map. */
export function sourceKey(source) {
  return typeof source === "string" ? source : `tool:${source.tool}:${source.inner.join(",")}`;
}

// ---------------------------------------------------------------- JSON (bridge format)
//
// Source:  "User" | "CaMeL" | "Assistant" | "TrustedToolSource" | {"tool": name, "inner": [...]}
// Readers: "Public" | ["alice@example.com", ...]

export function capabilitiesToJSON(caps) {
  return {
    sources: caps.sources.map((s) => (typeof s === "string" ? s : { tool: s.tool, inner: [...s.inner] })),
    readers: readersToJSON(caps.readers),
  };
}

export function readersToJSON(readers) {
  return readers === PUBLIC ? "Public" : [...readers].sort();
}

export function capabilitiesFromJSON(json) {
  if (!json || !Array.isArray(json.sources)) {
    throw new TypeError("labels must have a `sources` array");
  }
  const sources = json.sources.map((s) => {
    if (typeof s === "string") {
      if (!TRUSTED_SOURCES.has(s)) throw new TypeError(`unknown source: ${s}`);
      return s;
    }
    if (s && typeof s.tool === "string" && Array.isArray(s.inner)) return toolSource(s.tool, s.inner);
    throw new TypeError(`invalid source: ${JSON.stringify(s)}`);
  });
  let readers;
  if (json.readers === "Public") readers = PUBLIC;
  else if (Array.isArray(json.readers)) readers = json.readers;
  else throw new TypeError(`invalid readers: ${JSON.stringify(json.readers)}`);
  return new Capabilities(sources, readers);
}
