// The CaMeL interpreter for JavaScript plans.
//
// Mirrors camel_eval in src/camel/interpreter/interpreter.py: the plan is parsed
// into a syntax tree and evaluated node by node. Nothing is executed by the JS
// engine directly. Every value is a Labeled; every operation unwraps, computes
// on raw values, and wraps the result with its inputs as dependencies.
//
// Rules:
//   - Unknown syntax is rejected (fail safe), never run unlabeled.
//   - Literals are labeled User/Public: the P-LLM only saw the user's prompt.
//   - While an `if`, `for...of`, `&&`/`||`/`??` or `?:` branch runs, its condition is a
//     control-flow dependency of every tool call made inside it.
//   - Tool calls go through the tool host, which checks the policy, runs the tool
//     and labels the output. The output then depends on the call's arguments.

import * as acorn from "acorn";

import { Capabilities, PUBLIC, capabilitiesFromJSON, toolSource } from "./capabilities.js";
import {
  Kind,
  array,
  assertLabeled,
  callable,
  derive,
  fromLabeledJSON,
  literal,
  object,
  primitive,
  shellOf,
  toDisplayString,
  toPlain,
} from "./labeled.js";
import { flattenLabels, toFlattenedJSON } from "./dependencies.js";
import { createGlobals, getBuiltinMethod, getBuiltinProperty, isTruthy, strictEquals, typeOf } from "./builtins.js";
import { BindingKind, Scope } from "./scope.js";
import {
  PlanError,
  PlanRangeError,
  PlanSyntaxError,
  PlanThrownError,
  PlanTypeError,
  PolicyDeniedError,
  ToolError,
  UnsupportedSyntaxError,
} from "./errors.js";
import { validateResponse } from "./toolHost.js";

/** Mirrors MetadataEvalMode: STRICT propagates control-flow dependencies into assigned values. */
export const EvalMode = Object.freeze({ Normal: "NORMAL", Strict: "STRICT" });

const PARSE_OPTIONS = Object.freeze({ ecmaVersion: 2022, sourceType: "script", locations: true });

/** Helpful messages for syntax outside the supported subset (shown to the P-LLM). */
const UNSUPPORTED_HINTS = Object.freeze({
  WhileStatement: "while loops are not supported. Use for...of over an array instead.",
  DoWhileStatement: "do...while loops are not supported. Use for...of over an array instead.",
  ForStatement: "Classic for loops are not supported. Use for...of over an array instead.",
  ForInStatement: "for...in is not supported. Use for...of with Object.keys(obj) instead.",
  BreakStatement: "break is not supported.",
  ContinueStatement: "continue is not supported.",
  ReturnStatement: "return is not supported.",
  TryStatement: "try/catch is not supported. Do not catch errors; they are handled for you.",
  SwitchStatement: "switch is not supported. Use if/else instead.",
  LabeledStatement: "Labels are not supported.",
  FunctionDeclaration: "Defining functions is not supported. Use for...of loops instead.",
  FunctionExpression: "Defining functions is not supported. Use for...of loops instead.",
  ArrowFunctionExpression: "Defining functions (including arrow functions) is not supported. Use for...of loops instead.",
  ClassDeclaration: "Defining classes is not supported.",
  ClassExpression: "Defining classes is not supported.",
  UpdateExpression: "++ and -- are not supported. Use x = x + 1 instead.",
  ChainExpression: "Optional chaining (?.) is not supported.",
  AwaitExpression: "await is not needed: tool calls return their result directly.",
  ImportDeclaration: "You cannot import modules. Use the functions described in the instructions.",
  ImportExpression: "You cannot import modules. Use the functions described in the instructions.",
  ThisExpression: "`this` is not supported.",
  SequenceExpression: "The comma operator is not supported.",
  TaggedTemplateExpression: "Tagged templates are not supported.",
  NewExpression: "`new` is only supported as `throw new Error(message)`.",
});

const ERROR_CONSTRUCTORS = new Set(["Error", "TypeError", "ValueError", "RangeError"]);

