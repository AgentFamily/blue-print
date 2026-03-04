"use strict";

const { BlueprintError } = require("../errors");
const { audit } = require("../audit");
const { assertWorkspaceAccess } = require("./workspace_service");
const { readWidgetManifest } = require("./manifest_service");
const { checkConnectorRequirement, connectorActions } = require("./connector_service");
const { getConnector } = require("../connectors/registry");

const buildAuthorizationPlan = (manifest, workspaceId, checks) => ({
  requiredConnectors: (manifest.requiredConnectors || []).map((req) => ({
    connectorId: req.connectorId,
    scopes: Array.isArray(req.scopes) ? req.scopes : [],
    fields: Array.isArray(req.fields) ? req.fields : [],
  })),
  workspaceId,
  missing: checks
    .filter((item) => item.status !== "ok")
    .map((item) => ({
      connectorId: item.connectorId,
      status: item.status,
      message: item.message,
      requiredScopes: item.requiredScopes || [],
      requiredFields: item.requiredFields || [],
      missingScopes: item.missingScopes || [],
      actions: connectorActions(item.connectorId, workspaceId),
    })),
});

const runWidget = async ({ actorUserId, workspaceId, widgetId, input }) => {
  assertWorkspaceAccess(actorUserId, workspaceId);
  const manifest = readWidgetManifest(widgetId);

  if (manifest?.runPolicy?.serverOnly !== true) {
    throw new BlueprintError(400, "invalid_manifest", "Widget runPolicy must be serverOnly=true");
  }

  const checks = (manifest.requiredConnectors || []).map((requirement) =>
    checkConnectorRequirement({ workspaceId, requirement })
  );
  const missing = checks.filter((item) => item.status !== "ok");
  if (missing.length > 0) {
    return {
      ok: false,
      error: "authorization_required",
      message: "Required connectors are missing or not fully authorized",
      authorizationPlan: buildAuthorizationPlan(manifest, workspaceId, checks),
    };
  }

  const connectorResults = [];
  for (const check of checks) {
    const connector = getConnector(check.connectorId);
    const result = await connector.request(
      check.connectionId,
      {
        method: "POST",
        path: `/widgets/${manifest.widgetId}/run`,
        body: input && typeof input === "object" ? input : {},
      },
      {
        actorUserId,
        workspaceId,
      }
    );
    connectorResults.push({
      connectorId: check.connectorId,
      connectionId: check.connectionId,
      result,
    });
  }

  audit({
    actorUserId,
    workspaceId,
    action: "widget.run",
    targetType: "widget",
    targetId: manifest.widgetId,
    meta: {
      connectorCount: connectorResults.length,
      version: manifest.version,
    },
  });

  return {
    ok: true,
    widgetId: manifest.widgetId,
    version: manifest.version,
    runAt: new Date().toISOString(),
    connectorResults,
  };
};

module.exports = {
  runWidget,
};
