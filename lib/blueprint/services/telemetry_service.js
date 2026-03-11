"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TELEMETRY_SCHEMA_VERSION = "blueprint.telemetry.v1";
const DEFAULT_TELEMETRY_ROOT = path.resolve(__dirname, "../../../tmp/blueprint-telemetry");
const TELEMETRY_ROOT = path.resolve(
  process.env.BLUEPRINT_TELEMETRY_ROOT ||
    (process.env.BLUEPRINT_TELEMETRY_FILE ? path.dirname(process.env.BLUEPRINT_TELEMETRY_FILE) : DEFAULT_TELEMETRY_ROOT)
);
const TELEMETRY_FILE = path.resolve(process.env.BLUEPRINT_TELEMETRY_FILE || path.join(TELEMETRY_ROOT, "events.jsonl"));

const ONE_HOUR_MS = 60 * 60 * 1000;
const TERMINAL_TASK_OUTCOMES = new Set(["completed", "failed", "escalated", "cancelled"]);
const ROUTE_OUTCOMES = new Set(["start", "success", "fallback", "failure", "recovery"]);

const nowIso = () => new Date().toISOString();

const roundRate = (numerator, denominator) => {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  if (!(d > 0)) return null;
  return Math.round((n / d) * 1000) / 10;
};

const toFiniteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const trimString = (value, maxLen = 240) => {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const safeJsonValue = (value, depth = 0) => {
  if (value == null) return null;
  if (depth > 4) return null;
  if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).slice(0, 50)) {
      const item = safeJsonValue(value[key], depth + 1);
      if (item !== undefined) out[key] = item;
    }
    return out;
  }
  return String(value);
};

const asIsoString = (value) => {
  if (!value) return nowIso();
  const dt = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(dt.getTime())) return nowIso();
  return dt.toISOString();
};

const toMillis = (value) => {
  if (!value) return 0;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
};

const ensureStore = () => {
  fs.mkdirSync(TELEMETRY_ROOT, { recursive: true });
  if (!fs.existsSync(TELEMETRY_FILE)) {
    fs.writeFileSync(TELEMETRY_FILE, "", "utf8");
  }
};

const createTelemetryId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
};

const normalizeEvent = (rawEvent, defaults = {}) => {
  const source = trimString(rawEvent?.source || defaults?.source || "unknown", 80);
  const eventType = trimString(rawEvent?.eventType || rawEvent?.type || defaults?.eventType || "", 120);
  if (!eventType) return null;

  const occurredAt = asIsoString(rawEvent?.occurredAt || rawEvent?.timestamp || defaults?.occurredAt);
  const normalized = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: trimString(rawEvent?.eventId || rawEvent?.id || "", 120) || createTelemetryId(),
    eventType,
    source,
    occurredAt,
    verified: rawEvent?.verified === false ? false : true,
  };

  const stringFields = [
    "routeId",
    "routeRunId",
    "taskId",
    "taskState",
    "widgetId",
    "workspaceId",
    "userId",
    "laneId",
    "tabId",
    "host",
    "url",
    "method",
    "outcome",
    "reason",
    "status",
  ];
  for (const field of stringFields) {
    const value = trimString(rawEvent?.[field] || defaults?.[field], field === "url" ? 1000 : 240);
    if (value) normalized[field] = value;
  }

  const httpStatus = toFiniteNumber(rawEvent?.httpStatus ?? defaults?.httpStatus, 0);
  if (httpStatus > 0) normalized.httpStatus = httpStatus;

  const durationMs = toFiniteNumber(rawEvent?.durationMs ?? defaults?.durationMs, 0);
  if (durationMs >= 0) normalized.durationMs = Math.round(durationMs);

  const sampleSize = toFiniteNumber(rawEvent?.sampleSize ?? defaults?.sampleSize, 0);
  if (sampleSize > 0) normalized.sampleSize = Math.round(sampleSize);

  const meta = safeJsonValue(rawEvent?.meta ?? defaults?.meta);
  if (meta && typeof meta === "object" && Object.keys(meta).length) {
    normalized.meta = meta;
  }

  return normalized;
};

