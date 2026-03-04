"use strict";

const { addAudit, addConnectorRequestLog } = require("./db");

const audit = ({ actorUserId, workspaceId, action, targetType, targetId, meta }) => {
  return addAudit({
    actorUserId,
    workspaceId,
    action,
    targetType,
    targetId,
    meta,
  });
};

const logConnectorRequest = ({ workspaceId, connectorId, connectionId, status, latencyMs, rateLimitHeaders, meta }) => {
  return addConnectorRequestLog({
    workspaceId,
    connectorId,
    connectionId,
    status,
    latencyMs,
    rateLimitHeaders,
    meta,
  });
};

module.exports = {
  audit,
  logConnectorRequest,
};
