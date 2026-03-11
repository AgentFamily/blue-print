"use strict";

const { addBrowserJournalEntry, listBrowserJournalEntries } = require("../db");
const { createSystemVaultRecord } = require("./vault_record_service");

const trimText = (value, maxLen = 400) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const normalizeMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "live" || mode === "mirror" || mode === "reader" || mode === "safari" || mode === "smart" || mode === "external") {
    return mode;
  }
  return "smart";
};

const normalizeDayKey = (value) => {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = value ? new Date(value) : new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const recordBrowserJournalEntry = ({
  workspaceId = "ws_core",
  sessionId = "",
  url = "",
  title = "",
  mode = "smart",
  action = "navigate",
  result = "ok",
  handoffKind = "",
  meta = {},
  createdBy = "system",
}) => {
  return addBrowserJournalEntry({
    workspaceId,
    sessionId,
    url: trimText(url, 1000),
    title: trimText(title, 240),
    mode: normalizeMode(mode),
    action: trimText(action, 80).toLowerCase() || "navigate",
    result: trimText(result, 80).toLowerCase() || "ok",
    handoffKind: trimText(handoffKind, 80).toLowerCase(),
    meta: meta && typeof meta === "object" ? meta : {},
    createdBy,
  });
};

const listJournal = ({ workspaceId = "ws_core", sessionId = "", limit = 50 } = {}) =>
  listBrowserJournalEntries({
    workspaceId,
    sessionId,
    limit: Math.max(1, Math.min(500, Number(limit || 50) || 50)),
  });

const rollupBrowserTranscript = ({
  workspaceId = "ws_core",
  sessionId = "",
  dayKey = "",
  createdBy = "system",
}) => {
  const targetDay = normalizeDayKey(dayKey || new Date());
  const entries = listJournal({ workspaceId, sessionId, limit: 1000 }).filter((item) =>
    normalizeDayKey(item.createdAt) === targetDay
  );
  const transcript = createSystemVaultRecord({
    workspaceId,
    recordType: "browser_transcript",
    title: `Browser transcript ${targetDay}`,
    status: "active",
    payload: {
      dayKey: targetDay,
      sessionId: trimText(sessionId, 120),
      entryCount: entries.length,
      entries: entries.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        url: item.url,
        title: item.title,
        mode: item.mode,
        action: item.action,
        result: item.result,
        handoffKind: item.handoffKind,
      })),
    },
    meta: {
      dayKey: targetDay,
      sessionId: trimText(sessionId, 120),
    },
    createdBy,
  });
  return {
    transcript,
    entries,
  };
};

module.exports = {
  recordBrowserJournalEntry,
  listJournal,
  rollupBrowserTranscript,
};
