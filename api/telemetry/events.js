"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { BlueprintError } = require("../../lib/blueprint/errors");
const { recordTelemetryEvents } = require("../../lib/blueprint/services/telemetry_service");

module.exports = async (req, res) => {
  await handleRoute(
    res,
    {
      routeId: "api.telemetry.events",
      skipResponseTelemetry: true,
    },
    async () => {
      if (String(req?.method || "GET").toUpperCase() !== "POST") {
        methodNotAllowed(res, "POST");
        return;
      }

      const body = (await readJsonBody(req)) || {};
      const events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [];
      if (!events.length) {
        throw new BlueprintError(400, "invalid_input", "events[] is required");
      }

      const source = String(body?.source || req?.headers?.["x-blueprint-telemetry-source"] || "toolbox_client").trim();
      const recorded = recordTelemetryEvents(events, { source });
      sendJson(res, 202, {
        ok: true,
        accepted: recorded.length,
        schemaVersion: recorded[0]?.schemaVersion || null,
      });
    }
  );
};
