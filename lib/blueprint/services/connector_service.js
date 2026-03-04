"use strict";

const { listConnections, getConnectionById, findActiveConnection } = require("../db");
const { audit } = require("../audit");
const { BlueprintError } = require("../errors");
const { listConnectors, getConnector } = require("../connectors/registry");
const { assertWorkspaceAccess } = require("./workspace_service");
const { connectorToWidgets } = require("../catalog");

const connectorActions = (connectorId, workspaceId) => {
  const wsQuery = workspaceId ? `?workspaceId=${encodeURIComponent(String(workspaceId))}` : "";
  return {
    installConnectorLabel: "Install Connector",
    installConnectorUrl: `/api/connectors/${connectorId}/authorize${wsQuery}`,
    requirementsUrl: `/api/connectors/${connectorId}/requirements${wsQuery}`,
    testConnectorUrl: `/api/connectors/${connectorId}/test${wsQuery}`,
  };
};

const listConnectorCatalog = ({ actorUserId, workspaceId }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const connections = listConnections(workspaceId);
  const byConnector = new Map();
  const widgetMap = connectorToWidgets();
  for (const row of connections) {
    if (!byConnector.has(row.connectorId)) byConnector.set(row.connectorId, []);
    byConnector.get(row.connectorId).push({
      id: row.id,
      status: row.status,
      scopes: row.scopes,
      fields: row.fields,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    });
  }

  return listConnectors().map((connector) => ({
    ...connector,
    requirements: getConnector(connector.id).requirements(),
    connections: byConnector.get(connector.id) || [],
    usedByWidgets: widgetMap.get(connector.id) || [],
    actions: connectorActions(connector.id, workspaceId),
  }));
};

const getConnectorRequirements = ({ connectorId, workspaceId }) => {
  const connector = getConnector(connectorId);
  const widgetMap = connectorToWidgets();
  return {
    id: connector.id,
    label: connector.label,
    authType: connector.authType,
    ...connector.requirements(),
    usedByWidgets: widgetMap.get(connector.id) || [],
    actions: connectorActions(connector.id, workspaceId),
  };
};

const authorizeConnector = async ({ connectorId, actorUserId, workspaceId, input }) => {
  const access = assertWorkspaceAccess(actorUserId, workspaceId);
  if (!["owner", "admin", "member"].includes(access.role)) {
    throw new BlueprintError(403, "workspace_read_only", "Workspace role cannot authorize connectors");
  }

  const connector = getConnector(connectorId);
  const out = await connector.authorize(input, { actorUserId, workspaceId });

  audit({
    actorUserId,
    workspaceId,
    action: "connector.authorize",
    targetType: "connector_connection",
    targetId: out.connectionId,
    meta: { connectorId: connector.id, authType: connector.authType },
  });

  return {
    connectorId: connector.id,
    connectionId: out.connectionId,
  };
};

const testConnector = async ({ connectorId, actorUserId, workspaceId, connectionId }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const connector = getConnector(connectorId);
  const connection = getConnectionById(connectionId);
  if (!connection || connection.workspaceId !== workspaceId || connection.connectorId !== connector.id) {
    throw new BlueprintError(404, "connection_not_found", "Connection not found");
  }

  const result = await connector.test(connection.id, { actorUserId, workspaceId });
  audit({
    actorUserId,
    workspaceId,
    action: "connector.test",
    targetType: "connector_connection",
    targetId: connection.id,
    meta: {
      connectorId: connector.id,
      ok: Boolean(result?.ok),
      details: String(result?.details || ""),
    },
  });
  return result;
};

const listWorkspaceConnections = ({ actorUserId, workspaceId }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  return listConnections(workspaceId);
};

const checkConnectorRequirement = ({ workspaceId, requirement }) => {
  const connectorId = String(requirement?.connectorId || "");
  const requiredScopes = Array.isArray(requirement?.scopes)
    ? requirement.scopes.map((x) => String(x || "")).filter(Boolean)
    : [];
  const requiredFields = Array.isArray(requirement?.fields)
    ? requirement.fields.map((x) => String(x || "")).filter(Boolean)
    : [];

  const conn = findActiveConnection(workspaceId, connectorId);
  if (!conn) {
    return {
      connectorId,
      status: "missing_connection",
      requiredScopes,
      requiredFields,
      message: "No active authorized connection found",
    };
  }

  const missingScopes = requiredScopes.filter((scope) => !conn.scopes.includes(scope));
  if (missingScopes.length > 0) {
    return {
      connectorId,
      status: "missing_scopes",
      requiredScopes,
      requiredFields,
      missingScopes,
      connectionId: conn.id,
      message: "Authorized connection is missing required scopes",
    };
  }

  return {
    connectorId,
    status: "ok",
    connectionId: conn.id,
    requiredScopes,
    requiredFields,
  };
};

module.exports = {
  connectorActions,
  listConnectorCatalog,
  getConnectorRequirements,
  authorizeConnector,
  testConnector,
  listWorkspaceConnections,
  checkConnectorRequirement,
};