const appendNormalizedEvents = (events) => {
  const rows = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!rows.length) return [];
  ensureStore();
  const payload = rows.map((event) => JSON.stringify(event)).join("\n") + "\n";
  fs.appendFileSync(TELEMETRY_FILE, payload, "utf8");
  return rows;
};

const recordTelemetryEvent = (rawEvent, defaults = {}) => {
  const normalized = normalizeEvent(rawEvent, defaults);
  if (!normalized) return null;
  appendNormalizedEvents([normalized]);
  return normalized;
};

const recordTelemetryEvents = (rawEvents, defaults = {}) => {
  const rows = Array.isArray(rawEvents) ? rawEvents : [];
  const normalized = rows.map((event) => normalizeEvent(event, defaults)).filter(Boolean);
  return appendNormalizedEvents(normalized);
};

const readTelemetryEvents = ({ sinceMs = 0, untilMs = 0, limit = 0 } = {}) => {
  ensureStore();
  const text = fs.readFileSync(TELEMETRY_FILE, "utf8");
  if (!text.trim()) return [];

  const out = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const chunk = line.trim();
    if (!chunk) continue;
    try {
      const event = JSON.parse(chunk);
      const atMs = toMillis(event?.occurredAt);
      if (sinceMs > 0 && atMs > 0 && atMs < sinceMs) continue;
      if (untilMs > 0 && atMs > 0 && atMs > untilMs) continue;
      out.push(event);
    } catch {
      // Ignore corrupt rows to preserve append-only history.
    }
  }

  if (limit > 0 && out.length > limit) {
    return out.slice(out.length - limit);
  }
  return out;
};

