"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../lib/blueprint/http");
const { getPipelineRuns } = require("../../lib/blueprint/services/pipeline_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.pipelines.runs" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const runs = getPipelineRuns({
      workspaceId: String(queryValue(req, "workspaceId") || "ws_core").trim() || "ws_core",
      pipelineId: queryValue(req, "pipelineId"),
      limit: Number.parseInt(String(queryValue(req, "limit") || "20"), 10),
    });
    sendJson(res, 200, runs);
  });
};
