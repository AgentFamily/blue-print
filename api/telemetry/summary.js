"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../lib/blueprint/http");
const { computeTelemetrySummary } = require("../../lib/blueprint/services/telemetry_service");

module.exports = async (req, res) => {
  await handleRoute(
    res,
    {
      routeId: "api.telemetry.summary",
      skipResponseTelemetry: true,
    },
    async () => {
      if (String(req?.method || "GET").toUpperCase() !== "GET") {
        methodNotAllowed(res, "GET");
        return;
      }

      const hours = Number.parseInt(String(queryValue(req, "hours") || "24"), 10);
      const limit = Number.parseInt(String(queryValue(req, "limit") || "0"), 10);
      const summary = computeTelemetrySummary({
        hours: Number.isFinite(hours) ? hours : 24,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
      });
      sendJson(res, 200, summary);
    }
  );
};
