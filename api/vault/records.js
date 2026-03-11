"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  createStructuredVaultRecord,
  listStructuredVaultRecords,
} = require("../../lib/blueprint/services/vault_record_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, queryValue, parseCookies } = require("../../lib/blueprint/http");
const { ensureCsrf } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.vault.records" }, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    const auth = requireAuthFromRequest(req);

    if (method === "GET") {
      const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
      if (!workspaceId) {
        throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
      }
      const recordType = String(queryValue(req, "recordType") || "").trim();
      const limit = Number.parseInt(String(queryValue(req, "limit") || "50"), 10);
      const records = listStructuredVaultRecords({
        actorUserId: auth.user.id,
        workspaceId,
        recordType,
        limit,
      });
      sendJson(res, 200, { ok: true, records });
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });
    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "").trim();
    const recordType = String(body?.recordType || "").trim();
    if (!workspaceId || !recordType) {
      throw new BlueprintError(400, "invalid_input", "workspaceId and recordType are required");
    }

    const record = createStructuredVaultRecord({
      actorUserId: auth.user.id,
      workspaceId,
      recordType,
      title: body?.title,
      status: body?.status,
      payload: body?.payload,
      meta: body?.meta,
      secretRefId: body?.secretRefId || body?.secret_ref_id,
      relatedIds: body?.relatedIds,
      createdBy: auth.user.id,
    });
    sendJson(res, 201, { ok: true, record });
  });
};
