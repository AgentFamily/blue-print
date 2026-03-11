"use strict";

const crypto = require("crypto");

const { BlueprintError } = require("../errors");
const { createAuthRequest, getAuthRequestByCode, updateAuthRequest } = require("../db");
const { createSystemVaultRecord } = require("./vault_record_service");

const AUTH_REQUEST_KINDS = Object.freeze([
  "approval",
  "human_verify",
  "signup_complete",
  "captcha",
  "otp",
  "legal_acceptance",
  "blocked_automation",
]);

const DEFAULT_AUTH_TTL_MS = 15 * 60 * 1000;

const trimText = (value, maxLen = 240) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const normalizeKind = (value) => {
  const kind = String(value || "approval").trim().toLowerCase();
  return AUTH_REQUEST_KINDS.includes(kind) ? kind : "approval";
};

const normalizeDecision = (value) => {
  const decision = String(value || "").trim().toLowerCase();
  if (decision === "yes" || decision === "approved" || decision === "allow") return "approved";
  if (decision === "no" || decision === "denied" || decision === "reject") return "denied";
  if (decision === "completed" || decision === "done") return "completed";
  if (decision === "expired") return "expired";
  return "";
};

const createApprovalCode = () => `AUTH-${crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;

const toMillis = (value) => {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
};

const serializeAuthRequest = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    task: row.task,
    requester: row.requester,
    receiver: row.receiver,
    channel: row.channel,
    sessionSnapshot: row.sessionSnapshot || {},
    status: row.status,
    decision: row.decision,
    reviewer: row.reviewer || {},
    vaultRecordIds: Array.isArray(row.vaultRecordIds) ? row.vaultRecordIds.slice() : [],
    requestedAt: toMillis(row.createdAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: toMillis(row.expiresAt),
    decidedAt: toMillis(row.decidedAt),
  };
};

const createAuthVaultRecord = ({ workspaceId, code, kind, task, requester, receiver, channel, reviewer, sessionSnapshot, createdBy }) =>
  createSystemVaultRecord({
    workspaceId,
    recordType: "handoff",
    title: `Auth request ${code}`,
    status: "pending",
    payload: {
      code,
      kind,
      task,
      requester,
      receiver,
      channel,
      reviewer,
      sessionSnapshot,
    },
    meta: {
      code,
      requester,
      receiver,
      channel,
    },
    createdBy,
  });

const resolveFreshAuthRequest = (code) => {
  const row = getAuthRequestByCode(code);
  if (!row) return null;
  const expiresAtMs = toMillis(row.expiresAt);
  if (row.status === "pending" && expiresAtMs > 0 && Date.now() > expiresAtMs) {
    const next = updateAuthRequest(row.code, {
      status: "expired",
      decision: "expired",
      decidedAt: new Date().toISOString(),
    });
    return next || row;
  }
  return row;
};

const createApprovalRequest = ({
  workspaceId = "ws_core",
  task,
  requester = "",
  receiver = "",
  channel = "email",
  kind = "approval",
  sessionSnapshot = {},
  reviewer = {},
  createdBy = "system",
  code = "",
  expiresInMs = DEFAULT_AUTH_TTL_MS,
}) => {
  const taskText = trimText(task, 1200);
  if (!taskText) {
    throw new BlueprintError(400, "invalid_task", "task is required");
  }

  const authCode = trimText(code, 20).toUpperCase() || createApprovalCode();
  const normalizedKind = normalizeKind(kind);
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(expiresInMs || DEFAULT_AUTH_TTL_MS))).toISOString();
  const handoffRecord = createAuthVaultRecord({
    workspaceId,
    code: authCode,
    kind: normalizedKind,
    task: taskText,
    requester: trimText(requester, 160).toLowerCase(),
    receiver: trimText(receiver, 160).toLowerCase(),
    channel: trimText(channel, 80).toLowerCase() || "email",
    reviewer,
    sessionSnapshot: sessionSnapshot && typeof sessionSnapshot === "object" ? sessionSnapshot : {},
    createdBy,
  });

  const row = createAuthRequest({
    workspaceId,
    code: authCode,
    kind: normalizedKind,
    task: taskText,
    requester,
    receiver,
    channel,
    sessionSnapshot,
    reviewer,
    createdBy,
    vaultRecordIds: handoffRecord ? [handoffRecord.recordId] : [],
    expiresAt,
  });

  return serializeAuthRequest(row);
};

const readApprovalRequest = (code) => {
  const row = resolveFreshAuthRequest(code);
  if (!row) {
    throw new BlueprintError(404, "auth_request_not_found", "Authorization request not found");
  }
  return serializeAuthRequest(row);
};

const applyApprovalDecision = ({
  code,
  decision,
  verified = true,
  reviewerNotes = "",
  sessionSnapshot = null,
  createdBy = "system",
}) => {
  const row = resolveFreshAuthRequest(code);
  if (!row) {
    throw new BlueprintError(404, "auth_request_not_found", "Authorization request not found");
  }
  const normalizedDecision = normalizeDecision(decision);
  if (!normalizedDecision) {
    throw new BlueprintError(400, "invalid_decision", "decision must be yes/no/approved/denied/completed/expired");
  }

  const status =
    normalizedDecision === "approved"
      ? "approved"
      : normalizedDecision === "denied"
        ? "denied"
        : normalizedDecision === "completed"
          ? "completed"
          : "expired";

  const decisionRecord = createSystemVaultRecord({
    workspaceId: row.workspaceId,
    recordType: "handoff",
    title: `Auth decision ${row.code}`,
    status,
    relatedIds: row.vaultRecordIds || [],
    payload: {
      code: row.code,
      decision: normalizedDecision,
      verified: verified !== false,
      reviewerNotes: trimText(reviewerNotes, 1200),
      sessionSnapshot: sessionSnapshot && typeof sessionSnapshot === "object" ? sessionSnapshot : row.sessionSnapshot || {},
    },
    meta: {
      code: row.code,
      decision: normalizedDecision,
    },
    createdBy,
  });

  const nextRecordIds = Array.isArray(row.vaultRecordIds) ? row.vaultRecordIds.slice() : [];
  if (decisionRecord?.recordId) nextRecordIds.push(decisionRecord.recordId);

  const updated = updateAuthRequest(row.code, {
    status,
    decision: normalizedDecision,
    reviewer: {
      ...(row.reviewer && typeof row.reviewer === "object" ? row.reviewer : {}),
      verified: verified !== false,
      reviewerNotes: trimText(reviewerNotes, 1200),
    },
    decidedAt: new Date().toISOString(),
    sessionSnapshot: sessionSnapshot && typeof sessionSnapshot === "object" ? sessionSnapshot : row.sessionSnapshot,
    vaultRecordIds: nextRecordIds,
  });

  return serializeAuthRequest(updated || row);
};

module.exports = {
  AUTH_REQUEST_KINDS,
  DEFAULT_AUTH_TTL_MS,
  createApprovalCode,
  createApprovalRequest,
  readApprovalRequest,
  applyApprovalDecision,
  serializeAuthRequest,
};
