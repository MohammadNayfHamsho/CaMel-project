import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Capabilities,
  PUBLIC,
  Source,
  canRead,
  collectCapabilities,
  derive,
  fromLabeledJSON,
  isTrusted,
  isTrustedSource,
  literal,
  toFlattenedJSON,
  toLabeledJSON,
  toolSource,
} from "../src/index.js";
import { array, object, primitive, shellOf } from "../src/labeled.js";
import { readersOf } from "./helpers.js";

const fileCaps = (readers, inner = ["smith@uni.edu"]) => new Capabilities([toolSource("read_file", inner)], readers);

test("literals come from the user and are public", () => {
  const v = literal("Physics");
  assert.deepEqual(v.caps.sources, [Source.User]);
  assert.equal(v.caps.readers, PUBLIC);
  assert.ok(isTrusted(v));
});

test("tool sources are trusted only when every writer is trusted (utils.py:63-68)", () => {
  assert.ok(isTrustedSource(toolSource("search_files", [Source.User])));
  assert.ok(!isTrustedSource(toolSource("search_files", ["smith@uni.edu"])));
  assert.ok(!isTrustedSource(toolSource("search_files", [Source.User, "smith@uni.edu"])));
  assert.ok(!isTrustedSource(toolSource("read_file", [])));
});

test("derived values: readers are intersected, sources are joined", () => {
  const a = primitive("a", fileCaps(["emma", "alex"], [Source.User]));
  const b = primitive("b", fileCaps(["emma", "mark"]));
  const text = derive(a.raw + b.raw, a, b);

  assert.deepEqual(text.caps.sources, [Source.CaMeL]); // own label looks harmless...
  const effective = collectCapabilities([text]); // ...the walk finds the truth
  assert.deepEqual(readersOf(effective), ["emma"]);
  assert.ok(!isTrusted(text));
});

test("a container's content counts when the whole container is used", () => {
  const privateItem = primitive("secret", fileCaps(["emma"]));
  const list = array([privateItem], Capabilities.user());
  assert.ok(!canRead(["attacker@evil.com"], list));
});

test("reading one element depends on the container's shell, not on its siblings", () => {
  const forAll = primitive("shared", fileCaps(["emma", "smith"]));
  const forEmma = primitive("private", fileCaps(["emma"]));
  const list = array([forAll, forEmma], new Capabilities([toolSource("list_files")], PUBLIC));

  const first = forAll.withDeps(shellOf(list), literal(0));
  assert.ok(canRead(["smith"], first));
  assert.ok(!canRead(["smith"], list));
});

test("wrappers refuse to become plain values", () => {
  const v = literal("x");
  assert.throws(() => `${v}`, /BUG/);
  assert.throws(() => v + "y", /BUG/);
  assert.throws(() => JSON.stringify(v), /BUG/);
});

test("bridge JSON keeps one label per element", () => {
  const json = {
    raw: [{ raw: "a", labels: { sources: ["User"], readers: ["emma"] } }],
    labels: { sources: [{ tool: "list_files", inner: [] }], readers: "Public" },
  };
  const value = fromLabeledJSON(json);
  assert.deepEqual(readersOf(value.raw[0].caps), ["emma"]);
  assert.deepEqual(toLabeledJSON(value), json);
});

test("malformed bridge JSON is rejected: nothing enters unlabeled", () => {
  assert.throws(() => fromLabeledJSON({ raw: "x" }), /invalid labeled value/);
  assert.throws(() => fromLabeledJSON({ raw: "x", labels: { sources: ["Hacker"], readers: "Public" } }), /unknown source/);
});

test("flattened tool arguments keep separate labels per field", () => {
  const privateBody = primitive("E = m * c^2", fileCaps(["emma", "smith"]));
  const options = object(
    [
      ["recipients", array([literal("bob@gmail.com")], Capabilities.user())],
      ["body", privateBody],
    ],
    Capabilities.user(),
  );
  const flat = toFlattenedJSON(options);
  assert.deepEqual(flat.raw.recipients.labels.readers, "Public");
  assert.deepEqual(flat.raw.recipients.labels.sources, ["User"]);
  assert.deepEqual(flat.raw.body.labels.readers, ["emma", "smith"]);
  assert.deepEqual(flat.labels.readers, ["emma", "smith"]); // the whole object includes the body
});
