# CaMeL JS interpreter

Runs JavaScript plans written by the P-LLM step by step, tracking capabilities
(sources and readers) and dependencies for every value, and asking a tool host
before every tool call. It is the JavaScript counterpart of
[`src/camel/interpreter/interpreter.py`](../src/camel/interpreter/interpreter.py).

Nothing in a plan is executed by the JS engine directly. The plan is parsed with
[acorn](https://github.com/acornjs/acorn) and evaluated node by node.

```sh
npm install
npm test
```

## Structure

| File | Role | Python counterpart |
|---|---|---|
| `src/capabilities.js` | sources, readers, trust rules, JSON format | `capabilities/` |
| `src/labeled.js` | the `Labeled` wrapper, `derive()`, `shellOf()`, JSON conversion | `value.py` |
| `src/dependencies.js` | dependency walk: effective labels, `isTrusted`, `canRead`, flattened tool arguments | `capabilities/utils.py` |
| `src/builtins.js` | allowed built-in functions, methods and namespaces | `library.py` |
| `src/scope.js` | `const`/`let` block scopes; protected built-ins and tools | `namespace.py` |
| `src/interpreter.js` | parsing and evaluation of the supported subset; tool calls | `interpreter.py` |
| `src/toolHost.js` | the contract with the tool host (Python side) | — |
| `src/errors.js` | plan errors with location and dependencies | `CaMeLException` |

## Rules

1. **Unknown means rejected.** Syntax, functions and methods outside the subset
   raise an error with a hint for the P-LLM. Nothing runs unlabeled.
2. **Literals are `User`/`Public`.** The P-LLM only saw the user's prompt.
3. **Every new value comes from `derive(raw, ...inputs)`.** The inputs become its
   dependencies, so they cannot be forgotten.
4. **Wrappers never meet native operators.** The interpreter computes on `.raw`.
   `Labeled` throws on `toString`, `valueOf`, `Symbol.toPrimitive` and `toJSON`,
   so a mistake fails loudly instead of silently losing labels.
5. **Reading one element depends on the container's shell** (its own label and
   dependencies), not on sibling elements. Using a whole container (template
   literal, `join`, a tool argument) depends on all of its content.
6. **Control flow.** While an `if`, `for...of`, `&&`/`||`/`??` or `?:` branch runs,
   its condition is a control-flow dependency of every tool call inside it. In
   STRICT mode it is also attached to assigned values, and the inputs of
   `query_ai_assistant` become dependencies of all later tool calls.
7. **Tools run on the host.** The interpreter sends each argument as a tree whose
   nodes carry complete labels (so `recipients` and `body` stay separate), plus the
   control-flow labels. The host checks the policy, runs the tool, labels the
   output. The interpreter then adds the call's arguments as dependencies of the output.
8. **Objects and arrays are immutable.** Build new ones with `[...list, x]` or
   `{...obj, key: value}`, as CaMeL forbids side effects.

## Supported subset

- `const`/`let` (one identifier per declarator), `if`/`else`, blocks, `for (const x of array)`,
  `throw new Error(message)`
- literals (string, number, boolean, `null`, `undefined`), template literals,
  array and object literals with spread
- `+ - * / % **`, `=== !== < <= > >=`, `&& || ??`, `?:`, `! - + typeof`,
  `=` and `+= -= *= /= %=` on `let` variables
- `obj.key`, `obj["key"]`, `arr[i]`, `str[i]`, tool calls, built-in calls
- built-ins: `console.log`, `String`, `Number`, `Boolean`, `Math.{max,min,abs,round,floor,ceil}`,
  `Object.{keys,values,entries}`, `JSON.stringify`, `Array.isArray`;
  string `length, includes, startsWith, endsWith, indexOf, slice, split, trim, toLowerCase,
  toUpperCase, replaceAll`; array `length, includes, indexOf, slice, concat, join`

Not supported (rejected with a hint): functions and arrow functions, classes, `while`,
classic `for`, `for...in`, `break`/`continue`/`return`, `try`, `switch`, destructuring,
optional chaining, regular expressions, `==`/`!=`, modifying objects or arrays, `var`, imports.

## Deliberate differences from the Python interpreter

- **String labels are per string, not per character.** A string built from parts
  depends on all parts. This is simpler and only ever stricter (a substring keeps all labels).
- **Whole containers count their elements' own labels** in the dependency walk.
  Python's walk (`CaMeLIterable.get_dependencies`, value.py:262-271) follows the
  elements' dependencies but not their own labels. Counting them is stricter; whether
  this changes any AgentDojo result should be checked with same-result tests.
- **Implicit coercions are restricted**: `<` only compares two numbers or two strings,
  arithmetic only on numbers, `+` only for numbers or with a string.
- **Missing properties and out-of-range indices raise errors** instead of returning
  `undefined`, which gives the P-LLM clearer feedback.

## Status

Done: the interpreter core, labels, dependency tracking (including control flow and
STRICT mode), built-ins, the tool-host contract, and tests (`test/`), including the
lecture/contacts scenario against a mock host whose `send_email` policy mirrors
`workspace.py`.

Not done yet:
- the bridge process and the Python host (label JSON converter, policy rebuild,
  calling `AgentDojoFunction.call`)
- the JS system prompt and `query_ai_assistant` with JSON schemas
- connecting `privileged_llm.py` and `replay_privileged_llm.py`
- error redaction for the P-LLM (the data is ready: `error.deps`)
- the Semgrep pre-check
- same-result tests against the Python interpreter
