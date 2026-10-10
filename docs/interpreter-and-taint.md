# Interpreter and taint tracking

## Python execution

`parse_and_interpret_code` extracts the fenced code, parses it with `ast.parse`, and dispatches through `camel_eval`. It evaluates a supported subset of Python rather than executing the whole program with `exec`. [namespace.py](../src/camel/interpreter/namespace.py) stores variables and registered objects; [library.py](../src/camel/interpreter/library.py) supplies supported builtins.

An `EvalResult` carries a result/error, namespace, call history, and execution dependencies. Unsupported syntax produces interpreter errors. Registered host functions still execute real Python when their wrapper's `call` method is reached.

## Value metadata and dependencies

[value.py](../src/camel/interpreter/value.py) wraps strings, integers, containers, objects, and callables. Each value has actual data, `Capabilities` metadata, and dependencies on other values.

```python
combined = left + right
# CaMeLStr.add creates a new value with dependencies (left, right).
```

The output's immediate source can be `CaMeL`, while its dependency graph still includes external sources. It is not sufficient to inspect only immediate metadata.

`get_all_sources` recursively unions provenance labels. `get_all_readers` recursively intersects reader permissions. Both are defined in [capabilities/utils.py](../src/camel/capabilities/utils.py). Containers, indexing, attributes, and call outputs preserve dependencies using the corresponding wrapped-value operations.

Tool outputs are first wrapped with dependencies on the callable and arguments. `_get_metadata_for_ad` then applies domain-specific metadata: email senders, file editors, sharing permissions, and other source/reader information. A QLLM result likewise remains dependent on the query, so summarization or extraction does not remove provenance.

## Dynamic versus static

Python CaMeL uses dynamic information-flow tracking: dependencies are created along the executed path at runtime. It tracks integrity/provenance and confidentiality/readers, rather than a single boolean taint bit.

Semgrep's JavaScript taint scan is static: it analyzes source code before execution, using configured source and sink patterns. It does not observe live email senders, real sharing permissions, or wrapped runtime values. The current Semgrep rule is a coarse flow detector, not an implementation of Python capabilities.

## Control dependencies and modes

An `if` branch adds its condition to active execution dependencies. A `for` loop adds its iterable. State-changing tool checks reject active non-public dependencies unless the tool has a read-only exemption.

In `NORMAL`, explicit data dependencies and active control dependencies are tracked. In `STRICT`, assignments also attach current execution dependencies to the stored value, preserving branch influence beyond the branch. A QLLM call in strict mode adds its arguments to ongoing execution dependencies, making subsequent execution more conservative.

Trust and privacy remain distinct: the general control-dependency check tests `is_public`, not `is_trusted`. A public but untrusted condition is not rejected by this check alone.

## Reading the implementation

1. [Capabilities](../src/camel/capabilities/capabilities.py): metadata fields.
2. [Sources and readers](../src/camel/capabilities/): provenance labels and reader representation.
3. [Wrapped values](../src/camel/interpreter/value.py): `new_with_dependencies`, arithmetic/string operations, containers, callable output wrapping.
4. [Metadata queries](../src/camel/capabilities/utils.py): recursive effective trust and permissions.
5. [Tool annotations](../src/camel/pipeline_elements/agentdojo_function.py): `_get_metadata_for_ad`.
6. [AST evaluator](../src/camel/interpreter/interpreter.py): `_assign_name`, `_eval_if`, `_eval_for`, `_eval_call`.

The research interpreter and domain annotations have implementation limitations. Tracking correctness depends on every relevant operation preserving dependencies and every source receiving accurate metadata.
