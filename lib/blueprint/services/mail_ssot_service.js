"use strict";

const { BlueprintError } = require("../errors");
const { audit } = require("../audit");
const { getConnectionById } = require("../db");
const { assertWorkspaceAccess } = require("./workspace_service");
const { getConnector } = require("../connectors/registry");
const {
  MAILSSOT_BODY_HEADER,
  normalizePlanId,
  normalizeRevision,
  validateEncryptedEnvelope,
  encodeEnvelopeBody,
  parseEnvelopeBody,
} = require("../mail_ssot_payload");

const SUPPORTED_CONNECTORS = new Set(["mailbox", "outlook"]);

const resolveMailSsotConnection = ({ workspaceId, connectionId }) => {
  const connId = String(connectionId || "").trim();
  if (!connId) {
    throw new BlueprintError(400, "validation", "connectionId is required");
  }

  const connection = getConnectionById(connId);
  if (!connection || connection.workspaceId !== String(workspaceId || "")) {
    throw new BlueprintError(404, "connection_not_found", "Connection not found");
  }
  if (!SUPPORTED_CONNECTORS.has(String(connection.connectorId || ""))) {
    throw new BlueprintError(400, "unsupported_connector", "Connection does not support MailSSOT");
  }

  return {
    connection,
    connector: getConnector(connection.connectorId),
  };
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
  const normalizedPlanId = normalizePlanId(planId);
  if (!normalizedPlanId) {
    throw new BlueprintError(400, "validation", "planId is required");
  }

  const rev = normalizeRevision(revision);
  const envelope = validateEncryptedEnvelope(encryptedEnvelope);
  const { connection, connector } = resolveMailSsotConnection({ workspaceId, connectionId });
  const subject = `AGENTC MailSSOT ${normalizedPlanId} r${rev}`;
  const mailBody = encodeEnvelopeBody(envelope);

  const result = await connector.request(
    connection.id,
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

  const connectorId = String(result?.connectorId || connection.connectorId || "");
  audit({
    actorUserId,
    workspaceId,
    action: "mail_ssot.save",
    targetType: "mail_snapshot",
    targetId: String(result?.messageId || normalizedPlanId),
    meta: {
      connectorId,
      connectionId: connection.id,
      planId: normalizedPlanId,
      revision: rev,
      savedAt: String(result?.savedAt || ""),
    },
  });

  return {
    ok: true,
    connectorId,
    connectionId: connection.id,
    planId: normalizedPlanId,
    revision: rev,
    messageId: String(result?.messageId || ""),
    savedAt: String(result?.savedAt || new Date().toISOString()),
  };
};

const getLatestMailSsotSnapshot = async ({ actorUserId, workspaceId, connectionId, planId }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const normalizedPlanId = normalizePlanId(planId);
  if (!normalizedPlanId) {
    throw new BlueprintError(400, "validation", "planId is required");
  }

  const { connection, connector } = resolveMailSsotConnection({ workspaceId, connectionId });
  const result = await connector.request(
    connection.id,
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

  const connectorId = String(result?.connectorId || connection.connectorId || "");
  const envelope =
    result?.meta && typeof result.meta === "object" && result.meta.encryptedEnvelope
      ? validateEncryptedEnvelope(result.meta.encryptedEnvelope)
      : parseEnvelopeBody(result.body);

  audit({
    actorUserId,
    workspaceId,
    action: "mail_ssot.refresh",
    targetType: "mail_snapshot",
    targetId: String(result?.messageId || normalizedPlanId),
    meta: {
      connectorId,
      connectionId: connection.id,
      planId: normalizedPlanId,
      savedAt: String(result?.savedAt || ""),
    },
  });

  return {
    ok: true,
    connectorId,
    connectionId: connection.id,
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
