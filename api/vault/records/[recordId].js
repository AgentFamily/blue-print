"use strict";

const { requireAuthFromRequest } = require("../../../lib/blueprint/services/context_service");
const { readStructuredVaultRecord } = require("../../../lib/blueprint/services/vault_record_service");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../../lib/blueprint/http");
const { BlueprintError } = require("../../../lib/blueprint/errors");

const recordIdFromRequest = (req) => {
  const queryId = String(req?.query?.recordId || "").trim();
  if (queryId) return queryId;
  const direct = String(queryValue(req, "recordId") || "").trim();
  if (direct) return direct;
  const url = String(req?.url || "");
  const match = url.match(/\/api\/vault\/records\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
};

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.vault.records.record" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
    const recordId = recordIdFromRequest(req);
    if (!workspaceId || !recordId) {
      throw new BlueprintError(400, "invalid_input", "workspaceId and recordId are required");
    }

    const record = readStructuredVaultRecord({
      actorUserId: auth.user.id,
      workspaceId,
      recordId,
    });
    sendJson(res, 200, { ok: true, record });
  });
};
