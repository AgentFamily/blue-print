"use strict";

const ROLE_VALUES = new Set(["user", "admin"]);

function normalizeRole(value) {
  const v = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(v) ? v : "user";
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function isRoleAllowed(widgetDef, role) {
  const list = Array.isArray(widgetDef?.allowedRoles) ? widgetDef.allowedRoles : [];
  return list.includes(normalizeRole(role));
}

function presetWidthForSize(size, cols) {
  const key = String(size || "").trim().toLowerCase();
  if (key === "small") return Math.max(1, Math.round(cols * 0.34));
  if (key === "medium") return Math.max(1, Math.round(cols * 0.5));
  return cols;
}

function defaultWidgetRecord(widgetDef, index, role) {
  const cols = 12;
  const width = Math.min(cols, presetWidthForSize(widgetDef.defaultSize, cols));
  const height = Math.max(1, Number(widgetDef?.defaultProps?.defaultH || 12));
  return {
    id: widgetDef.id,
    x: 0,
    y: index * Math.max(2, height),
    w: width,
    h: height,
    enabled: isRoleAllowed(widgetDef, role),
    settings: {
      title: String(widgetDef?.defaultProps?.title || ""),
      refreshSec: Number(widgetDef?.defaultProps?.refreshSec || 0),
      visible: true,
      size: String(widgetDef.defaultSize || "large").toLowerCase()
    }
  };
}

function normalizeWidgetRecord(rawRecord, widgetDef, fallbackIndex, role) {
  const fallback = defaultWidgetRecord(widgetDef, fallbackIndex, role);
  const source = rawRecord && typeof rawRecord === "object" ? rawRecord : {};
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const minW = Math.max(1, Number(widgetDef?.constraints?.minW || 1));
  const maxW = Math.max(minW, Number(widgetDef?.constraints?.maxW || 12));
  const minH = Math.max(1, Number(widgetDef?.constraints?.minH || 1));
  const maxH = Math.max(minH, Number(widgetDef?.constraints?.maxH || 96));

  const merged = {
    id: widgetDef.id,
    x: clampInt(source.x, 0, 12),
    y: clampInt(source.y, 0, 99999),
    w: clampInt(source.w, minW, 12),
    h: clampInt(source.h, minH, maxH),
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    settings: {
      title: String(settings.title || fallback.settings.title || "").slice(0, 140),
      refreshSec: Math.max(0, clampInt(settings.refreshSec, 0, 86400)),
      visible: typeof settings.visible === "boolean" ? settings.visible : fallback.settings.visible,
      size: ["small", "medium", "large", "custom"].includes(String(settings.size || "").toLowerCase())
        ? String(settings.size || "").toLowerCase()
        : fallback.settings.size
    }
  };

  merged.w = Math.max(minW, Math.min(maxW, merged.w));

  merged.h = Math.max(minH, Math.min(maxH, merged.h));

  return merged;
}

function normalizeWidgetOrder(list) {
  const enabled = list.filter((item) => item.enabled);
  const disabled = list.filter((item) => !item.enabled);
  let cursor = 0;
  for (const item of enabled) {
    item.x = 0;
    item.y = cursor;
    cursor += Math.max(1, Number(item.h || 1));
  }
  return [...enabled, ...disabled];
}

function buildDefaultLayout(registry, role, version = 1) {
  const r = normalizeRole(role);
  const widgets = [];
  let idx = 0;
  for (const def of registry) {
    if (!isRoleAllowed(def, r)) continue;
    widgets.push(defaultWidgetRecord(def, idx, r));
    idx += 1;
  }
  return {
    version: Math.max(1, Number(version || 1)),
    role: r,
    updatedAt: 0,
    widgets
  };
}

function migrateLayout(rawLayout, registry, role, version = 1) {
  const r = normalizeRole(role);
  const fallback = buildDefaultLayout(registry, r, version);
  if (!rawLayout || typeof rawLayout !== "object") return fallback;
  const incoming = Array.isArray(rawLayout.widgets) ? rawLayout.widgets : [];
  const incomingById = new Map(
    incoming
      .filter((item) => item && typeof item === "object" && String(item.id || "").trim())
      .map((item) => [String(item.id).trim(), item])
  );

  const widgets = [];
  let idx = 0;
  for (const def of registry) {
    if (!isRoleAllowed(def, r)) continue;
    widgets.push(normalizeWidgetRecord(incomingById.get(def.id), def, idx, r));
    idx += 1;
  }

  widgets.sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
  return {
    version: Math.max(1, Number(version || 1)),
    role: r,
    updatedAt: Math.max(0, Number(rawLayout?.updatedAt || 0)),
    widgets: normalizeWidgetOrder(widgets)
  };
}

function applyWidgetSettings(layout, registry, widgetId, draft) {
  if (!layout || !Array.isArray(layout.widgets)) return false;
  const record = layout.widgets.find((item) => item.id === widgetId);
  const def = registry.find((item) => item.id === widgetId);
  if (!record || !def) return false;

  const settings = draft && typeof draft === "object" ? draft : {};
  record.settings = record.settings || {};
  record.settings.title = String(settings.title || "").trim().slice(0, 140);
  record.settings.visible = typeof settings.visible === "boolean" ? settings.visible : record.settings.visible !== false;
  record.settings.refreshSec = Math.max(0, clampInt(settings.refreshSec, 0, 86400));
  const nextSize = String(settings.size || record.settings.size || "custom").toLowerCase();
  record.settings.size = ["small", "medium", "large", "custom"].includes(nextSize) ? nextSize : "custom";

  const minW = Math.max(1, Number(def?.constraints?.minW || 1));
  const maxW = Math.max(minW, Number(def?.constraints?.maxW || 12));
  const minH = Math.max(1, Number(def?.constraints?.minH || 1));
  const maxH = Math.max(minH, Number(def?.constraints?.maxH || 96));

  if (record.settings.size === "small" || record.settings.size === "medium" || record.settings.size === "large") {
    record.w = presetWidthForSize(record.settings.size, 12);
    const defaultH = Math.max(1, Number(def?.defaultProps?.defaultH || 10));
    if (record.settings.size === "small") record.h = Math.max(1, Math.round(defaultH * 0.8));
    else if (record.settings.size === "medium") record.h = Math.max(1, Math.round(defaultH * 0.92));
    else record.h = defaultH;
  } else {
    record.w = clampInt(settings.w, minW, maxW);
    record.h = clampInt(settings.h, minH, maxH);
  }

  record.w = Math.max(minW, Math.min(maxW, record.w));
  record.h = Math.max(minH, Math.min(maxH, record.h));
  layout.updatedAt = Date.now();
  return true;
}

function reorderEnabledWidgets(layout, dragId, targetId, before) {
  if (!layout || !Array.isArray(layout.widgets)) return false;
  const drag = String(dragId || "").trim();
  const target = String(targetId || "").trim();
  if (!drag || !target || drag === target) return false;

  const enabled = layout.widgets.filter((item) => item.enabled);
  const disabled = layout.widgets.filter((item) => !item.enabled);
  const fromIdx = enabled.findIndex((item) => item.id === drag);
  const toIdx = enabled.findIndex((item) => item.id === target);
  if (fromIdx < 0 || toIdx < 0) return false;

  const [dragged] = enabled.splice(fromIdx, 1);
  let insertAt = enabled.findIndex((item) => item.id === target);
  if (insertAt < 0) return false;
  if (!before) insertAt += 1;
  enabled.splice(insertAt, 0, dragged);

  layout.widgets = normalizeWidgetOrder([...enabled, ...disabled]);
  layout.updatedAt = Date.now();
  return true;
}

module.exports = {
  normalizeRole,
  buildDefaultLayout,
  migrateLayout,
  applyWidgetSettings,
  reorderEnabledWidgets
};
