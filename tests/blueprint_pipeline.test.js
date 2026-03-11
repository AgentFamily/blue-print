const path = require("path");

process.env.BLUEPRINT_TELEMETRY_FILE = path.join(
  __dirname,
  "..",
  "tmp",
  "blueprint-telemetry-tests",
  "pipeline-service.jsonl"
);
process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const {
  recordTelemetryEvents,
  resetTelemetryStore,
} = require("../lib/blueprint/services/telemetry_service");
const { prepareServerAction } = require("../lib/blueprint/services/server_control_service");
const { runPipeline } = require("../lib/blueprint/services/pipeline_service");
const runPipelineHandler = require("../api/pipelines/run.js");
const listPipelineRunsHandler = require("../api/pipelines/runs.js");
const { callHandler } = require("./test_utils");

test("kpi pipeline run api stores a completed telemetry snapshot", async () => {
  resetBlueprintDb();
  resetTelemetryStore();

  recordTelemetryEvents([
    {
      eventType: "api.request",
      routeId: "api.telemetry.summary",
      method: "GET",
      httpStatus: 200,
    },
    {
      eventType: "route.execution",
      routeId: "route.analytics",
      routeRunId: "run_analytics_1",
      outcome: "start",
    },
    {
      eventType: "route.execution",
      routeId: "route.analytics",
      routeRunId: "run_analytics_1",
      outcome: "success",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_analytics_1",
      outcome: "queued",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_analytics_1",
      outcome: "completed",
    },
  ]);

  const created = await callHandler(runPipelineHandler, {
    method: "POST",
    body: {
      workspaceId: "ws_core",
      pipelineId: "kpi-monitor",
      input: {
        hours: 24,
      },
    },
  });

  assert.equal(created.statusCode, 201);
  const createdJson = JSON.parse(created.body);
  assert.equal(createdJson.ok, true);
  assert.equal(createdJson.pipeline.id, "kpi-pipeline");
  assert.equal(createdJson.run.pipelineId, "kpi-pipeline");
  assert.equal(createdJson.run.status, "completed");
  assert.equal(createdJson.run.output.kpis.routeSuccessRate, 100);
  assert.equal(createdJson.run.output.kpis.taskCompletionRate, 100);
  assert.equal(createdJson.run.output.kpis.serverIndicator, "green");

  const listed = await callHandler(listPipelineRunsHandler, {
    method: "GET",
    url: "/api/pipelines/runs?workspaceId=ws_core",
  });

  assert.equal(listed.statusCode, 200);
  const listedJson = JSON.parse(listed.body);
  assert.equal(Array.isArray(listedJson), true);
  assert.equal(listedJson.length, 1);
  assert.equal(listedJson[0].runId, createdJson.run.runId);
});

test("kpi pipeline snapshot includes pending server plan count", () => {
  resetBlueprintDb();
  resetTelemetryStore();

  prepareServerAction({
    workspaceId: "ws_core",
    actionId: "open_access_5m",
    createdBy: "system",
  });

  const out = runPipeline({
    workspaceId: "ws_core",
    pipelineId: "kpi-pipeline",
    input: {
      hours: 24,
    },
    createdBy: "test",
  });

  assert.equal(out.run.status, "completed");
  assert.equal(out.run.output.kpis.pendingServerPlans, 1);
  assert.equal(out.run.output.kpis.serverIndicator, "amber");
});
