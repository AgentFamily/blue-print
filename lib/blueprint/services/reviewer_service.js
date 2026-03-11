"use strict";

const crypto = require("crypto");

const { listAuthRequests, listServerActionPlans, listVaultRecords } = require("../db");
const { createSystemVaultRecord } = require("./vault_record_service");

const REVIEW_STATUSES = Object.freeze([
  "clear",
  "blocked_conflict",
  "requires_human_confirmation",
]);

const CONFLICTING_SERVER_ACTIONS = new Map([
  ["lock_server", new Set(["open_access_5m", "open_access_15m", "whitelist_current_ip"])],
  ["open_access_5m", new Set(["lock_server", "emergency_close"])],
  ["open_access_15m", new Set(["lock_server", "emergency_close"])],
  ["whitelist_current_ip", new Set(["lock_server", "emergency_close"])],
  ["restart_ssh", new Set(["emergency_close"])],
  ["emergency_close", new Set(["open_access_5m", "open_access_15m", "whitelist_current_ip", "restart_ssh"])],
]);

const LOW_RISK_HINT_RE = /\b(read|view|inspect|summari[sz]e|draft|plan|explain|report|analy[sz]e|compare)\b/i;
const EMAIL_ACTION_RE = /\b(email|mail|newsletter|outreach|follow[\s-]*up|campaign)\b/i;
const API_ACTION_RE = /\b(api|endpoint|webhook|post\b|get\b|put\b|delete\b|request\b|curl\b)\b/i;
const SERVER_ACTION_RE = /\b(server|ssh|firewall|root login|password login|open access|lock server|restart ssh|whitelist current ip|emergency close)\b/i;
const EXTERNAL_MUTATION_RE = /\b(deploy|release|publish|merge|commit|dns|rotate key|revoke key|production|live webhook)\b/i;
const FINANCIAL_ACTION_RE = /\b(charge card|billing|payment|invoice|bank|refund)\b/i;
const BROWSER_HANDOFF_RE = /\b(captcha|otp|signup|legal acceptance|human verify|manual verify)\b/i;
const SPAM_RISK_RE = /\b(bulk|blast|mass send|spam|repeat to all|all recipients)\b/i;

const nowIso = () => new Date().toISOString();

const trimText = (value, maxLen = 400) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const normalizeActionId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const buildReviewSourceText = ({ prompt, taskContext }) => {
  const context = taskContext && typeof taskContext === "object" ? taskContext : {};
  const pieces = [trimText(prompt, 2000)];
  for (const key of ["task", "action", "actionId", "actionArea", "kind", "mode", "scope"]) {
    const value = trimText(context[key], 240);
    if (value) pieces.push(value);
  }
  return pieces.filter(Boolean).join("\n");
};

const inferReviewIntents = ({ prompt, taskContext, intents = [] }) => {
  const source = buildReviewSourceText({ prompt, taskContext });
  const found = new Set(
    Array.isArray(intents)
      ? intents.map((item) => normalizeActionId(item)).filter(Boolean)
      : []
  );

  if (EMAIL_ACTION_RE.test(source)) found.add("email_send");
  if (API_ACTION_RE.test(source)) found.add("api_call");
  if (SERVER_ACTION_RE.test(source)) found.add("server_action");
  if (EXTERNAL_MUTATION_RE.test(source)) found.add("external_mutation");
  if (FINANCIAL_ACTION_RE.test(source)) found.add("financial_action");
  if (BROWSER_HANDOFF_RE.test(source)) found.add("browser_handoff");
  if (LOW_RISK_HINT_RE.test(source)) found.add("read_or_draft");

  const actionId = normalizeActionId(taskContext?.actionId || taskContext?.action || "");
  if (actionId) found.add(actionId);

  return Array.from(found);
};

const buildFingerprint = ({ workspaceId, prompt, taskContext, intents }) => {
  const hash = crypto.createHash("sha1");
  hash.update(String(workspaceId || "ws_core"));
  hash.update("\n");
  hash.update(buildReviewSourceText({ prompt, taskContext }));
  hash.update("\n");
  hash.update(JSON.stringify(Array.isArray(intents) ? intents.slice().sort() : []));
  return hash.digest("hex").slice(0, 20);
};

const recordFingerprint = (record) =>
  trimText(record?.meta?.fingerprint || record?.payload?.fingerprint || "", 40);

const detectConflictingServerAction = ({ workspaceId, actionId }) => {
  const current = normalizeActionId(actionId);
  if (!current) return [];
  const disallowed = CONFLICTING_SERVER_ACTIONS.get(current);
  if (!disallowed || !disallowed.size) return [];
  const plans = listServerActionPlans({ workspaceId: String(workspaceId || "ws_core"), limit: 20 });
  return plans
    .filter((item) => disallowed.has(normalizeActionId(item?.actionId || "")) && String(item?.status || "").toLowerCase() !== "completed")
    .map((item) => ({
      type: "conflicting_server_change",
      message: `Conflicts with pending server action ${item.actionId}.`,
      relatedId: item.id,
    }));
};

const findDuplicateFingerprints = ({ workspaceId, fingerprint }) => {
  if (!fingerprint) return [];
  const rows = listVaultRecords({ workspaceId: String(workspaceId || "ws_core"), limit: 120 });
  return rows
    .filter((item) => recordFingerprint(item) === fingerprint)
    .slice(0, 5)
    .map((item) => ({
      type: "duplicate_action",
      message: `Matches existing reviewed action ${item.id}.`,
      relatedId: item.id,
    }));
};