export class Interpreter {
  /**
   * @param {object} options
   * @param {import("./toolHost.js").ToolHost} options.toolHost
   * @param {string} [options.mode]          EvalMode.Normal or EvalMode.Strict
   * @param {string} [options.qllmToolName]  the quarantined-LLM tool (special in STRICT mode)
   */
  constructor({ toolHost, mode = EvalMode.Normal, qllmToolName = "query_ai_assistant" }) {
    if (!toolHost) throw new Error("an Interpreter needs a toolHost");
    this.host = toolHost;
    this.mode = mode;
    this.qllmToolName = qllmToolName;

    this.output = [];
    this.toolCalls = [];
    // STRICT mode: arguments of quarantined-LLM calls become dependencies of every later
    // tool call (interpreter.py:2067-2068). Kept across runs, like Python's `dependencies`.
    this.persistentDeps = [];

    this.root = new Scope();
    const globals = createGlobals((line) => this.output.push(line));
    for (const [name, value] of Object.entries(globals)) {
      this.root.declare(name, BindingKind.Builtin, value);
    }
    for (const name of toolHost.toolNames()) {
      this.root.declare(name, BindingKind.Builtin, callable({ name, isTool: true }));
    }
    // Each run gets a child of the previous run's scope: variables from earlier attempts
    // stay readable (privileged_llm.py:130-132), and a retry may redeclare them.
    this.lastRunScope = this.root;
  }

  /**
   * Runs one plan (one P-LLM attempt).
   * @returns {Promise<{ok: true, value, output: string[], toolCalls: object[]}
   *                 | {ok: false, error: PlanError, output: string[], toolCalls: object[]}>}
   */
  async run(code) {
    this.output = [];
    this.toolCalls = [];
    const scope = new Scope(this.lastRunScope);
    this.lastRunScope = scope;

    const finish = (fields) => ({ ...fields, output: [...this.output], toolCalls: [...this.toolCalls] });
    try {
      const program = parse(code);
      const value = await this.execStatements(program.body, { scope, controlDeps: [] });
      return finish({ ok: true, value });
    } catch (error) {
      if (error instanceof PlanError) return finish({ ok: false, error });
      throw error; // a bug in the interpreter, never hidden as a plan error
    }
  }

  /** Variables visible to the next run (for inspection and tests). */
  variable(name) {
    return this.lastRunScope.lookup(name);
  }

  // ------------------------------------------------------------------ statements

  async execStatements(statements, ctx) {
    let last = literal(undefined);
    for (const statement of statements) {
      last = assertLabeled(await this.execStatement(statement, ctx), statement.type);
    }
    return last;
  }

  async execStatement(node, ctx) {
    switch (node.type) {
      case "ExpressionStatement":
        return this.evaluate(node.expression, ctx);
      case "VariableDeclaration":
        return this.execVariableDeclaration(node, ctx);
      case "IfStatement":
        return this.execIf(node, ctx);
      case "ForOfStatement":
        return this.execForOf(node, ctx);
      case "BlockStatement":
        return this.execStatements(node.body, { ...ctx, scope: ctx.scope.child() });
      case "ThrowStatement":
        return this.execThrow(node, ctx);
      case "EmptyStatement":
        return literal(undefined);
      default:
        throw unsupported(node);
    }
  }

  async execVariableDeclaration(node, ctx) {
    if (node.kind !== "const" && node.kind !== "let") {
      throw new UnsupportedSyntaxError("`var` is not supported. Use const or let.", { node });
    }
    for (const declarator of node.declarations) {
      if (declarator.id.type !== "Identifier") {
        throw new UnsupportedSyntaxError("Destructuring is not supported. Declare one variable at a time.", {
          node: declarator,
        });
      }
      if (!declarator.init && node.kind === "const") {
        throw new PlanSyntaxError("Missing initializer in const declaration", { node: declarator });
      }
      const value = declarator.init ? await this.evaluate(declarator.init, ctx) : literal(undefined);
      ctx.scope.declare(declarator.id.name, node.kind, this.bindValue(value, ctx), declarator);
    }
    return literal(undefined);
  }

  /** Mirrors _eval_if (interpreter.py:1667): the condition is a dependency while a branch runs. */
  async execIf(node, ctx) {
    const test = await this.evaluate(node.test, ctx);
    const branch = isTruthy(test) ? node.consequent : node.alternate;
    if (branch) {
      await this.execStatement(branch, withControl(ctx, test, ctx.scope.child()));
    }
    return literal(undefined);
  }

