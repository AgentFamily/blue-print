"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, queryValue } = require("../../lib/blueprint/http");
const {
  recordBrowserJournalEntry,
  listJournal,
  rollupBrowserTranscript,
} = require("../../lib/blueprint/services/browser_journal_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.browser.journal" }, async () => {
    const method = String(req?.method || "GET").toUpperCase();

    if (method === "GET") {
      const workspaceId = String(queryValue(req, "workspaceId") || "ws_core").trim() || "ws_core";
      const sessionId = String(queryValue(req, "sessionId") || "").trim();
      const limit = Number.parseInt(String(queryValue(req, "limit") || "50"), 10);
      const entries = listJournal({ workspaceId, sessionId, limit });
      sendJson(res, 200, { ok: true, entries });
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "ws_core").trim() || "ws_core";
    const event = String(body?.event || "").trim().toLowerCase();
    if (event === "rollup") {
      const out = rollupBrowserTranscript({
        workspaceId,
        sessionId: body?.sessionId,
        dayKey: body?.dayKey,
        createdBy: String(body?.createdBy || "browser").trim() || "browser",
      });
      sendJson(res, 200, { ok: true, transcript: out.transcript, entries: out.entries });
      return;
    }

    const entry = recordBrowserJournalEntry({
      workspaceId,
      sessionId: body?.sessionId,
      url: body?.url,
      title: body?.title,
      mode: body?.mode,
      action: body?.action,
      result: body?.result,
      handoffKind: body?.handoffKind,
      meta: body?.meta,
      createdBy: String(body?.createdBy || "browser").trim() || "browser",
    });
    sendJson(res, 201, { ok: true, entry });
  });
};
