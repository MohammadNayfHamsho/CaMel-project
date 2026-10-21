// Test helpers: a mock tool host that behaves like the Python host will.
//
// It runs fake tools, labels their outputs (like agentdojo_function.py's label rules),
// and checks policies using only what the interpreter sends over the bridge.

import { isTrustedSource } from "../src/index.js";

export const EMMA = "emma.johnson@bluesparrowtech.com";
export const PUBLIC_LABELS = Object.freeze({ sources: ["User"], readers: "Public" });

/** A labeled JSON node, as the host sends tool outputs. */
export function node(raw, labels) {
  return { raw, labels };
}

/** Labels for data from a tool; `inner` = who could have written it. */
export function toolLabels(tool, inner, readers) {
  return { sources: [{ tool, inner }], readers };
}

/** Labels of a file from the cloud drive, mirroring _get_cloud_drive_file_metadata. */
export function cloudFileLabels(tool, file) {
  const editors = Object.entries(file.shared_with)
    .filter(([, permission]) => permission === "rw")
    .map(([user]) => user);
  const inner = [...new Set([...editors, file.owner])].map((u) => (u === EMMA ? "User" : u));
  return toolLabels(tool, inner, Object.keys(file.shared_with));
}

// ---------------------------------------------------------------- policy helpers on flattened labels

export function labelsTrusted(labels) {
  return labels.sources.every((s) => isTrustedSource(typeof s === "string" ? s : { tool: s.tool, inner: s.inner }));
}

export function labelsReadableBy(labels, principals) {
  return labels.readers === "Public" || principals.every((p) => labels.readers.includes(p));
}

/** Mirrors workspace.send_email_policy (workspace.py:70-87) on flattened arguments. */
export function sendEmailPolicy({ args: [options] }) {
  const { recipients, subject, body } = options.raw;
  if (labelsTrusted(recipients.labels)) return { allowed: true };
  const principals = recipients.raw.map((r) => r.raw);
  for (const [field, value] of Object.entries({ body, subject })) {
    if (!labelsReadableBy(value.labels, principals)) {
      return { allowed: false, reason: `${field} is not shared with the recipients ${principals.join(", ")}` };
    }
  }
  return { allowed: true };
}

/**
 * A mock host.
 * @param {Record<string, (plainArgs: any[], request: object) => object>} tools  return a labeled node
 * @param {object} options
 * @param {Record<string, (request) => {allowed: boolean, reason?: string}>} [options.policies]
 * @param {Set<string>} [options.noSideEffect]  tools that are always allowed
 */
export function mockHost(tools, { policies = {}, noSideEffect = new Set() } = {}) {
  const requests = [];
  return {
    requests,
    toolNames: () => Object.keys(tools),
    async callTool(request) {
      requests.push(request);
      const { name } = request;
      if (!noSideEffect.has(name)) {
        // Like check_policy (security_policy.py:89-92): state-changing tools may not depend
        // on private conditions.
        if (request.controlLabels.readers !== "Public") {
          return { status: "denied", reason: `${name} is state-changing and depends on private values` };
        }
        const policy = policies[name];
        if (!policy) return { status: "denied", reason: "No security policy matched for tool." };
        const decision = policy(request);
        if (!decision.allowed) return { status: "denied", reason: decision.reason };
      }
      try {
        const plainArgs = request.args.map(plainOf);
        return { status: "ok", value: tools[name](plainArgs, request) };
      } catch (error) {
        return { status: "error", message: error.message };
      }
    },
  };
}

/** Plain data from a flattened node. */
export function plainOf(flat) {
  if (Array.isArray(flat.raw)) return flat.raw.map(plainOf);
  if (flat.raw !== null && typeof flat.raw === "object") {
    return Object.fromEntries(Object.entries(flat.raw).map(([k, v]) => [k, plainOf(v)]));
  }
  return flat.raw;
}

/** Sorted readers of a Capabilities object, or "Public". */
export function readersOf(caps) {
  return caps.readers.public ? "Public" : [...caps.readers].sort();
}
