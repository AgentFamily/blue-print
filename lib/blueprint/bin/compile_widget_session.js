"use strict";

const { compileWorkspaceSession } = require("../services/widget_rendering_stove_service");

const readStdin = async () => {
  let raw = "";
  await new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", resolve);
  });
  return raw;
};

const main = async () => {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(JSON.stringify({
      ok: false,
      status: 400,
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    }));
    return;
  }

  try {
    const result = compileWorkspaceSession({
      actorUserId: String(payload?.actorUserId || "usr_demo").trim() || "usr_demo",
      workspaceId: payload?.workspaceId,
      taskType: payload?.taskType,
      taskGoal: payload?.taskGoal,
      agentRole: payload?.agentRole,
      sessionPermissions: payload?.sessionPermissions,
      availableApis: payload?.availableApis,
      currentDesktopState: payload?.currentDesktopState,
      currentSessionState: payload?.currentSessionState,
      savedWorkspaceTemplates: payload?.savedWorkspaceTemplates,
      templateId: payload?.templateId,
      allowAutomation: payload?.allowAutomation,
      agents: payload?.agents,
    });
    process.stdout.write(JSON.stringify({ status: 200, ...result }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      status: Number(err?.status || 500) || 500,
      error: String(err?.code || "internal_error"),
      message: String(err?.message || "Internal error"),
    }));
  }
};

void main();
