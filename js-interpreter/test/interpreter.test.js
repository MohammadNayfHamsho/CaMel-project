import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EvalMode,
  Interpreter,
  PlanRangeError,
  PlanReferenceError,
  PlanSyntaxError,
  PlanThrownError,
  PlanTypeError,
  UnsupportedSyntaxError,
  toPlain,
} from "../src/index.js";
import { mockHost } from "./helpers.js";

const interpreter = (tools = {}, options = {}) => new Interpreter({ toolHost: mockHost(tools, options) });

async function evalPlain(code) {
  const result = await interpreter().run(code);
  if (!result.ok) throw result.error;
  return toPlain(result.value);
}

test("expressions follow JavaScript semantics", async () => {
  assert.equal(await evalPlain("1 + 2 * 3"), 7);
  assert.equal(await evalPlain("'a' + 1"), "a1");
  assert.equal(await evalPlain("`x=${[1, 2]}`"), "x=1,2");
  assert.equal(await evalPlain("'b' > 'a' && 2 >= 2"), true);
  assert.equal(await evalPlain("null ?? 'fallback'"), "fallback");
  assert.equal(await evalPlain("0 || 'or'"), "or");
  assert.equal(await evalPlain("!'' ? 'empty' : 'full'"), "empty");
  assert.equal(await evalPlain("typeof [1]"), "object");
  assert.equal(await evalPlain("[1, 2, 3].length"), 3);
  assert.equal(await evalPlain("'a,b'.split(',')[1]"), "b");
  assert.deepEqual(await evalPlain("[...[1, 2], 3].slice(1)"), [2, 3]);
  assert.deepEqual(await evalPlain("({ ...{ a: 1 }, b: 2 })"), { a: 1, b: 2 });
  assert.equal(await evalPlain("Math.max(1, 5, 3)"), 5);
  assert.deepEqual(await evalPlain("Object.keys({ a: 1, b: 2 })"), ["a", "b"]);
  assert.equal(await evalPlain("[1, 2].includes(2)"), true);
  assert.equal(await evalPlain("JSON.stringify({ a: [1] })"), '{"a":[1]}');
});

test("variables, blocks, if/else and for...of", async () => {
  const code = `
    const items = [3, 1, 4];
    let total = 0;
    let biggest = items[0];
    for (const item of items) {
      total += item;
      if (item > biggest) { biggest = item; }
    }
    [total, biggest]
  `;
  assert.deepEqual(await evalPlain(code), [8, 4]);
});

test("console.log output is collected", async () => {
  const result = await interpreter().run("console.log('hi', 1, [2, 3]); console.log({})");
  assert.deepEqual(result.output, ["hi 1 2,3", "[object Object]"]);
});

test("unsupported syntax is rejected with a hint, never run", async () => {
  const cases = {
    "while (true) {}": /for\.\.\.of/,
    "for (let i = 0; i < 3; i++) {}": /for\.\.\.of/,
    "[1].map(x => x)": /functions/,
    "function f() {}": /functions/,
    "try { 1 } catch (e) {}": /try\/catch/,
    "const o = { a: 1 }; o.a = 2": /Modifying objects/,
    "1 == 1": /Use ===/,
    "var x = 1": /const or let/,
    "const { a } = { a: 1 }": /Destructuring/,
    "/abc/.test('abc')": /Regular expressions/,
    "new Date()": /throw new Error/,
    "const a = [1]; a?.length": /Optional chaining/,
  };
  for (const [code, message] of Object.entries(cases)) {
    const result = await interpreter().run(code);
    assert.ok(!result.ok, code);
    assert.ok(result.error instanceof UnsupportedSyntaxError, `${code}: ${result.error.name}`);
    assert.match(result.error.message, message, code);
  }
});

test("only listed names exist: no escape to Node.js", async () => {
  for (const code of ["require('fs')", "process.env", "globalThis", "eval('1')", "Function('return 1')"]) {
    const result = await interpreter().run(code);
    assert.ok(result.error instanceof PlanReferenceError, code);
  }
  for (const code of ["[1].push(2)", "'a'.constructor", "Math.random()", "[2, 1].sort()"]) {
    const result = await interpreter().run(code);
    assert.ok(result.error instanceof PlanTypeError, code);
  }
});

test("built-ins and tools cannot be redefined; const cannot be reassigned", async () => {
  assert.match((await interpreter({ send_email: () => null }).run("const send_email = 1")).error.message, /built-in/);
  assert.match((await interpreter().run("console = 1")).error.message, /built-in/);
  assert.match((await interpreter().run("const x = 1; x = 2")).error.message, /constant/);
});

test("restricted coercions raise clear type errors", async () => {
  assert.ok((await interpreter().run("[1] < [2]")).error instanceof PlanTypeError);
  assert.ok((await interpreter().run("1 - 'a'")).error instanceof PlanTypeError);
  assert.ok((await interpreter().run("null + 1")).error instanceof PlanTypeError);
});

test("errors carry the plan location", async () => {
  const result = await interpreter().run("const a = [1];\nconst b = a[5];");
  assert.ok(result.error instanceof PlanRangeError);
  assert.deepEqual(result.error.loc, { line: 2, column: 10 });

  const syntax = await interpreter().run("const = 1");
  assert.ok(syntax.error instanceof PlanSyntaxError);
  assert.equal(syntax.error.loc.line, 1);
});

test("throw new Error stops the plan with the message", async () => {
  const result = await interpreter().run("throw new ValueError('no results found')");
  assert.ok(result.error instanceof PlanThrownError);
  assert.match(result.error.message, /no results found/);
});

test("variables survive a failed attempt, and a retry may redeclare them", async () => {
  const interp = interpreter();
  const first = await interp.run("const a = 1;\nconst b = undefinedVariable;");
  assert.ok(!first.ok);
  const retry = await interp.run("const b = a + 1;\nconst a = 10;\n[a, b]");
  assert.ok(retry.ok, retry.error?.message);
  assert.deepEqual(toPlain(retry.value), [10, 2]);
});

test("STRICT mode is accepted", async () => {
  const interp = new Interpreter({ toolHost: mockHost({}), mode: EvalMode.Strict });
  assert.ok((await interp.run("let x = 1; if (x > 0) { x = 2 } x")).ok);
});