  /** Mirrors _eval_for (interpreter.py:1753): the iterated container is a dependency of the body. */
  async execForOf(node, ctx) {
    if (node.await) throw unsupported(node, "for await is not supported.");
    const { left } = node;
    if (left.type !== "VariableDeclaration" || left.declarations.length !== 1 || left.declarations[0].id.type !== "Identifier") {
      throw new UnsupportedSyntaxError("Use `for (const item of items)` with a single variable.", { node: left });
    }
    if (left.kind !== "const" && left.kind !== "let") {
      throw new UnsupportedSyntaxError("`var` is not supported. Use const or let.", { node: left });
    }
    const iterable = await this.evaluate(node.right, ctx);
    if (iterable.kind !== Kind.Array) {
      throw new PlanTypeError(`for...of expects an array, got ${typeOf(iterable)}`, { node: node.right, deps: [iterable] });
    }
    // How many times the body runs reveals the array's length: a property of the container.
    const loopCtx = withControl(ctx, shellOf(iterable), ctx.scope);
    const name = left.declarations[0].id.name;
    for (const element of iterable.raw) {
      const iterationScope = loopCtx.scope.child();
      iterationScope.declare(name, left.kind, this.bindValue(element.withDeps(shellOf(iterable)), loopCtx), left);
      await this.execStatement(node.body, { ...loopCtx, scope: iterationScope });
    }
    return literal(undefined);
  }

  async execThrow(node, ctx) {
    const { argument } = node;
    if (
      argument.type !== "NewExpression" ||
      argument.callee.type !== "Identifier" ||
      !ERROR_CONSTRUCTORS.has(argument.callee.name) ||
      argument.arguments.length > 1
    ) {
      throw new UnsupportedSyntaxError("Only `throw new Error(message)` is supported.", { node });
    }
    const message = argument.arguments.length ? await this.evaluate(argument.arguments[0], ctx) : literal("");
    // That the plan reached this throw reveals the active conditions.
    throw new PlanThrownError(`${argument.callee.name}: ${toDisplayString(message)}`, {
      node,
      deps: [message, ...ctx.controlDeps],
    });
  }

  // ------------------------------------------------------------------ expressions

  async evaluate(node, ctx) {
    const value = await this.evaluateNode(node, ctx);
    return assertLabeled(value, node.type);
  }

  async evaluateNode(node, ctx) {
    switch (node.type) {
      case "Literal":
        return this.evalLiteral(node);
      case "Identifier":
        return node.name === "undefined" ? literal(undefined) : ctx.scope.lookup(node.name, node);
      case "TemplateLiteral":
        return this.evalTemplate(node, ctx);
      case "ArrayExpression":
        return this.evalArray(node, ctx);
      case "ObjectExpression":
        return this.evalObject(node, ctx);
      case "MemberExpression":
        return this.evalMember(node, ctx);
      case "CallExpression":
        return this.evalCall(node, ctx);
      case "BinaryExpression":
        return this.evalBinary(node, ctx);
      case "LogicalExpression":
        return this.evalLogical(node, ctx);
      case "ConditionalExpression":
        return this.evalConditional(node, ctx);
      case "UnaryExpression":
        return this.evalUnary(node, ctx);
      case "AssignmentExpression":
        return this.evalAssignment(node, ctx);
      default:
        throw unsupported(node);
    }
  }

  evalLiteral(node) {
    if (node.regex) throw unsupported(node, "Regular expressions are not supported. Use query_ai_assistant to extract data.");
    if (typeof node.value === "bigint") throw unsupported(node, "BigInt literals are not supported.");
    return literal(node.value);
  }

  /** Mirrors _eval_joined_str: the text depends on every inserted value and the literal parts. */
  async evalTemplate(node, ctx) {
    const inputs = [];
    let text = "";
    for (let i = 0; i < node.quasis.length; i++) {
      const quasi = node.quasis[i].value.cooked;
      text += quasi;
      if (quasi) inputs.push(literal(quasi));
      if (i < node.expressions.length) {
        const value = await this.evaluate(node.expressions[i], ctx);
        text += toDisplayString(value);
        inputs.push(value);
      }
    }
    return derive(text, ...inputs);
  }

  async evalArray(node, ctx) {
    const elements = [];
    const deps = [];
    for (const element of node.elements) {
      if (element === null) throw unsupported(node, "Array holes are not supported.");
      if (element.type === "SpreadElement") {
        const source = await this.evaluate(element.argument, ctx);
        if (source.kind !== Kind.Array) {
          throw new PlanTypeError(`cannot spread ${typeOf(source)} into an array`, { node: element, deps: [source] });
        }
        elements.push(...source.raw.map((e) => e.withDeps(shellOf(source))));
        deps.push(shellOf(source));
      } else {
        elements.push(await this.evaluate(element, ctx));
      }
    }
    // Like _eval_list (interpreter.py:512-514): the literal container itself comes from the plan.
    return array(elements, Capabilities.user(), deps);
  }

