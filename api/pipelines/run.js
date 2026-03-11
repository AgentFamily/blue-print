"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { runPipeline } = require("../../lib/blueprint/services/pipeline_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.pipelines.run" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const body = (await readJsonBody(req)) || {};
    const out = runPipeline({
      workspaceId: String(body?.workspaceId || "ws_core").trim() || "ws_core",
      pipelineId: body?.pipelineId,
      input: body?.input,
      createdBy: String(body?.createdBy || "settings-panel").trim() || "settings-panel",
    });

    sendJson(res, 201, { ok: true, ...out });
  });
};
