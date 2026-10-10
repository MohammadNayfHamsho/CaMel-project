# Policies and enforcement

## What a policy means

A Python CaMeL security policy is a trusted host-side function deciding whether a tool may execute with particular arguments. It receives a tool name and a mapping of argument names to wrapped `CaMeLValue` objects. It returns `Allowed()` or `Denied(reason)`.

Policies are not prompts sent to either LLM. They are application code. They can inspect provenance, permitted readers, and the environment's existing objects and permissions. See [security_policy.py](../src/camel/security_policy.py) and [domain policies](../src/camel/pipeline_elements/security_policies/).

A policy expresses the application's allowed information flows. A tainted value is not automatically forbidden: an email-derived summary can be sent to someone already allowed to read it, subject to the selected policy.

## The policy engine

`SecurityPolicyEngine.check_policy` applies these steps in order:

1. If the tool is in `no_side_effect_tools`, allow it immediately.
2. Otherwise, inspect current execution dependencies. If any is non-public, deny the state-changing call. This checks whether a private branch condition or loop input controls the action.
3. Find the first matching tool-name pattern in `policies`, using `fnmatch`, and return that policy's decision.
4. If no policy matches, deny by default.

The implementation returns the first matching policy's result; it does not combine all matching policies. Its docstring suggests broader evaluation, so use the code as the authority.

`NoSecurityPolicyEngine` and `ADNoSecurityPolicyEngine` override the check to always return `Allowed()`. In [models.py](../src/camel/models.py), ordinary CaMeL generation uses the latter; policy replay selects a domain engine. The current ordinary generation path also uses the JavaScript runner, which ignores the engine entirely.

## Exactly what happens before a sink executes

The enforcement point is `_eval_call` in [the Python interpreter](../src/camel/interpreter/interpreter.py).

```text
Evaluate function expression and arguments
    -> preserve wrapped arguments for inspection
    -> check_policy(tool_name, wrapped_arguments, execution_dependencies)
    -> if Denied for an external tool: raise SecurityPolicyDeniedError
    -> otherwise call the tool
    -> wrap its output and record the successful call
```

The decisive code is:

```python
if not isinstance(
    evaled_fn,
    value.CaMeLBuiltin | value.CaMeLFunction | value.CaMeLClass,
) and isinstance(policy_check_result, security_policy.Denied):
    raise security_policy.SecurityPolicyDeniedError(
        f"Execution of tool '{evaled_fn.name().raw}' denied: "
        f"{policy_check_result.reason}"
    )
```

Only afterward does `evaled_fn.call(...)` run. For an `AgentDojoFunction`, that reaches `runtime.run_function(...)` in [agentdojo_function.py](../src/camel/pipeline_elements/agentdojo_function.py).

Consequently, the rejected tool has no opportunity to send the email, transfer the money, or change the file. The interpreter stops at the call. Earlier actions are not rolled back. Argument expressions have already been evaluated, so any tool calls nested inside those expressions have their own earlier checks and may already have executed.

Builtins, ordinary `CaMeLFunction` objects, and classes are excluded from this denial branch. Register an external action using the appropriate checked tool wrapper; wrapping an arbitrary action as a generic function does not give it this enforcement behavior.

## Who handles the denial?

`SecurityPolicyDeniedError` is defined in [security_policy.py](../src/camel/security_policy.py). It is raised directly, not returned as `result.Error`.

In `replay_task` in [replay_privileged_llm.py](../src/camel/pipeline_elements/replay_privileged_llm.py), the caller catches it, records a denial message and previously accumulated printed output, then returns without replaying later turns. It does not ask for approval, sanitize the argument, or automatically replan.

Other callers must catch the exception themselves. Ordinary interpreter errors use `result.Error(CaMeLException(...))` and can reach the PLLM's code-repair loop. A policy that itself throws an exception is also handled differently from a policy returning `Denied`: `_eval_call` wraps policy-evaluation exceptions as interpreter errors.

## Concrete example

Suppose an attacker-controlled email includes an attacker address. The QLLM extracts that address and summarizes a private document. Both outputs retain dependencies on their inputs. If `send_email` receives an untrusted recipient, the workspace policy checks whether the recipient may read the body, subject, and attachments. If the body is private and the recipient is excluded from its readers, it returns `Denied`. The email tool is never invoked.

There is a significant exception in the actual workspace policy: trusted recipients are allowed immediately, before checking content readers. A literal recipient supplied by the PLLM usually has trusted provenance. This is an application authorization choice, not a universal rule that every private value must always stay within its original reader set.

## Domain policy summary

| Domain | Main checks |
|---|---|
| Workspace | Recipient/content compatibility; trusted identifiers for destructive or sharing operations; existing file permissions for appended content. |
| Banking | Trusted transfer recipient and reader checks for subject, amount, and date; trusted password; user-info updates require trusted values for every argument. |
| Travel | Email/calendar checks and trusted reservation fields. |
| Slack | Trusted membership-management arguments; message-reader compatibility; public URL/content for webpage operations. |

Audit the actual implementation before depending on these rules. Existing inconsistencies include `delete_email_policy` denying a trusted identifier despite its comment, reservation field names that appear swapped between car rental and restaurant policies, and travel reviews labelled with a trusted `User` source despite their untrusted-tool grouping.

## What happens in JavaScript today?

The current Semgrep rule reports possible flows before Node executes. Findings are printed as JSON and do **not** block sinks. A scanner launch failure or nonzero exit prevents Node execution through an interpreter error. Python domain policies are not called. See [JavaScript and Semgrep](javascript-and-semgrep.md).
