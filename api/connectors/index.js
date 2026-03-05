"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const { listConnectorCatalog } = require("../../lib/blueprint/services/connector_service");
const { listAccessibleWorkspaces } = require("../../lib/blueprint/services/workspace_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, sendHtml, queryValue } = require("../../lib/blueprint/http");
const { BlueprintError } = require("../../lib/blueprint/errors");

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const requestedWorkspace = String(queryValue(req, "workspaceId") || "").trim();
    const workspaces = listAccessibleWorkspaces(auth.user.id);
    const workspaceId = requestedWorkspace || String(workspaces[0]?.id || "");
    if (!workspaceId) {
      throw new BlueprintError(404, "workspace_not_found", "No workspace available for user");
    }

    const connectors = listConnectorCatalog({
      actorUserId: auth.user.id,
      workspaceId,
    });

    const view = String(queryValue(req, "view") || "").trim().toLowerCase();
    if (view === "install") {
      const headerButtons = connectors
        .map((connector) => {
          return `<a data-header-install="${escapeHtml(connector.id)}" href="${escapeHtml(
            connector.actions.installConnectorUrl
          )}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:8px 10px;border-radius:9px;font-weight:700;font-size:13px;">Install ${escapeHtml(
            connector.label
          )}</a>`;
        })
        .join("\n");

      const cards = connectors
        .map((connector) => {
          const scopes = Array.isArray(connector?.requirements?.scopes)
            ? connector.requirements.scopes.join(", ")
            : "none";
          const widgets = Array.isArray(connector.usedByWidgets)
            ? connector.usedByWidgets.map((item) => item.name).join(", ")
            : "";
          return `<article style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff;">
  <h2 style="margin:0 0 8px;">${escapeHtml(connector.label)}</h2>
  <p style="margin:0 0 8px;color:#374151;">ID: <code>${escapeHtml(connector.id)}</code></p>
  <p style="margin:0 0 8px;color:#374151;">Scopes: ${escapeHtml(scopes)}</p>
  <p style="margin:0 0 12px;color:#4b5563;">Used by widgets: ${escapeHtml(widgets || "N/A")}</p>
  <a href="${escapeHtml(
    connector.actions.installConnectorUrl
  )}" style="display:inline-block;background:#065f46;color:#ffffff;text-decoration:none;padding:9px 12px;border-radius:10px;font-weight:700;">Install Connector</a>
</article>`;
        })
        .join("\n");

      const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background:#f4f7fb; color:#111827;">
<main style="max-width:1000px;margin:0 auto;">
  <header style="border:1px solid #dbeafe;border-radius:14px;padding:14px 14px 12px;background:#eff6ff;margin-bottom:14px;">
    <h1 style="margin:0 0 6px;">Connector Install Center</h1>
    <p style="margin:0 0 12px;color:#4b5563;">Workspace: <strong>${escapeHtml(workspaceId)}</strong></p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${headerButtons}
    </div>
  </header>
  <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">${cards}</section>
</main>
</body></html>`;
      sendHtml(res, 200, html);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      workspaceId,
      connectors,
      installCenterUrl: `/api/connectors?workspaceId=${encodeURIComponent(workspaceId)}&view=install`,
    });
  });
};
