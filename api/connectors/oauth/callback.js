"use strict";

const { authorizeConnector } = require("../../../lib/blueprint/services/connector_service");
const { readConnectorOauthState } = require("../../../lib/blueprint/oauth_state");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendHtml, queryValue } = require("../../../lib/blueprint/http");
const { BlueprintError, toErrorPayload } = require("../../../lib/blueprint/errors");

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderPage = ({ title, body, status = 200, tone = "#0f766e" }) => `<!doctype html>
<html><body style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background:#f7fafc; color:#111827;">
<main style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:22px;">
  <h1 style="margin:0 0 10px;color:${tone};">${escapeHtml(title)}</h1>
  <div style="color:#374151;line-height:1.5;">${body}</div>
</main>
</body></html>`;

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.connectors.oauth.callback" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    try {
      const providerError = String(queryValue(req, "error") || "").trim();
      const providerMessage = String(queryValue(req, "error_description") || "").trim();
      if (providerError) {
        throw new BlueprintError(400, "connector_oauth_failed", providerMessage || providerError);
      }

      const state = readConnectorOauthState(queryValue(req, "state"));
      const code = String(queryValue(req, "code") || "").trim();
      if (!code) {
        throw new BlueprintError(400, "validation", "OAuth callback code is required");
      }

      const out = await authorizeConnector({
        connectorId: state.connectorId,
        actorUserId: state.userId,
        workspaceId: state.workspaceId,
        input: {
          code,
        },
      });

      sendHtml(
        res,
        200,
        renderPage({
          title: "Connector authorized",
          body: `<p style="margin:0 0 8px;">Connector <strong>${escapeHtml(
            out.connectorId
          )}</strong> is now active.</p><p style="margin:0;">Connection ID: <code>${escapeHtml(
            out.connectionId
          )}</code></p>`,
        })
      );
    } catch (err) {
      const { status, body } = toErrorPayload(err);
      sendHtml(
        res,
        status,
        renderPage({
          status,
          tone: "#b91c1c",
          title: "Connector authorization failed",
          body: `<p style="margin:0 0 8px;">${escapeHtml(body?.message || "Unexpected error")}</p><p style="margin:0;"><code>${escapeHtml(
            body?.error || "internal_error"
          )}</code></p>`,
        })
      );
    }
  });
};