const countRecentSensitiveAuthRequests = (workspaceId) =>
  listAuthRequests({ workspaceId: String(workspaceId || "ws_core"), limit: 20 }).filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return status === "pending" || status === "approved";
  }).length;

const assessExecutionRequest = ({
  workspaceId = "ws_core",
  prompt = "",
  taskContext = {},
  intents = [],
}) => {
  const normalizedTaskContext = taskContext && typeof taskContext === "object" ? taskContext : {};
  const resolvedIntents = inferReviewIntents({ prompt, taskContext: normalizedTaskContext, intents });
  const fingerprint = buildFingerprint({
    workspaceId,
    prompt,
    taskContext: normalizedTaskContext,
    intents: resolvedIntents,
  });

  const reasons = [];
  const conflicts = [];

  const duplicateMatches = findDuplicateFingerprints({ workspaceId, fingerprint });
  conflicts.push(...duplicateMatches);

  const serverAction = normalizeActionId(normalizedTaskContext.actionId || "");
  if (resolvedIntents.includes("server_action") || serverAction) {
    conflicts.push(...detectConflictingServerAction({ workspaceId, actionId: serverAction }));
  }

  const rawPrompt = buildReviewSourceText({ prompt, taskContext: normalizedTaskContext });
  const hasSpamRisk = SPAM_RISK_RE.test(rawPrompt);
  if (hasSpamRisk) {
    conflicts.push({
      type: "spam_risk_behaviour",
      message: "Prompt contains bulk or spam-risk wording.",
      relatedId: "",
    });
  }

  const sensitiveAuthCount = countRecentSensitiveAuthRequests(workspaceId);
  const containsSensitiveIntent = resolvedIntents.some((item) =>
    ["email_send", "api_call", "server_action", "external_mutation", "financial_action", "browser_handoff"].includes(item)
  );

  if (duplicateMatches.length) reasons.push("Reviewer detected a duplicate action fingerprint.");
  if (conflicts.some((item) => item.type === "conflicting_server_change")) {
    reasons.push("Reviewer detected a conflicting server change.");
  }
  if (hasSpamRisk) reasons.push("Prompt triggers spam-risk safeguards.");

  let riskLevel = "low";
  if (resolvedIntents.includes("server_action") || resolvedIntents.includes("financial_action") || resolvedIntents.includes("external_mutation")) {
    riskLevel = "high";
  } else if (containsSensitiveIntent || sensitiveAuthCount > 0) {
    riskLevel = "medium";
  }

  let status = "clear";
  if (conflicts.length > 0) {
    status = "blocked_conflict";
  } else if (containsSensitiveIntent || riskLevel !== "low") {
    status = "requires_human_confirmation";
  }

  const guardrailsSatisfied = status !== "blocked_conflict";
  const requiresHumanConfirmation = status === "requires_human_confirmation";
  const allowAutoExecute = guardrailsSatisfied && !requiresHumanConfirmation && riskLevel === "low";

  return {
    reviewedAt: nowIso(),
    status,
    riskLevel,
    reasons,
    conflicts,
    intents: resolvedIntents,
    fingerprint,
    guardrailsSatisfied,
    requiresHumanConfirmation,
    allowAutoExecute,
    summary:
      status === "blocked_conflict"
        ? "Execution blocked by reviewer."
        : requiresHumanConfirmation
          ? "Execution requires human confirmation."
          : "Execution cleared by reviewer.",
  };
};

const buildExecutionGate = ({
  allowAutomation = false,
  reviewer,
  taskContext = {},
  prompt = "",
}) => {
  const review = reviewer && typeof reviewer === "object" ? reviewer : assessExecutionRequest({ taskContext, prompt });
  const source = buildReviewSourceText({ prompt, taskContext });
  const draftLike = LOW_RISK_HINT_RE.test(source);

  if (review.status === "blocked_conflict") {
    return {
      state: "blocked",
      autoExecute: false,
      withinGuardrails: false,
      reason: review.summary,
    };
  }

  if (review.requiresHumanConfirmation || !allowAutomation) {
    return {
      state: review.requiresHumanConfirmation ? "awaiting_confirmation" : "draft_only",
      autoExecute: false,
      withinGuardrails: true,
      reason: review.summary,
    };
  }

  if (!draftLike) {
    return {
      state: "awaiting_confirmation",
      autoExecute: false,
      withinGuardrails: true,
      reason: "Automation only auto-runs for low-risk read or draft actions.",
    };
  }

  return {
    state: review.allowAutoExecute ? "auto_execute_allowed" : "draft_only",
    autoExecute: review.allowAutoExecute,
    withinGuardrails: true,
    reason: review.summary,
  };
};

const recordReviewerOutcome = ({
  workspaceId = "ws_core",
  createdBy = "system",
  reviewer,
  prompt = "",
  taskContext = {},
}) => {
  const review = reviewer && typeof reviewer === "object" ? reviewer : assessExecutionRequest({ workspaceId, prompt, taskContext });
  const recordType = review.status === "blocked_conflict" ? "review_conflict" : "log";
  return createSystemVaultRecord({
    workspaceId,
    recordType,
    title: `Reviewer: ${review.status}`,
    status: review.status,
    payload: {
      reviewer: review,
      prompt: trimText(prompt, 1200),
      taskContext,
      fingerprint: review.fingerprint,
    },
    meta: {
      fingerprint: review.fingerprint,
      intents: review.intents,
      riskLevel: review.riskLevel,
    },
    createdBy,
  });
};

module.exports = {
  REVIEW_STATUSES,
  assessExecutionRequest,
  buildExecutionGate,
  inferReviewIntents,
  recordReviewerOutcome,
};
