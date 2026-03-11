"use strict";

const { audit } = require("../audit");
const { BlueprintError } = require("../errors");
const { createVaultRecord, getVaultRecordById, listVaultRecords, updateVaultRecord } = require("../db");
const { ensureWorkspaceAccess } = require("../vault/service");
const { maskSecret } = require("../vault/crypto");

const DEFAULT_WORKSPACE_ID = "ws_core";
const RECORD_TYPES = Object.freeze([
  "secret",
  "memory",
  "log",
  "config",
  "evaluation",
  "browser_transcript",
  "handoff",
  "review_conflict",
  "server_action",
]);

const SECRET_FIELD_RE = /(secret|token|password|apikey|api_key|passkey|credential)/i;

const normalizeRecordType = (value) => {
  const type = String(value || "").trim().toLowerCase();
  if (!RECORD_TYPES.includes(type)) {
    throw new BlueprintError(400, "invalid_record_type", `recordType must be one of ${RECORD_TYPES.join(", ")}`);
  }
  return type;
};

const trimText = (value, maxLen = 4000) => {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const scrubJsonValue = (value, keyHint = "", depth = 0) => {
  if (value == null) return null;
  if (depth > 5) return null;
  if (typeof value === "string") {
    if (SECRET_FIELD_RE.test(String(keyHint || ""))) {
      return `[masked:${maskSecret(value)}]`;
    }
    return trimText(value, 4000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => scrubJsonValue(item, keyHint, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).slice(0, 80)) {
      out[key] = scrubJsonValue(value[key], key, depth + 1);
    }
    return out;
  }
  return trimText(value, 4000);
};

const scrubPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return scrubJsonValue(payload, "", 0) || {};
};

const normalizeRelatedIds = (value) =>
  Array.isArray(value) ? value.map((item) => trimText(item, 120)).filter(Boolean).slice(0, 40) : [];

const requireWorkspaceAccess = ({ actorUserId, workspaceId, systemWrite = false }) => {
  const wid = trimText(workspaceId || DEFAULT_WORKSPACE_ID, 80) || DEFAULT_WORKSPACE_ID;
  if (!actorUserId) {
    if (!systemWrite) {
      throw new BlueprintError(401, "unauthorized", "Authentication required");
    }
    return wid;
  }
  ensureWorkspaceAccess(actorUserId, wid);
  return wid;
};

const toClientRecord = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    recordId: row.id,
    workspaceId: row.workspaceId,
    recordType: row.recordType,
    title: row.title,
    status: row.status,
    payload: scrubPayload(row.payload),
    meta: scrubPayload(row.meta),
    secret_ref_id: row.secretRefId || null,
    relatedIds: normalizeRelatedIds(row.relatedIds),
    createdBy: row.createdBy || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const createStructuredVaultRecord = ({
  actorUserId = "",
  workspaceId = DEFAULT_WORKSPACE_ID,
  recordType,
  title = "",
  status = "active",
  payload = {},
  meta = {},
  secretRefId = "",
  relatedIds = [],
  createdBy = "",
  systemWrite = false,
}) => {
  const wid = requireWorkspaceAccess({ actorUserId, workspaceId, systemWrite });
  const type = normalizeRecordType(recordType);
  const row = createVaultRecord({
    workspaceId: wid,
    recordType: type,
    title: trimText(title, 180) || `${type} record`,
    status: trimText(status, 80) || "active",
    payload: scrubPayload(payload),
    meta: scrubPayload(meta),
    secretRefId: trimText(secretRefId, 120),
    relatedIds: normalizeRelatedIds(relatedIds),
    createdBy: trimText(createdBy || actorUserId || "system", 120),
  });
  if (actorUserId) {
    audit({
      actorUserId,
      workspaceId: wid,
      action: "vault.record.create",
      targetType: "vault_record",
      targetId: row.id,
      meta: {
        recordType: type,
        status: row.status,
      },
    });
  }
  return toClientRecord(row);
};

const createSystemVaultRecord = (input) =>
  createStructuredVaultRecord({
    ...input,
    systemWrite: true,
  });

const updateStructuredVaultRecord = ({
  actorUserId = "",
  workspaceId = DEFAULT_WORKSPACE_ID,
  recordId,
  patch = {},
  systemWrite = false,
}) => {
  const wid = requireWorkspaceAccess({ actorUserId, workspaceId, systemWrite });
  const current = getVaultRecordById(recordId);
  if (!current || current.workspaceId !== wid) {
    throw new BlueprintError(404, "record_not_found", "Vault record not found");
  }
  const next = updateVaultRecord(current.id, {
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "title") ? { title: trimText(patch.title, 180) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "status") ? { status: trimText(patch.status, 80) || current.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "payload") ? { payload: scrubPayload(patch.payload) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "meta") ? { meta: scrubPayload(patch.meta) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "secretRefId") ? { secretRefId: trimText(patch.secretRefId, 120) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch || {}, "relatedIds") ? { relatedIds: normalizeRelatedIds(patch.relatedIds) } : {}),
  });
  if (actorUserId) {
    audit({
      actorUserId,
      workspaceId: wid,
      action: "vault.record.update",
      targetType: "vault_record",
      targetId: next.id,
      meta: {
        recordType: next.recordType,
        status: next.status,
      },
    });
  }
  return toClientRecord(next);
};

const listStructuredVaultRecords = ({
  actorUserId = "",
  workspaceId = DEFAULT_WORKSPACE_ID,
  recordType = "",
  limit = 50,
  systemRead = false,
}) => {
  const wid = requireWorkspaceAccess({ actorUserId, workspaceId, systemWrite: systemRead });
  const rows = listVaultRecords({
    workspaceId: wid,
    recordType: recordType ? normalizeRecordType(recordType) : "",
    limit: Math.max(1, Math.min(200, Number(limit || 50) || 50)),
  });
  return rows.map((row) => toClientRecord(row));
};

const readStructuredVaultRecord = ({
  actorUserId = "",
  workspaceId = DEFAULT_WORKSPACE_ID,
  recordId,
  systemRead = false,
}) => {
  const wid = requireWorkspaceAccess({ actorUserId, workspaceId, systemWrite: systemRead });
  const row = getVaultRecordById(recordId);
  if (!row || row.workspaceId !== wid) {
    throw new BlueprintError(404, "record_not_found", "Vault record not found");
  }
  return toClientRecord(row);
};

module.exports = {
  DEFAULT_WORKSPACE_ID,
  RECORD_TYPES,
  normalizeRecordType,
  createStructuredVaultRecord,
  createSystemVaultRecord,
  updateStructuredVaultRecord,
  listStructuredVaultRecords,
  readStructuredVaultRecord,
  toClientRecord,
};
