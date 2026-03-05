"use strict";

const { requireAuthFromRequest } = require("../../../lib/blueprint/services/context_service");
const {
  getConnectorRequirements,
  authorizeConnector,
  listConnectorCatalog,
} = require("../../../lib/blueprint/services/connector_service");
const { listAccessibleWorkspaces } = require("../../../lib/blueprint/services/workspace_service");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendJson, sendHtml, readJsonBody, queryValue, parseCookies } = require("../../../lib/blueprint/http");
const { ensureCsrf } = require("../../../lib/blueprint/security");
const { BlueprintError } = require("../../../lib/blueprint/errors");

const connectorIdFromReq = (req) => {
  const raw = req?.query?.connectorId;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toJsLiteral = (value) =>
  JSON.stringify(value == null ? "" : String(value))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

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
    const method = String(req?.method || "GET").toUpperCase();
    const auth = requireAuthFromRequest(req);
    const connectorId = connectorIdFromReq(req);
    if (!connectorId) {
      throw new BlueprintError(400, "invalid_connector", "connectorId is required");
    }

    const workspaces = listAccessibleWorkspaces(auth.user.id);
    const workspaceId = String(queryValue(req, "workspaceId") || workspaces[0]?.id || "");
    const requirements = getConnectorRequirements({ connectorId, workspaceId });
    const connectors = listConnectorCatalog({
      actorUserId: auth.user.id,
      workspaceId,
    });

    if (method === "GET") {
      const origin = requestOrigin(req);
      const headerButtons = connectors
        .map((connector) => {
          const active = connector.id === requirements.id;
          const bg = active ? "#0b4f4a" : "#0f766e";
          return `<a data-header-install="${escapeHtml(connector.id)}" href="${escapeHtml(
            connector.actions.installConnectorUrl
          )}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;padding:7px 10px;border-radius:9px;font-weight:700;font-size:13px;">Install ${escapeHtml(
            connector.label
          )}</a>`;
        })
        .join("\n");

      const selectedConnector = connectors.find((item) => item.id === requirements.id) || null;
      const selectedConnections = Array.isArray(selectedConnector?.connections) ? selectedConnector.connections : [];
      const activeConnection = selectedConnections.find((item) => String(item?.status || "").toLowerCase() === "active") || null;

      const fields = Array.isArray(requirements.fields) ? requirements.fields : [];
      const fieldRows = fields
        .map(
          (field) => `<label style=\"display:block;margin:10px 0 4px;font-weight:600;\">${field.name}${
            field.required ? " *" : ""
          }</label>
<input name=\"${field.name}\" type=\"${field.type === "password" || field.type === "token" ? "password" : "text"}\" placeholder=\"${
            field.help || field.name
          }\" style=\"width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;\" />`
        )
        .join("\n");

      const existingConnectionRows = selectedConnections
        .map((connection) => {
          const status = String(connection?.status || "unknown");
          return `<li style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed #e5e7eb;">
  <span><code>${escapeHtml(connection.id)}</code> <small style="color:#4b5563;">(${escapeHtml(status)})</small></span>
  <button type="button" data-use-connection="${escapeHtml(
    connection.id
  )}" style="background:#111827;color:#ffffff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Use</button>
</li>`;
        })
        .join("");

      const html = `<!doctype html>
<html><body style=\"font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background:#f7fafc; color:#111827;\">
<div style=\"max-width:760px;margin:0 auto;background:#fff;padding:20px 22px;border:1px solid #e5e7eb;border-radius:14px;\">
<header style=\"border:1px solid #dbeafe;border-radius:12px;padding:12px;background:#eff6ff;margin:0 0 14px;\">
<p style=\"margin:0 0 8px;color:#1d4ed8;font-weight:700;\">Header Install APIs</p>
<div style=\"display:flex;flex-wrap:wrap;gap:8px;\">${headerButtons}</div>
</header>
<h1 style=\"margin:0 0 6px;\">Authorize ${requirements.label}</h1>
<p style=\"margin:0 0 12px;color:#4b5563;\">Workspace: <strong>${workspaceId || "(select workspaceId)"}</strong></p>
<p style=\"margin:0 0 12px;color:#1f2937;\">Required scopes: ${(requirements.scopes || []).join(", ") || "none"}</p>
<p style=\"margin:0 0 14px;\"><a href=\"${requirements.docsUrl || "#"}\" target=\"_blank\" rel=\"noreferrer\">Connector docs</a></p>
<section style=\"border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;padding:10px 12px;margin:0 0 14px;\">
  <h2 style=\"margin:0 0 8px;font-size:15px;\">Localhost Connect Flow</h2>
  <p style=\"margin:0 0 6px;color:#374151;\">Base URL: <code>${escapeHtml(origin)}</code></p>
  <p style=\"margin:0 0 6px;color:#374151;\">Install: <code>${escapeHtml(
    `${origin}${requirements.actions.installConnectorUrl}`
  )}</code></p>
  <p style=\"margin:0 0 6px;color:#374151;\">Requirements: <code>${escapeHtml(
    `${origin}${requirements.actions.requirementsUrl}`
  )}</code></p>
  <p style=\"margin:0;color:#374151;\">Test: <code>${escapeHtml(`${origin}${requirements.actions.testConnectorUrl}`)}</code></p>
</section>
<form id=\"install-form\" style=\"margin:0 0 10px;\">
${fieldRows || "<p>No credential fields required.</p>"}
<button type=\"submit\" style=\"margin-top:14px;background:#0f766e;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;\">Install Connector</button>
</form>
<section style=\"border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;padding:10px 12px;margin:0 0 10px;\">
  <h2 style=\"margin:0 0 8px;font-size:15px;\">Test Connection</h2>
  <label style=\"display:block;margin:0 0 4px;font-weight:600;\">Connection ID</label>
  <input id=\"connection-id\" value=\"${escapeHtml(activeConnection?.id || "")}\" placeholder=\"connection_xxx\" style=\"width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;\" />
  <div style=\"display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;\">
    <button id=\"test-connection\" type=\"button\" style=\"background:#0b4f4a;color:#ffffff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;\">Test Connection</button>
    <span id=\"test-hint\" style=\"color:#6b7280;font-size:12px;\">Install first, then test.</span>
  </div>
  <div style=\"margin-top:8px;\">
    <p style=\"margin:0 0 6px;color:#374151;\">Existing connections:</p>
    ${
      existingConnectionRows
        ? `<ul style="margin:0;padding:0;list-style:none;">${existingConnectionRows}</ul>`
        : `<p style="margin:0;color:#6b7280;">No connection yet for this connector in this workspace.</p>`
    }
  </div>
</section>
<pre id=\"result\" style=\"background:#0b1020;color:#d1fae5;padding:12px;border-radius:10px;min-height:72px;overflow:auto;\">Waiting for install...</pre>
<script>
  const form = document.getElementById('install-form');
  const result = document.getElementById('result');
  const testButton = document.getElementById('test-connection');
  const connectionInput = document.getElementById('connection-id');
  const testHint = document.getElementById('test-hint');
  const workspaceId = ${toJsLiteral(workspaceId)};
  const connectorId = ${toJsLiteral(requirements.id)};
  const getCookie = (name) => document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name + '='))?.split('=')[1] || '';
  const currentConnectionId = () => String(connectionInput && connectionInput.value || '').trim();
  const updateTestState = () => {
    const hasConnection = Boolean(currentConnectionId());
    testButton.disabled = !hasConnection;
    testButton.style.opacity = hasConnection ? '1' : '0.6';
    testHint.textContent = hasConnection ? 'Ready to run connector test.' : 'Install first, then test.';
  };

  updateTestState();
  connectionInput.addEventListener('input', updateTestState);

  document.querySelectorAll('[data-use-connection]').forEach((btn) => {
    btn.addEventListener('click', () => {
      connectionInput.value = String(btn.getAttribute('data-use-connection') || '').trim();
      updateTestState();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const credentials = {};
    formData.forEach((value, key) => {
      const text = String(value || '').trim();
      if (text) credentials[key] = text;
    });
    try {
      const csrf = decodeURIComponent(getCookie('bp_csrf'));
      const res = await fetch('/api/connectors/' + connectorId + '/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf
        },
        body: JSON.stringify({ workspaceId, credentials })
      });
      const payload = await res.json();
      if (payload && payload.connectionId) {
        connectionInput.value = String(payload.connectionId);
        updateTestState();
      }
      result.textContent = JSON.stringify(payload, null, 2);
    } catch (err) {
      result.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
    }
  });

  testButton.addEventListener('click', async () => {
    const connectionId = currentConnectionId();
    if (!connectionId) {
      updateTestState();
      return;
    }
    try {
      const csrf = decodeURIComponent(getCookie('bp_csrf'));
      const res = await fetch('/api/connectors/' + connectorId + '/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf
        },
        body: JSON.stringify({ workspaceId, connectionId })
      });
      const payload = await res.json();
      result.textContent = JSON.stringify(payload, null, 2);
    } catch (err) {
      result.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
    }
  });
</script>
</div>
</body></html>`;
      sendHtml(res, 200, html);
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });

    const body = (await readJsonBody(req)) || {};
    const bodyWorkspaceId = String(body?.workspaceId || queryValue(req, "workspaceId") || "").trim();
    if (!bodyWorkspaceId) {
      throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
    }

    const credentials = body?.credentials && typeof body.credentials === "object" ? body.credentials : body;

    const out = await authorizeConnector({
      connectorId,
      actorUserId: auth.user.id,
      workspaceId: bodyWorkspaceId,
      input: credentials,
    });

    sendJson(res, 200, {
      ok: true,
      connectorId: out.connectorId,
      connectionId: out.connectionId,
      requirements,
    });
  });
};
