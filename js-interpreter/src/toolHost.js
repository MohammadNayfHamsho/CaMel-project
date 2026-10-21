// The tool host: the only way the interpreter reaches the outside world.
//
// The interpreter never runs tools or decides policies itself. At every tool
// call it sends a request to the host; the host (the Python side for AgentDojo,
// a browser-side host later) checks the policy, runs the tool, labels the output
// with its label rules, and answers.
//
// Request (interpreter -> host):
//   {
//     name: "send_email",
//     args: [FlattenedNode, ...],          // positional arguments, see toFlattenedJSON()
//     controlLabels: {sources, readers},   // effective labels of active if/for conditions
//   }
//   FlattenedNode = { raw: primitive | [FlattenedNode] | {key: FlattenedNode}, labels: {sources, readers} }
//   where every node's labels are already complete (own labels + all dependencies).
//
// Response (host -> interpreter), one of:
//   { status: "ok",     value: LabeledNode }            // tool output with its own labels per node
//   { status: "denied", reason: string }                // the security policy refused the call
//   { status: "error",  message: string, labels?: {sources, readers} }   // the tool failed
//   LabeledNode = { raw: primitive | [LabeledNode] | {key: LabeledNode}, labels: {sources, readers} }
//
// The interpreter itself adds the call's arguments as dependencies of the output,
// mirroring value.py:212-222. Hosts must not try to do that.

/**
 * @typedef {object} ToolHost
 * @property {() => string[]} toolNames                 names of the tools plans may call
 * @property {(request: object) => Promise<object>} callTool
 */

const STATUSES = new Set(["ok", "denied", "error"]);

/** Validates a host response so a malformed answer can never enter the plan unlabeled. */
export function validateResponse(response, toolName) {
  if (!response || typeof response !== "object" || !STATUSES.has(response.status)) {
    throw new Error(`tool host returned an invalid response for '${toolName}': ${JSON.stringify(response)}`);
  }
  if (response.status === "ok" && !("value" in response)) {
    throw new Error(`tool host response for '${toolName}' has no value`);
  }
  if (response.status === "denied" && typeof response.reason !== "string") {
    throw new Error(`tool host denial for '${toolName}' has no reason`);
  }
  if (response.status === "error" && typeof response.message !== "string") {
    throw new Error(`tool host error for '${toolName}' has no message`);
  }
  return response;
}
