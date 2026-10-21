// Errors raised while running a plan.
//
// Every PlanError carries:
//   loc  - where in the plan it happened (line/column), for the P-LLM's feedback
//   deps - the values that caused it; their labels decide whether the message
//          may be shown to the P-LLM or must be redacted
//          (as format_camel_exception does in privileged_llm.py:101-104)
//
// Bugs in the interpreter itself are plain `Error`s, never PlanErrors.

export class PlanError extends Error {
  /**
   * @param {string} message
   * @param {{node?: {loc?: object}, deps?: import("./labeled.js").Labeled[]}} [options]
   */
  constructor(message, { node = null, deps = [] } = {}) {
    super(message);
    this.name = new.target.name;
    this.loc = node?.loc ? { line: node.loc.start.line, column: node.loc.start.column } : null;
    this.endLoc = node?.loc ? { line: node.loc.end.line, column: node.loc.end.column } : null;
    this.deps = deps;
  }
}

/** The plan uses syntax outside the supported subset (mirrors SyntaxError in camel_eval). */
export class UnsupportedSyntaxError extends PlanError {}

/** The code could not be parsed at all. */
export class PlanSyntaxError extends PlanError {}

export class PlanTypeError extends PlanError {}

export class PlanReferenceError extends PlanError {}

export class PlanRangeError extends PlanError {}

/** The plan executed `throw new Error(...)`. */
export class PlanThrownError extends PlanError {}

/** A tool failed while running (on the host side). */
export class ToolError extends PlanError {
  constructor(message, { toolName, ...options } = {}) {
    super(message, options);
    this.toolName = toolName;
  }
}

/**
 * A security policy denied a tool call (mirrors SecurityPolicyDeniedError).
 * Not a normal plan error: it stops the plan and is not retried by the P-LLM.
 */
export class PolicyDeniedError extends PlanError {
  constructor(message, { toolName, ...options } = {}) {
    super(message, options);
    this.toolName = toolName;
  }
}
