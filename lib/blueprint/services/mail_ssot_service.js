"use strict";

const { BlueprintError } = require("../errors");
const { audit } = require("../audit");
const { assertWorkspaceAccess } = require("./workspace_service");
const { getConnector } = require("../connectors/registry");

const MAILSSOT_BODY_HEADER = "AGENTC_MAILSSOT_V1";

const normalizePlanId = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, "_")
    .slice(0, 120);

const normalizeRevision = (value) => {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1_000_000, n);
};

const normalizeIsoDate = (value, fallback) => {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms <= 0) return fallback || new Date().toISOString();
  return new Date(ms).toISOString();
};

const asBase64String = (value, fieldName) => {
  const text = String(value || "").trim();
  if (!text) {
    throw new BlueprintError(400, "validation", `${fieldName} is required`);
  }
  try {
    const roundtrip = Buffer.from(text, "base64").toString("base64");
    if (!roundtrip) throw new Error("invalid");
  } catch {
    throw new BlueprintError(400, "validation", `${fieldName} must be base64 encoded`);
  }
  return text;
};

const validateEncryptedEnvelope = (input) => {
  const source = input && typeof input === "object" ? input : null;
  if (!source) {
    throw new BlueprintError(400, "validation", "encryptedEnvelope must be an object");
  }
  const schema = String(source.schema || "").trim();
  const alg = String(source.alg || "").trim();
  if (schema !== "agentc.mailssot.envelope.v1") {
    throw new BlueprintError(400, "validation", "encryptedEnvelope.schema must be agentc.mailssot.envelope.v1");
  }
  if (alg !== "AES-GCM-256") {
    throw new BlueprintError(400, "validation", "encryptedEnvelope.alg must be AES-GCM-256");
  }
  return {
    schema,
    alg,
    iv: asBase64String(source.iv, "encryptedEnvelope.iv"),
    ciphertext: asBase64String(source.ciphertext, "encryptedEnvelope.ciphertext"),
    createdAt: normalizeIsoDate(source.createdAt, new Date().toISOString()),
  };
};

const encodeEnvelopeBody = (envelope) => {
  const serialized = JSON.stringify(envelope);
  const encoded = Buffer.from(serialized, "utf8").toString("base64");
  return `${MAILSSOT_BODY_HEADER}\n${encoded}`;
};

const parseEnvelopeBody = (bodyText) => {
  const text = String(bodyText || "");
  const lines = text.split(/\r?\n/).map((line) => String(line || "").trim());
  if (!lines.length || lines[0] !== MAILSSOT_BODY_HEADER) {
    throw new BlueprintError(400, "validation", "Snapshot body is not a MailSSOT payload");
  }
  const encoded = String(lines[1] || "").trim();
  if (!encoded) {
    throw new BlueprintError(400, "validation", "Snapshot body is missing envelope data");
  }
  let parsed = null;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new BlueprintError(400, "validation", "Snapshot body envelope is malformed");
  }
  return validateEncryptedEnvelope(parsed);
};

const ensureMailboxConnector = () => {
  let connector = null;
  try {
    connector = getConnector("mailbox");
  } catch (err) {
    throw new BlueprintError(503, "connector_unavailable", "Mailbox connector is unavailable", {
      cause: String(err?.code || err?.message || "unknown"),
    });
  }
  return connector;
};

const saveMailSsotSnapshot = async ({
  actorUserId,
  workspaceId,
  connectionId,
  planId,
  revision,
  encryptedEnvelope,
}) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const connId = String(connectionId || "").trim();
  if (!connId) {
    throw new BlueprintError(400, "validation", "connectionId is required");
  }
  const normalizedPlanId = normalizePlanId(planId);
  if (!normalizedPlanId) {
    throw new BlueprintError(400, "validation", "planId is required");
  }
  const rev = normalizeRevision(revision);
  const envelope = validateEncryptedEnvelope(encryptedEnvelope);
  const connector = ensureMailboxConnector();
  const subject = `AGENTC MailSSOT ${normalizedPlanId} r${rev}`;
  const mailBody = encodeEnvelopeBody(envelope);

  const result = await connector.request(
    connId,
    {
      method: "POST",
      path: "/mail/ssot/save",
      body: {
        planId: normalizedPlanId,
        revision: rev,
        subject,
        mailBody,
        meta: {
          schema: envelope.schema,
          revision: rev,
          encryptedEnvelope: envelope,
        },
      },
    },
    {
      actorUserId,
      workspaceId,
    }
  );

  audit({
    actorUserId,
    workspaceId,
    action: "mail_ssot.save",
    targetType: "mail_snapshot",
    targetId: String(result?.messageId || normalizedPlanId),
    meta: {
      connectorId: "mailbox",
      connectionId: connId,
      planId: normalizedPlanId,
      revision: rev,
      savedAt: String(result?.savedAt || ""),
    },
  });

  return {
    ok: true,
    connectorId: "mailbox",
    connectionId: connId,
    planId: normalizedPlanId,
    revision: rev,
    messageId: String(result?.messageId || ""),
    savedAt: String(result?.savedAt || new Date().toISOString()),
  };
};

const getLatestMailSsotSnapshot = async ({ actorUserId, workspaceId, connectionId, planId }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const connId = String(connectionId || "").trim();
  if (!connId) {
    throw new BlueprintError(400, "validation", "connectionId is required");
  }
  const normalizedPlanId = normalizePlanId(planId);
  if (!normalizedPlanId) {
    throw new BlueprintError(400, "validation", "planId is required");
  }
  const connector = ensureMailboxConnector();
  const result = await connector.request(
    connId,
    {
      method: "GET",
      path: "/mail/ssot/latest",
      body: {
        planId: normalizedPlanId,
      },
    },
    {
      actorUserId,
      workspaceId,
    }
  );

  if (!result || result.found !== true) {
    throw new BlueprintError(404, "snapshot_not_found", "No MailSSOT snapshot found for this plan");
  }

  let envelope = null;
  if (result?.meta && typeof result.meta === "object" && result.meta.encryptedEnvelope) {
    envelope = validateEncryptedEnvelope(result.meta.encryptedEnvelope);
  } else {
    envelope = parseEnvelopeBody(result.body);
  }

  audit({
    actorUserId,
    workspaceId,
    action: "mail_ssot.refresh",
    targetType: "mail_snapshot",
    targetId: String(result?.messageId || normalizedPlanId),
    meta: {
      connectorId: "mailbox",
      connectionId: connId,
      planId: normalizedPlanId,
      savedAt: String(result?.savedAt || ""),
    },
  });

  return {
    ok: true,
    connectorId: "mailbox",
    connectionId: connId,
    planId: normalizedPlanId,
    messageId: String(result?.messageId || ""),
    savedAt: String(result?.savedAt || ""),
    encryptedEnvelope: envelope,
  };
};

module.exports = {
  MAILSSOT_BODY_HEADER,
  validateEncryptedEnvelope,
  encodeEnvelopeBody,
  parseEnvelopeBody,
  saveMailSsotSnapshot,
  getLatestMailSsotSnapshot,
};