const latestIso = (events) => {
  let latest = 0;
  for (const event of events) {
    latest = Math.max(latest, toMillis(event?.occurredAt));
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
};

const eventCountBy = (events, field) => {
  const counts = Object.create(null);
  for (const event of events) {
    const key = trimString(event?.[field] || "unknown", 240) || "unknown";
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
};

const summarizeApiRequests = (events) => {
  const rows = events.filter((event) => event?.eventType === "api.request" && event?.verified !== false);
  const durationRows = rows
    .map((event) => Number(event?.durationMs || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const averageDurationMs = durationRows.length
    ? Math.round(durationRows.reduce((sum, value) => sum + value, 0) / durationRows.length)
    : null;
  return {
    status: rows.length ? "verified" : "insufficient_data",
    sampleSize: rows.length,
    latestAt: latestIso(rows),
    requestCount: rows.length,
    averageDurationMs,
    routes: eventCountBy(rows, "routeId").slice(0, 20),
    methods: eventCountBy(rows, "method").slice(0, 10),
  };
};

const summarizeRouteExecutions = (events) => {
  const rows = events.filter((event) => event?.eventType === "route.execution" && event?.verified !== false);
  const counts = {
    start: 0,
    success: 0,
    fallback: 0,
    failure: 0,
    recovery: 0,
  };
  for (const event of rows) {
    const outcome = trimString(event?.outcome || "", 40).toLowerCase();
    if (ROUTE_OUTCOMES.has(outcome)) counts[outcome] += 1;
  }

  const startedCount = counts.start || counts.success + counts.failure + counts.fallback;
  const terminalCount = counts.success + counts.failure;
  return {
    status: rows.length ? "verified" : "insufficient_data",
    sampleSize: rows.length,
    latestAt: latestIso(rows),
    counts,
    successRate: roundRate(counts.success, Math.max(startedCount, terminalCount)),
    fallbackRate: roundRate(counts.fallback, startedCount),
    recoveryRate: roundRate(counts.recovery, counts.fallback),
    routes: eventCountBy(rows, "routeId").slice(0, 20),
  };
};

const summarizeTasks = (events) => {
  const rows = events.filter((event) => event?.eventType === "task.lifecycle" && event?.verified !== false);
  const byState = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    escalated: 0,
    cancelled: 0,
  };
  const terminalByTask = new Map();

  for (const event of rows) {
    const outcome = trimString(event?.outcome || event?.taskState || "", 40).toLowerCase();
    if (outcome && Object.prototype.hasOwnProperty.call(byState, outcome)) {
      byState[outcome] += 1;
    }
    if (!TERMINAL_TASK_OUTCOMES.has(outcome)) continue;
    const key = trimString(event?.taskId || event?.routeRunId || event?.eventId, 240);
    if (!key) continue;
    const prev = terminalByTask.get(key);
    if (!prev || toMillis(event?.occurredAt) >= toMillis(prev?.occurredAt)) {
      terminalByTask.set(key, event);
    }
  }

  let completedCount = 0;
  let failedCount = 0;
  let escalatedCount = 0;
  let cancelledCount = 0;
  for (const event of terminalByTask.values()) {
    const outcome = trimString(event?.outcome || event?.taskState || "", 40).toLowerCase();
    if (outcome === "completed") completedCount += 1;
    if (outcome === "failed") failedCount += 1;
    if (outcome === "escalated") escalatedCount += 1;
    if (outcome === "cancelled") cancelledCount += 1;
  }

  const terminalCount = terminalByTask.size;
  return {
    status: terminalCount ? "verified" : "insufficient_data",
    sampleSize: rows.length,
    terminalCount,
    latestAt: latestIso(rows),
    counts: {
      ...byState,
      completedTerminal: completedCount,
      failedTerminal: failedCount,
      escalatedTerminal: escalatedCount,
      cancelledTerminal: cancelledCount,
    },
    completionRate: roundRate(completedCount, terminalCount),
    escalationRate: roundRate(escalatedCount, terminalCount),
  };
};

const summarizeWidgets = (events) => {
  const rows = events.filter(
    (event) =>
      (event?.eventType === "widget.visibility" || event?.eventType === "widget.use") && event?.verified !== false
  );
  const visible = rows.filter((event) => event?.eventType === "widget.visibility");
  const used = rows.filter((event) => event?.eventType === "widget.use");
  return {
    status: rows.length ? "verified" : "insufficient_data",
    sampleSize: rows.length,
    latestAt: latestIso(rows),
    visibleCount: visible.length,
    useCount: used.length,
    widgets: eventCountBy(rows, "widgetId").slice(0, 20),
  };
};

const summarizeEvents = (events, { hours = 24, now = new Date() } = {}) => {
  const endAt = asIsoString(now);
  const startAt = asIsoString(new Date(toMillis(now) - Math.max(1, hours) * ONE_HOUR_MS));
  return {
    ok: true,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    generatedAt: nowIso(),
    window: {
      hours: Math.max(1, Math.round(hours)),
      startAt,
      endAt,
    },
    totals: {
      events: events.length,
      latestAt: latestIso(events),
    },
    api: summarizeApiRequests(events),
    routes: summarizeRouteExecutions(events),
    tasks: summarizeTasks(events),
    widgets: summarizeWidgets(events),
  };
};

const computeTelemetrySummary = ({ hours = 24, now = new Date(), limit = 0 } = {}) => {
  const endMs = toMillis(now);
  const safeHours = Math.max(1, Math.min(24 * 30, Math.round(toFiniteNumber(hours, 24))));
  const startMs = endMs - safeHours * ONE_HOUR_MS;
  const events = readTelemetryEvents({ sinceMs: startMs, untilMs: endMs, limit });
  return summarizeEvents(events, { hours: safeHours, now });
};

const resetTelemetryStore = () => {
  ensureStore();
  fs.writeFileSync(TELEMETRY_FILE, "", "utf8");
};

module.exports = {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_FILE,
  normalizeEvent,
  recordTelemetryEvent,
  recordTelemetryEvents,
  readTelemetryEvents,
  summarizeEvents,
  computeTelemetrySummary,
  resetTelemetryStore,
};