  async evalObject(node, ctx) {
    const entries = new Map();
    const deps = [];
    for (const prop of node.properties) {
      if (prop.type === "SpreadElement") {
        const source = await this.evaluate(prop.argument, ctx);
        if (source.kind !== Kind.Object) {
          throw new PlanTypeError(`cannot spread ${typeOf(source)} into an object`, { node: prop, deps: [source] });
        }
        for (const [key, v] of source.raw) entries.set(key, v.withDeps(shellOf(source)));
        deps.push(shellOf(source));
        continue;
      }
      if (prop.kind !== "init" || prop.method) throw unsupported(prop, "Getters, setters and methods are not supported in objects.");
      entries.set(propertyKey(prop), await this.evaluate(prop.value, ctx));
    }
    return object(entries, Capabilities.user(), deps);
  }

  async evalMember(node, ctx) {
    if (node.optional) throw unsupported(node, UNSUPPORTED_HINTS.ChainExpression);
    const target = await this.evaluate(node.object, ctx);

    if (!node.computed) return this.readProperty(target, node.property.name, null, node);

    const key = await this.evaluate(node.property, ctx);
    if (target.kind === Kind.Array) return this.readIndex(target, key, node);
    if (target.kind === Kind.String) return this.readCharacter(target, key, node);
    if (key.kind !== Kind.String) {
      throw new PlanTypeError(`property keys must be strings, got ${typeOf(key)}`, { node: node.property, deps: [key] });
    }
    return this.readProperty(target, key.raw, key, node);
  }

  /** `obj.name` / `obj["name"]`, `str.length`, `arr.includes`, `Math.max`, ... */
  readProperty(target, name, keyValue, node) {
    const keyDeps = keyValue ? [keyValue] : [];
    switch (target.kind) {
      case Kind.Namespace: {
        const member = Object.hasOwn(target.raw.members, name) ? target.raw.members[name] : null;
        if (!member) throw new PlanTypeError(`${target.raw.name}.${name} is not available`, { node });
        return member;
      }
      case Kind.Object: {
        if (!target.raw.has(name)) {
          throw new PlanTypeError(`property '${name}' does not exist on this object`, { node, deps: [shellOf(target)] });
        }
        // Reading one property: its own label, plus the object's shell (value.py:359-363).
        return target.raw.get(name).withDeps(shellOf(target), ...keyDeps);
      }
      case Kind.String:
      case Kind.Array: {
        const property = getBuiltinProperty(target, name);
        if (property) return property.withDeps(...keyDeps);
        const method = getBuiltinMethod(target, name);
        if (method) return method;
        throw new PlanTypeError(`${typeOf(target)}.${name} is not available`, { node });
      }
      default:
        throw new PlanTypeError(`cannot read property '${name}' of ${typeOf(target)}`, { node, deps: [target] });
    }
  }

  /** `arr[i]`: mirrors CaMeLSequence.index (value.py:300-301). */
  readIndex(target, index, node) {
    if (index.kind !== Kind.Number || !Number.isInteger(index.raw)) {
      throw new PlanTypeError(`array indices must be integers, got ${typeOf(index)}`, { node: node.property, deps: [index] });
    }
    if (index.raw < 0 || index.raw >= target.raw.length) {
      throw new PlanRangeError(`index ${index.raw} is out of range (length ${target.raw.length})`, {
        node,
        deps: [index, shellOf(target)],
      });
    }
    return target.raw[index.raw].withDeps(shellOf(target), index);
  }

  readCharacter(target, index, node) {
    if (index.kind !== Kind.Number || !Number.isInteger(index.raw)) {
      throw new PlanTypeError(`string indices must be integers, got ${typeOf(index)}`, { node: node.property, deps: [index] });
    }
    if (index.raw < 0 || index.raw >= target.raw.length) {
      throw new PlanRangeError(`index ${index.raw} is out of range (length ${target.raw.length})`, {
        node,
        deps: [index, target],
      });
    }
    return derive(target.raw[index.raw], target, index);
  }

