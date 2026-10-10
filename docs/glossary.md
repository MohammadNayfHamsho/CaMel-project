# CaMeL glossary

| Term | Meaning in this project |
|---|---|
| CaMeL | Architecture separating privileged planning from processing externally supplied content, with interpreter-enforced information-flow rules in the Python implementation. |
| PLLM / privileged LLM | Model that receives the user task and available API descriptions and writes the program. |
| QLLM / quarantined LLM | Model called to extract or summarize unstructured content. It returns typed data and has no independent action-tool loop in this implementation. Its output remains dependent on its input. |
| `query_ai_assistant` | Runtime-registered function wrapping `query_quarantined_llm`. |
| Output schema | Type describing a QLLM result, such as `str`, a primitive, or a Pydantic model with named fields. |
| Tool | Registered callable exposed to generated code, such as `search_emails` or `send_money`. |
| Runtime | AgentDojo `FunctionsRuntime`, which registers functions, validates their arguments, and dispatches calls. |
| Environment | State on which tools operate, such as simulated email, files, accounts, and messages. |
| Namespace | Interpreter mapping from variable names to wrapped values, builtins, classes, and tools. |
| AST | Abstract syntax tree produced by parsing Python code; the Python interpreter evaluates its nodes. |
| Wrapped value / `CaMeLValue` | Data plus capabilities metadata and dependencies. `.raw` exposes the underlying ordinary value. |
| Capabilities | Here, a metadata record containing `sources_set`, `readers_set`, and optional `other_metadata`. It is not an OS permission or a Semgrep finding. |
| Source | Provenance label: `User`, `Assistant`, `CaMeL`, `TrustedToolSource`, or a `Tool` label. |
| Inner source | Provenance inside a tool result, such as an email sender or document editor. |
| Provenance | Origin and chain of influence of a value. |
| Dependency | Another wrapped value that influenced a value or the current execution. Dependencies form a graph. |
| Data dependency / explicit flow | Influence through an operation, such as concatenating or summarizing external data. |
| Control dependency / implicit flow | Influence through a condition or iterable controlling which action executes. |
| Reader | Principal permitted to receive a value's information. Reader sets combine by intersection across dependencies. |
| `Public()` | Special reader representation allowing anyone to read the value. An empty explicit reader set is different: it permits no named external reader. |
| Trusted | All effective source labels satisfy the implementation's trusted-source rules. This does not establish factual accuracy. |
| Untrusted | At least one effective source is outside those trusted-source rules. It is not synonymous with malicious. |
| Private / non-public | Effective readers are restricted rather than `Public()`. It is independent of trust. |
| Taint | Shorthand for influence from a relevant source. Python models it through provenance and dependencies; Semgrep models it through static source/sink rules. |
| Source-to-sink flow | Data or influence from a configured source reaches an operation considered sensitive. Whether it is prohibited depends on the applicable rule/policy. |
| Sink | Sensitive operation consuming data, such as sending a message, changing permissions, or executing a command. |
| Policy | Trusted application function returning `Allowed` or `Denied` for a tool call's wrapped arguments. |
| Policy engine | Dispatches policies and applies general execution-dependency checks. |
| `Allowed()` | Decision permitting an action to proceed through the policy gate. |
| `Denied(reason)` | Decision explaining why an action must not proceed through the Python external-tool gate. |
| `SecurityPolicyDeniedError` | Host-side exception raised before a rejected Python external tool executes. |
| Side effect | Change outside a computed value, such as sending mail or mutating environment state. |
| `no_side_effect_tools` | Application-configured exemption set that bypasses the general policy checks. Classification is a trusted application decision. |
| Sanitizer | Operation configured to remove particular taint. The current JavaScript rules define none; a QLLM is not a sanitizer. |
| Declassification | Deliberate authorization to release restricted information. Trusted-recipient allowances are an application policy choice with a similar practical effect, not a general automatic cleaning operation. |
| `NORMAL` / `STRICT` | Python dependency-propagation modes; strict adds more persistent execution influence. The JavaScript runner accepts its own mode enum but does not implement those propagation semantics. |
| `CaMeLException` | Interpreter error wrapper with source locations and the metadata/dependency interface used by error formatting. Distinct from a policy-denial exception. |
| Error redaction | Hiding an untrusted exception's message before returning it to the planner, to avoid an error becoming an instruction channel. |
| AgentDojo | Benchmark framework providing environments, tools, user tasks, injections, and evaluation. |
| Suite | Collection of tasks and tools for a domain: workspace, banking, travel, or Slack here. |
| Injection / prompt injection | Attacker-controlled content attempting to redirect the agent's behavior. |
| Utility result | Benchmark assessment of completion of the legitimate task. |
| Security result | Benchmark assessment concerning the attacker objective; interpret its boolean according to AgentDojo's evaluation/reporting conventions. |
| Replay | Re-executing recorded generated code and recorded QLLM outputs under selected Python policies. |
| Semgrep | Static source-code analyzer; `mode: taint` rules track configured source-to-sink flows. |
| Finding | A match reported by Semgrep, not currently an execution-blocking decision. |
| Node | Host JavaScript runtime launched by the current JS runner with `node -e`. |
| Mock model server | Local endpoint returning fixed responses for plumbing tests. Its JavaScript output does not demonstrate completion of a real benchmark task. |

See [capabilities](../src/camel/capabilities/), [policy definitions](../src/camel/security_policy.py), and [interpreter](../src/camel/interpreter/) for the concrete representations.
