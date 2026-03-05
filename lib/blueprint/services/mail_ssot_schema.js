"use strict";

const { BlueprintError } = require("../errors");

const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|authorization|auth)/i;

const cleanText = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, Math.max(1, max || 160));

const cleanIso = (value) => {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
};

const cleanDateYmd = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()) ? String(value).trim() : "");

const cleanOwner = (value) => (String(value || "").toLowerCase() === "codex" ? "codex" : "me");
const cleanTaskStatus = (value) => (String(value || "").toLowerCase() === "done" ? "done" : "todo");
const cleanPriority = (value) => {
  const v = String(value || "").toLowerCase();
  if (v === "high") return "high";
  if (v === "low") return "low";
  return "normal";
};

const stripSecretKeys = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripSecretKeys(item));
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(String(key || ""))) continue;
    out[key] = stripSecretKeys(raw);
  }
  return out;
};

const normalizeConnectorRef = (input) => {
  const source = input && typeof input === "object" ? input : {};
  const workspaceId = cleanText(source.workspaceId, 120);
  const connectionId = cleanText(source.connectionId, 120);
  if (!workspaceId || !connectionId) return null;
  return {
    type: "blueprint_connection",
    workspaceId,
    connectorId: "mailbox",
    connectionId,
  };
};

const normalizeStrategicTask = (input, index) => {
  const source = input && typeof input === "object" ? input : {};
  const title = cleanText(source.title, 220);
  if (!title) return null;
  const createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now();
  return {
    id: cleanText(source.id || `strategy_${createdAt}_${index}`, 120),
    title,
    owner: cleanOwner(source.owner),
    due: cleanDateYmd(source.due),
    done: Boolean(source.done),
    createdAt,
  };
};

const normalizeFollowupTask = (input, index) => {
  const source = input && typeof input === "object" ? input : {};
  const title = cleanText(source.title, 220);
  if (!title) return null;
  const createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : createdAt;
  return {
    id: cleanText(source.id || `followup_${createdAt}_${index}`, 120),
    title,
    dueAt: cleanIso(source.dueAt),
    status: cleanTaskStatus(source.status),
    priority: cleanPriority(source.priority),
    notes: cleanText(source.notes, 260),
    source: cleanText(source.source, 80) || "manual",
    createdAt,
    updatedAt,
  };
};

const sanitizeSnapshotV1 = (input) => {
  const source = stripSecretKeys(input && typeof input === "object" ? input : {});
  const refsRaw = Array.isArray(source.connectorRefs) ? source.connectorRefs : [];
  const connectorRefs = refsRaw.map((row) => normalizeConnectorRef(row)).filter(Boolean).slice(0, 20);
  if (!connectorRefs.length) {
    throw new BlueprintError(400, "validation", "connectorRefs must include at least one mailbox connection");
  }

  const strategicRaw = source.strategic && typeof source.strategic === "object" ? source.strategic : {};
  const strategicDraftRaw = strategicRaw.draft && typeof strategicRaw.draft === "object" ? strategicRaw.draft : {};
  const strategicTasksRaw = Array.isArray(strategicRaw.tasks) ? strategicRaw.tasks : [];
  const strategicTasks = strategicTasksRaw.map((task, index) => normalizeStrategicTask(task, index)).filter(Boolean).slice(0, 240);

  const followupsRaw = source.followups && typeof source.followups === "object" ? source.followups : {};
  const followupTasksRaw = Array.isArray(followupsRaw.tasks) ? followupsRaw.tasks : [];
  const followupTasks = followupTasksRaw.map((task, index) => normalizeFollowupTask(task, index)).filter(Boolean).slice(0, 300);

  const mailMemoryRaw = source.mailMemory && typeof source.mailMemory === "object" ? source.mailMemory : {};
  const mailEvents = Array.isArray(mailMemoryRaw.events)
    ? stripSecretKeys(mailMemoryRaw.events).slice(0, 160)
    : [];

  const horizonRaw = String(strategicDraftRaw.horizon || "").trim();
  const horizon = ["14", "30", "60", "90"].includes(horizonRaw) ? horizonRaw : "30";
  const capturedAt = cleanIso(source.capturedAt) || new Date().toISOString();
  const revisionRaw = Number.parseInt(String(source.revision || ""), 10);
  const revision = Number.isFinite(revisionRaw) && revisionRaw > 0 ? revisionRaw : 1;

  return {
    schema: "agentc.mailssot.snapshot.v1",
    planId: cleanText(source.planId, 120) || "default-plan",
    revision,
    capturedAt,
    connectorRefs,
    strategic: {
      draft: {
        objective: cleanText(strategicDraftRaw.objective, 220),
        metric: cleanText(strategicDraftRaw.metric, 220),
        horizon,
        constraints: cleanText(strategicDraftRaw.constraints, 4000),
        plan: cleanText(strategicDraftRaw.plan, 24000),
      },
      tasks: strategicTasks,
    },
    followups: {
      tasks: followupTasks,
    },
    mailMemory: {
      userEmail: cleanText(mailMemoryRaw.userEmail, 220).toLowerCase(),
      botEmail: cleanText(mailMemoryRaw.botEmail, 220).toLowerCase(),
      channel: cleanText(mailMemoryRaw.channel, 120),
      events: mailEvents,
    },
  };
};

module.exports = {
  SECRET_KEY_PATTERN,
  stripSecretKeys,
  sanitizeSnapshotV1,
};
