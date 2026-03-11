"use strict";

const { BlueprintError } = require("../errors");
const { createPipelineRun, listPipelineRuns } = require("../db");
const { computeTelemetrySummary } = require("./telemetry_service");
const { getServerPanel } = require("./server_control_service");

const PIPELINE_DEFINITIONS = Object.freeze([
  {
    id: "kpi-pipeline",
    aliases: ["kpi-monitor", "kpi_snapshot"],
    title: "KPI Pipeline",
    category: "Analytics",
    route: "/pipelines/kpi-pipeline",
    status: "active",
    inputs: ["workspaceId", "hours", "includeServerPanel"],
    outputs: ["telemetry_summary", "server_panel", "kpis"],
    actions: ["collect_telemetry", "calculate_kpis", "store_snapshot"],
  },
]);

const trimText = (value, maxLen = 240) => {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const normalizePipelineId = (value) => trimText(value, 120).toLowerCase();

const getPipelineDefinition = ({ pipelineId }) => {
  const wanted = normalizePipelineId(pipelineId);
  if (!wanted) {
    throw new BlueprintError(400, "invalid_pipeline", "pipelineId is required");
  }
  const match = PIPELINE_DEFINITIONS.find((item) => {
    if (item.id === wanted) return true;
    return Array.isArray(item.aliases) && item.aliases.includes(wanted);
  });
  if (!match) {
    const supported = PIPELINE_DEFINITIONS.map((item) => item.id).join(", ");
    throw new BlueprintError(404, "pipeline_not_found", `Unknown pipelineId. Expected one of: ${supported}`);
  }
  return match;
};

const toKpiSnapshot = ({ workspaceId, hours = 24, includeServerPanel = true }) => {
  const telemetry = computeTelemetrySummary({ hours });
  const serverPanel = includeServerPanel ? getServerPanel({ workspaceId }) : null;
  const pendingServerPlans = Array.isArray(serverPanel?.plans)
    ? serverPanel.plans.filter((item) => String(item?.status || "").toLowerCase() !== "completed").length
    : 0;

  return {
    hours,
    generatedAt: new Date().toISOString(),
    telemetry,
    serverPanel,
    kpis: {
      apiRequestCount: Number(telemetry?.api?.requestCount || 0),
      averageApiDurationMs:
        telemetry?.api?.status === "verified" ? Number(telemetry?.api?.averageDurationMs || 0) : null,
      routeSuccessRate:
        telemetry?.routes?.status === "verified" ? Number(telemetry?.routes?.successRate || 0) : null,
      routeFallbackRate:
        telemetry?.routes?.status === "verified" ? Number(telemetry?.routes?.fallbackRate || 0) : null,
      routeRecoveryRate:
        telemetry?.routes?.status === "verified" ? Number(telemetry?.routes?.recoveryRate || 0) : null,
      taskCompletionRate:
        telemetry?.tasks?.status === "verified" ? Number(telemetry?.tasks?.completionRate || 0) : null,
      taskEscalationRate:
        telemetry?.tasks?.status === "verified" ? Number(telemetry?.tasks?.escalationRate || 0) : null,
      widgetUseCount: Number(telemetry?.widgets?.useCount || 0),
      serverIndicator: trimText(serverPanel?.indicator, 40) || null,
      pendingServerPlans,
    },
  };
};

const serializePipelineRun = (row) => ({
  id: row.id,
  runId: row.runId || row.id,
  workspaceId: row.workspaceId,
  pipelineId: row.pipelineId,
  status: row.status,
  input: row.input || {},
  output: row.output || {},
  meta: row.meta || {},
  createdBy: row.createdBy || "",
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const runPipeline = ({
  workspaceId = "ws_core",
  pipelineId,
  input = {},
  createdBy = "settings-panel",
}) => {
  const definition = getPipelineDefinition({ pipelineId });
  const payload = input && typeof input === "object" ? input : {};
  const hoursRaw = Number.parseInt(String(payload?.hours || "24"), 10);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : 24;
  const includeServerPanel = payload?.includeServerPanel !== false;

  let output = {};
  if (definition.id === "kpi-pipeline") {
    output = toKpiSnapshot({ workspaceId, hours, includeServerPanel });
  }

  const row = createPipelineRun({
    workspaceId,
    pipelineId: definition.id,
    status: "completed",
    input: {
      hours,
      includeServerPanel,
      ...(payload && typeof payload === "object" ? payload : {}),
    },
    output,
    meta: {
      title: definition.title,
      category: definition.category,
    },
    createdBy: trimText(createdBy, 120) || "settings-panel",
  });

  return {
    pipeline: definition,
    run: serializePipelineRun(row),
  };
};

const getPipelineRuns = ({
  workspaceId = "",
  pipelineId = "",
  limit = 20,
} = {}) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20) || 20));
  return listPipelineRuns({
    workspaceId: trimText(workspaceId, 80),
    pipelineId: normalizePipelineId(pipelineId),
    limit: safeLimit,
  }).map((row) => serializePipelineRun(row));
};

module.exports = {
  PIPELINE_DEFINITIONS,
  getPipelineDefinition,
  getPipelineRuns,
  runPipeline,
};