  async evalCall(node, ctx) {
    if (node.optional) throw unsupported(node, UNSUPPORTED_HINTS.ChainExpression);
    // Report callbacks (`list.map(x => ...)`) as unsupported functions before anything else:
    // that hint helps the P-LLM more than "map is not available".
    const callback = node.arguments.find((a) => a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression");
    if (callback) throw unsupported(callback);
    const callee = await this.evaluate(node.callee, ctx);
    const args = [];
    for (const arg of node.arguments) {
      if (arg.type === "SpreadElement") throw unsupported(arg, "Spreading arguments into a call is not supported.");
      args.push(await this.evaluate(arg, ctx));
    }
    if (callee.kind !== Kind.Function) {
      throw new PlanTypeError(`${calleeName(node.callee)} is not a function`, { node, deps: [callee] });
    }
    if (callee.raw.isTool) return this.callTool(callee, args, node, ctx);
    return callee.raw.impl({ receiver: callee.raw.receiver, args, node });
  }

  /** A tool call through the host: policy check, execution and labeling happen there. */
  async callTool(callee, args, node, ctx) {
    const name = callee.raw.name;
    const request = {
      name,
      args: args.map(toFlattenedJSON),
      controlLabels: flattenLabels(...ctx.controlDeps, ...this.persistentDeps),
    };
    const response = validateResponse(await this.host.callTool(request), name);
    // The output depends on the call itself and its arguments (value.py:212-222).
    // Active conditions reach the policy through `controlLabels`; STRICT mode also
    // attaches them when the output is assigned (bindValue).
    const callDeps = [callee, ...args];

    if (response.status === "denied") {
      throw new PolicyDeniedError(`Execution of tool '${name}' denied: ${response.reason}`, {
        node,
        toolName: name,
        deps: callDeps,
      });
    }
    if (response.status === "error") {
      // Like interpreter.py:2111-2120: the error text comes from the tool, so it carries the tool's label.
      const caps = response.labels ? capabilitiesFromJSON(response.labels) : new Capabilities([toolSource(name)], PUBLIC);
      throw new ToolError(`${name}: ${response.message}`, {
        node,
        toolName: name,
        deps: [...callDeps, primitive(response.message, caps)],
      });
    }

    const output = fromLabeledJSON(response.value, callDeps);
    if (this.mode === EvalMode.Strict && name === this.qllmToolName) {
      this.persistentDeps.push(...args);
    }
    this.toolCalls.push({ name, args: args.map(toPlain), output: toPlain(output) });
    return output;
  }

  async evalBinary(node, ctx) {
    const left = await this.evaluate(node.left, ctx);
    const right = await this.evaluate(node.right, ctx);
    return binaryOperation(node.operator, left, right, node);
  }

  /** `&&`, `||`, `??`: the right side only runs because of the left side, so the left is a control dependency. */
  async evalLogical(node, ctx) {
    const left = await this.evaluate(node.left, ctx);
    let takeLeft;
    switch (node.operator) {
      case "&&":
        takeLeft = !isTruthy(left);
        break;
      case "||":
        takeLeft = isTruthy(left);
        break;
      case "??":
        takeLeft = left.kind !== Kind.Null && left.kind !== Kind.Undefined;
        break;
      default:
        throw unsupported(node, `Operator ${node.operator} is not supported.`);
    }
    if (takeLeft) return left;
    const right = await this.evaluate(node.right, withControl(ctx, left, ctx.scope));
    return right.withDeps(left);
  }

  async evalConditional(node, ctx) {
    const test = await this.evaluate(node.test, ctx);
    const branch = isTruthy(test) ? node.consequent : node.alternate;
    const value = await this.evaluate(branch, withControl(ctx, test, ctx.scope));
    return value.withDeps(test);
  }

  async evalUnary(node, ctx) {
    const operand = await this.evaluate(node.argument, ctx);
    switch (node.operator) {
      case "!":
        return derive(!isTruthy(operand), operand);
      case "-":
      case "+": {
        if (operand.kind !== Kind.Number) {
          throw new PlanTypeError(`unary ${node.operator} expects a number, got ${typeOf(operand)}`, { node, deps: [operand] });
        }
        return derive(node.operator === "-" ? -operand.raw : operand.raw, operand);
      }
      case "typeof":
        return derive(typeOf(operand), operand.isContainer ? shellOf(operand) : operand);
      default:
        throw unsupported(node, `Operator ${node.operator} is not supported.`);
    }
  }

  /** Only `x = value` and compound forms on `let` variables: objects and arrays are immutable. */
  async evalAssignment(node, ctx) {
    if (node.left.type !== "Identifier") {
      throw new UnsupportedSyntaxError(
        "Modifying objects or arrays is not supported. Build a new one instead, e.g. [...list, item] or {...obj, key: value}.",
        { node: node.left },
      );
    }
    let value = await this.evaluate(node.right, ctx);
    if (node.operator !== "=") {
      const operator = node.operator.slice(0, -1);
      if (!COMPOUND_OPERATORS.has(operator)) throw unsupported(node, `Operator ${node.operator} is not supported.`);
      const current = ctx.scope.lookup(node.left.name, node.left);
      value = binaryOperation(operator, current, value, node);
    }
    const bound = this.bindValue(value, ctx);
    ctx.scope.assign(node.left.name, bound, node.left);
    return bound;
  }

  /** STRICT mode attaches the active control-flow dependencies to stored values (interpreter.py:648-650). */
  bindValue(value, ctx) {
    if (this.mode !== EvalMode.Strict) return value;
    return value.withDeps(...ctx.controlDeps, ...this.persistentDeps);
  }
}

// -------------------------------------------------------------------- helpers

const COMPOUND_OPERATORS = new Set(["+", "-", "*", "/", "%"]);
const NUMBER_OPERATORS = {
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
  "**": (a, b) => a ** b,
};
const COMPARISON_OPERATORS = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

/** Binary operators on raw values. JS's implicit coercions are restricted to avoid surprises. */
function binaryOperation(operator, left, right, node) {
  const fail = (message) => new PlanTypeError(message, { node, deps: [left, right] });

  if (operator === "+") {
    if (left.kind === Kind.Number && right.kind === Kind.Number) return derive(left.raw + right.raw, left, right);
    if (left.kind === Kind.String || right.kind === Kind.String) {
      return derive(toDisplayString(left) + toDisplayString(right), left, right);
    }
    throw fail(`cannot add ${typeOf(left)} and ${typeOf(right)}`);
  }
  if (Object.hasOwn(NUMBER_OPERATORS, operator)) {
    if (left.kind !== Kind.Number || right.kind !== Kind.Number) {
      throw fail(`operator ${operator} expects numbers, got ${typeOf(left)} and ${typeOf(right)}`);
    }
    return derive(NUMBER_OPERATORS[operator](left.raw, right.raw), left, right);
  }
  if (operator === "===" || operator === "!==") {
    const equal = strictEquals(left, right);
    return derive(operator === "===" ? equal : !equal, left, right);
  }
  if (Object.hasOwn(COMPARISON_OPERATORS, operator)) {
    const comparable =
      (left.kind === Kind.Number && right.kind === Kind.Number) || (left.kind === Kind.String && right.kind === Kind.String);
    if (!comparable) throw fail(`cannot compare ${typeOf(left)} with ${typeOf(right)} using ${operator}`);
    // Like cmp (interpreter.py:1537-1555): the result depends on both sides.
    return derive(COMPARISON_OPERATORS[operator](left.raw, right.raw), left, right);
  }
  if (operator === "==" || operator === "!=") {
    throw new UnsupportedSyntaxError(`Operator ${operator} is not supported. Use ${operator}= instead.`, { node });
  }
  throw new UnsupportedSyntaxError(`Operator ${operator} is not supported.`, { node });
}

/** A context whose branch depends on `condition`. */
function withControl(ctx, condition, scope) {
  return { scope, controlDeps: [...ctx.controlDeps, condition] };
}

function propertyKey(prop) {
  if (!prop.computed && prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && (typeof prop.key.value === "string" || typeof prop.key.value === "number")) {
    return String(prop.key.value);
  }
  throw unsupported(prop, "Computed object keys are not supported.");
}

function calleeName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) return `${calleeName(node.object)}.${node.property.name}`;
  return "expression";
}

function unsupported(node, message = UNSUPPORTED_HINTS[node.type] ?? `${node.type} is not supported.`) {
  return new UnsupportedSyntaxError(message, { node });
}

/** Parses a plan, turning acorn's errors into PlanSyntaxErrors with a location. */
export function parse(code) {
  try {
    return acorn.parse(code, PARSE_OPTIONS);
  } catch (error) {
    if (!(error instanceof SyntaxError) || !error.loc) throw error;
    const position = { line: error.loc.line, column: error.loc.column };
    throw new PlanSyntaxError(error.message, { node: { loc: { start: position, end: position } } });
  }
}
