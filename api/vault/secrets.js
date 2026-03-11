"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  createSecret,
  listSecretMetadata,
  updateSecret,
  deleteSecret,
} = require("../../lib/blueprint/vault/service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, queryValue, parseCookies } = require("../../lib/blueprint/http");
const { ensureCsrf } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.vault.secrets" }, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    const auth = requireAuthFromRequest(req);

    if (method === "GET") {
      const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
      const connectorId = String(queryValue(req, "connectorId") || "").trim();
      if (!workspaceId) {
        throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
      }
      const secrets = listSecretMetadata({
        actorUserId: auth.user.id,
        workspaceId,
        connectorId: connectorId || undefined,
      });
      sendJson(res, 200, { ok: true, secrets });
      return;
    }

    if (!["POST", "PUT", "DELETE"].includes(method)) {
      methodNotAllowed(res, "GET, POST, PUT, DELETE");
      return;
    }

    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });
    const body = (await readJsonBody(req)) || {};

    if (method === "POST") {
      const workspaceId = String(body?.workspaceId || "").trim();
      const connectorId = String(body?.connectorId || "").trim();
      const name = String(body?.name || "").trim();
      const value = String(body?.value || "");
      if (!workspaceId || !connectorId || !name || !value) {
        throw new BlueprintError(
          400,
          "invalid_input",
          "workspaceId, connectorId, name, value are required"
        );
      }
      const created = createSecret({
        actorUserId: auth.user.id,
        workspaceId,
        connectorId,
        name,
        value,
      });
      sendJson(res, 201, { ok: true, secret: created });
      return;
    }

    if (method === "PUT") {
      const workspaceId = String(body?.workspaceId || "").trim();
      const secretId = String(body?.secretId || "").trim();
      const value = String(body?.value || "");
      if (!workspaceId || !secretId || !value) {
        throw new BlueprintError(400, "invalid_input", "workspaceId, secretId, value are required");
      }
      const updated = updateSecret({
        actorUserId: auth.user.id,
        workspaceId,
        secretId,
        value,
      });
      sendJson(res, 200, { ok: true, secret: updated });
      return;
    }

    const workspaceId = String(body?.workspaceId || "").trim();
    const secretId = String(body?.secretId || "").trim();
    if (!workspaceId || !secretId) {
      throw new BlueprintError(400, "invalid_input", "workspaceId and secretId are required");
    }
    const out = deleteSecret({
      actorUserId: auth.user.id,
      workspaceId,
      secretId,
    });
    sendJson(res, 200, out);
  });
};
