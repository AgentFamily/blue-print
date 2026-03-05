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

const requestOrigin = (req) => {
  const headers = req?.headers || {};
  const protoHeader = String(headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const hostHeader = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  const proto = protoHeader || (req?.socket?.encrypted ? "https" : "http");
  const host = hostHeader || "127.0.0.1:8000";
  return `${proto}://${host}`;
};

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
      const origin = requestOrigin(req);
      const headerButtons = connectors
        .map((connector) => {
          return `<a data-header-install="${escapeHtml(connector.id)}" href="${escapeHtml(
            connector.actions.installConnectorUrl
          )}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:8px 10px;border-radius:9px;font-weight:700;font-size:13px;">Install ${escapeHtml(
            connector.label
          )}</a>`;
        })
        .join("\n");

      const endpointRows = connectors
        .map((connector) => {
          const activeConnection = Array.isArray(connector.connections)
            ? connector.connections.find((row) => String(row?.status || "").toLowerCase() === "active")
            : null;
          const connectionState = activeConnection
            ? `Connected (${activeConnection.id})`
            : "Not connected";
          const stateColor = activeConnection ? "#065f46" : "#92400e";
          return `<tr>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>${escapeHtml(connector.label)}</strong><br/><code>${escapeHtml(
            connector.id
          )}</code></td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:${stateColor};font-weight:600;">${escapeHtml(connectionState)}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
    <a href="${escapeHtml(connector.actions.installConnectorUrl)}">Install</a><br/>
    <a href="${escapeHtml(connector.actions.requirementsUrl)}">Requirements</a><br/>
    <a href="${escapeHtml(connector.actions.testConnectorUrl)}">Test</a>
  </td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
    <code>${escapeHtml(`${origin}${connector.actions.installConnectorUrl}`)}</code><br/>
    <code>${escapeHtml(`${origin}${connector.actions.requirementsUrl}`)}</code><br/>
    <code>${escapeHtml(`${origin}${connector.actions.testConnectorUrl}`)}</code>
  </td>
</tr>`;
        })
        .join("\n");

      const cards = connectors
        .map((connector) => {
          const scopes = Array.isArray(connector?.requirements?.scopes)
            ? connector.requirements.scopes.join(", ")
            : "none";
          const activeConnection = Array.isArray(connector.connections)
            ? connector.connections.find((row) => String(row?.status || "").toLowerCase() === "active")
            : null;
          const widgets = Array.isArray(connector.usedByWidgets)
            ? connector.usedByWidgets.map((item) => item.name).join(", ")
            : "";
          return `<article style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff;">
  <h2 style="margin:0 0 8px;">${escapeHtml(connector.label)}</h2>
  <p style="margin:0 0 8px;color:#374151;">ID: <code>${escapeHtml(connector.id)}</code></p>
  <p style="margin:0 0 8px;color:#374151;">Scopes: ${escapeHtml(scopes)}</p>
  <p style="margin:0 0 8px;color:${activeConnection ? "#065f46" : "#92400e"};">Status: <strong>${escapeHtml(
            activeConnection ? `Connected (${activeConnection.id})` : "Not connected"
          )}</strong></p>
  <p style="margin:0 0 12px;color:#4b5563;">Used by widgets: ${escapeHtml(widgets || "N/A")}</p>
  <a href="${escapeHtml(
    connector.actions.installConnectorUrl
  )}" style="display:inline-block;background:#065f46;color:#ffffff;text-decoration:none;padding:9px 12px;border-radius:10px;font-weight:700;">Install Connector</a>
  <a href="${escapeHtml(
    connector.actions.testConnectorUrl
  )}" style="display:inline-block;margin-left:8px;background:#0b4f4a;color:#ffffff;text-decoration:none;padding:9px 12px;border-radius:10px;font-weight:700;">Test Connection</a>
</article>`;
        })
        .join("\n");

      const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background:#f4f7fb; color:#111827;">
<main style="max-width:1000px;margin:0 auto;">
  <header style="border:1px solid #dbeafe;border-radius:14px;padding:14px 14px 12px;background:#eff6ff;margin-bottom:14px;">
    <h1 style="margin:0 0 6px;">Connector Install Center</h1>
    <p style="margin:0 0 12px;color:#4b5563;">Workspace: <strong>${escapeHtml(workspaceId)}</strong></p>
    <p style="margin:0 0 12px;color:#1f2937;">Local API base: <code>${escapeHtml(origin)}</code></p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${headerButtons}
    </div>
  </header>
  <section style="border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:14px;margin-bottom:12px;">
    <h2 style="margin:0 0 8px;font-size:18px;">Localhost API connection map</h2>
    <p style="margin:0 0 10px;color:#4b5563;">Every connector follows the same path: install credentials, verify scopes, then test.</p>
    <ol style="margin:0 0 12px 18px;color:#1f2937;">
      <li>Click any <strong>Install</strong> button in the header.</li>
      <li>Submit credentials on authorize page.</li>
      <li>Run <strong>Test</strong> to validate connection from localhost.</li>
    </ol>
    <div style="overflow:auto;">
      <table style="border-collapse:collapse;width:100%;min-width:760px;">
        <thead>
          <tr style="background:#f9fafb;text-align:left;">
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Connector</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Actions</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Local URLs</th>
          </tr>
        </thead>
        <tbody>${endpointRows}</tbody>
      </table>
    </div>
  </section>
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
