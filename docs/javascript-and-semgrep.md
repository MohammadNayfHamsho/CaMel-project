# Current JavaScript and Semgrep path

[privileged_llm.py](../src/camel/pipeline_elements/privileged_llm.py) imports `js_interpreter` as its interpreter. The generated prompt requests JavaScript. The current steps are:

1. Extract the fenced JavaScript.
2. Write it to a temporary `generated.js` beside the interpreter's rule file.
3. Invoke WSL Semgrep with the local [semgrep_rules.yaml](../src/camel/interpreter/semgrep_rules.yaml), requesting JSON.
4. Print the JSON to stdout before Node starts.
5. If the scan exits successfully and its output parses as JSON, run `node -e`.
6. Return Node's stdout as the result and clean up temporary scan files.

The configured WSL executable currently uses `/home/max/miniconda3/bin/semgrep`. `_wsl_path` assumes standard `/mnt/<drive>/` mounts for Windows paths.

## Findings versus scan failures

A reported source-to-sink finding does not block the generated program. The command does not enable Semgrep's finding-based error exit behavior. A nonzero scanner exit, timeout, or malformed JSON produces an interpreter error and prevents Node from executing that attempt.

The current custom rule includes external reads, QLLM calls, response parsing, and process inputs as sources. It includes email/file/transfer actions and dynamic code or command execution as sinks. These are starter syntactic patterns, not permission-aware domain policies. They do not cover every possible API alias, source, sink, or cross-function flow.

## What is not connected yet

The JavaScript runner does not use the supplied Python namespace, execute AgentDojo tool wrappers, inspect the supplied policy engine, attach capabilities to live values, or collect tool calls. Python functions registered in the runtime do not automatically exist in Node.

The prompt still contains Python builtin/type/API descriptions, despite requesting JavaScript. Replay still uses the Python interpreter. Further migration work must make tool bindings, API descriptions, replay, and enforcement consistent.

Static scanning therefore does not replace the original dynamic permission system. A later blocking decision could use Semgrep findings, but accurate per-recipient authorization also needs a representation of runtime data permissions and a checked action boundary.

## Errors and benchmark reuse

The JS error wrapper implements `metadata` and `get_dependencies` so the existing formatter can inspect trust. Node stderr is labelled as an untrusted `Tool("node")` source and its message is redacted by the planner-facing formatter. This metadata supports error handling; it is not general JavaScript runtime taint tracking.

AgentDojo can reuse logged benchmark results when `force_rerun=False`; such a run may make no model or scanner call. Inspect the current [main.py](../main.py) settings when testing changes. A direct pipeline call or forced rerun distinguishes fresh execution from reused benchmark output.
