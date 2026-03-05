#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { Readable } = require("stream");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "test-results");
const DASHBOARD_WIDGETS_FILE = path.join(ROOT, "Contents", "Resources", "dashboard_widgets.js");
const HOMEPAGE_FILE = path.join(ROOT, "Contents", "Resources", "Homepage.html");

const STORAGE_KEYS = {
  role: "atlasDashboardRoleV1",
  user: "atlasDashboardUserIdV1",
  layoutPrefix: "atlasDashboardLayoutV1",
  apiUsage: "atlasDashboardApiUsageV1",
  engineTools: "atlasEngineToolWidgetsV1",
  fasthosts: "atlasFasthostsDomainV1",
  fasthostsAlerts: "atlasFasthostsAlertsV1",
  fasthostsSystemAcks: "atlasFasthostsSystemAlertAcksV1",
  fasthostsNotify: "atlasFasthostsAlertNotifyLedgerV1",
  debug: "atlasDashboardDebug"
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8010/Homepage.html";

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.DASHBOARD_BASE_URL || DEFAULT_BASE_URL,
    headful: false,
    timeoutMs: 30000,
    slowMo: 0
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    if (!arg) continue;
    if (arg === "--headful") {
      out.headful = true;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      out.baseUrl = arg.slice("--base-url=".length).trim() || out.baseUrl;
      continue;
    }
    if (arg === "--base-url" && argv[i + 1]) {
      out.baseUrl = String(argv[i + 1] || "").trim() || out.baseUrl;
      i += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const n = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (Number.isFinite(n) && n > 0) out.timeoutMs = n;
      continue;
    }
    if (arg.startsWith("--slow-mo=")) {
      const n = Number.parseInt(arg.slice("--slow-mo=".length), 10);
      if (Number.isFinite(n) && n >= 0) out.slowMo = n;
      continue;
    }
  }

  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeStamp(iso) {
  return String(iso || "").replace(/[:.]/g, "-");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function runCommand(command, args, cwd) {
  const res = cp.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    command: `${command} ${args.join(" ")}`.trim(),
    exitCode: Number.isFinite(Number(res.status)) ? Number(res.status) : 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || "")
  };
}

function loadPlaywright() {
  const candidates = [
    "playwright",
    path.join(ROOT, "tmp", "playwright", "node_modules", "playwright")
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(candidate);
    } catch {
      // continue
    }
  }
  throw new Error("Playwright module not found. Install it or keep tmp/playwright/node_modules available.");
}

function parseConstLiterals(source) {
  const out = {};
  const regex = /const\s+([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+)\s*;/g;
  let match = regex.exec(source);
  while (match) {
    const key = String(match[1] || "").trim();
    const raw = String(match[2] || "").trim();
    if (raw.startsWith("\"") || raw.startsWith("'")) {
      out[key] = raw.slice(1, -1);
    } else {
      const n = Number.parseInt(raw, 10);
      out[key] = Number.isFinite(n) ? n : raw;
    }
    match = regex.exec(source);
  }
  return out;
}

function splitTopLevelObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return out;
}

function parseValueToken(token, constMap) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (Object.prototype.hasOwnProperty.call(constMap, raw)) {
    return constMap[raw];
  }
  return raw;
}

function matchToken(block, regex) {
  const m = regex.exec(block);
  if (!m) return "";
  return String(m[1] || "").trim();
}

function parseConstraints(block) {
  const match = /constraints\s*:\s*\{([^}]*)\}/s.exec(block);
  if (!match) {
    return { minW: null, minH: null, maxW: null, maxH: null };
  }
  const body = String(match[1] || "");
  const read = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*(-?\\d+)`, "i").exec(body);
    if (!m) return null;
    const n = Number.parseInt(String(m[1] || ""), 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    minW: read("minW"),
    minH: read("minH"),
    maxW: read("maxW"),
    maxH: read("maxH")
  };
}

function parseWidgetRegistry(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const constMap = parseConstLiterals(source);
  const start = source.indexOf("const WIDGET_REGISTRY = [");
  const marker = source.indexOf("const REGISTRY_BY_ID", start);
  if (start < 0 || marker < 0) {
    throw new Error("Could not locate WIDGET_REGISTRY in dashboard widgets source.");
  }
  const arrayStart = source.indexOf("[", start);
  const arrayEnd = source.lastIndexOf("]", marker);
  if (arrayStart < 0 || arrayEnd < 0 || arrayEnd <= arrayStart) {
    throw new Error("Could not parse WIDGET_REGISTRY array bounds.");
  }

  const inside = source.slice(arrayStart + 1, arrayEnd);
  const blocks = splitTopLevelObjects(inside);
  const widgets = [];

  for (const block of blocks) {
    const idToken = matchToken(block, /id\s*:\s*([A-Z0-9_]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    const nameToken = matchToken(block, /name\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    if (!idToken) continue;

    const id = String(parseValueToken(idToken, constMap) || "").trim();
    if (!id) continue;

    const sourceToken = matchToken(block, /source\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    const selectorToken = matchToken(block, /componentSelector\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    const defaultSizeToken = matchToken(block, /defaultSize\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    const defaultEnabledToken = matchToken(block, /defaultEnabled\s*:\s*(true|false)/);

    const allowedRoles = [];
    const roleMatch = /allowedRoles\s*:\s*\[([^\]]*)\]/s.exec(block);
    if (roleMatch) {
      const pieces = String(roleMatch[1] || "").split(",");
      for (const part of pieces) {
        const raw = String(part || "").trim();
        if (!raw) continue;
        const val = parseValueToken(raw, constMap);
        if (val) allowedRoles.push(String(val));
      }
    }

    widgets.push({
      id,
      name: String(parseValueToken(nameToken, constMap) || id),
      source: sourceToken ? String(parseValueToken(sourceToken, constMap)) : "static",
      componentSelector: selectorToken ? String(parseValueToken(selectorToken, constMap)) : "",
      defaultSize: defaultSizeToken ? String(parseValueToken(defaultSizeToken, constMap)) : "large",
      defaultEnabled: defaultEnabledToken === "" ? true : defaultEnabledToken === "true",
      constraints: parseConstraints(block),
      allowedRoles
    });
  }

  return widgets;
}

class LayoutMemoryApi {
  constructor() {
    this.store = new Map();
    this.lastPut = new Map();
    this.failGet = false;
    this.failPut = false;
  }

  normalizeRole(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "admin" ? "admin" : "user";
  }

  normalizeUserId(value) {
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._@-]/g, "")
      .slice(0, 120);
  }

  keyFor(role, userId) {
    const r = this.normalizeRole(role);
    const u = this.normalizeUserId(userId) || "anon";
    return `${r}:${u}`;
  }

  parseJson(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  parseReq(urlText, bodyText) {
    const url = new URL(String(urlText || ""));
    const queryRole = String(url.searchParams.get("role") || "").trim();
    const queryUser = String(url.searchParams.get("user_id") || "").trim();
    const body = this.parseJson(bodyText) || {};
    return {
      body,
      role: this.normalizeRole(body.role || queryRole || "user"),
      userId: this.normalizeUserId(body.user_id || queryUser || "")
    };
  }

  handle(method, urlText, bodyText) {
    const parsed = this.parseReq(urlText, bodyText);
    const { role, userId, body } = parsed;
    const key = this.keyFor(role, userId);

    if (method === "GET") {
      if (this.failGet) {
        return {
          status: 200,
          body: {
            ok: false,
            role,
            user_id: userId,
            error: "KV unavailable",
            layout: null
          }
        };
      }
      return {
        status: 200,
        body: {
          ok: true,
          role,
          user_id: userId,
          layout: this.store.has(key) ? cloneJson(this.store.get(key)) : null
        }
      };
    }

    if (method === "PUT") {
      if (this.failPut) {
        return {
          status: 200,
          body: {
            ok: false,
            role,
            user_id: userId,
            error: "KV unavailable"
          }
        };
      }

      const layout = body.layout;
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
        return { status: 400, body: { ok: false, error: "layout object is required" } };
      }
      if (!Array.isArray(layout.widgets)) {
        return { status: 400, body: { ok: false, error: "layout.widgets array is required" } };
      }

      const storedLayout = {
        ...layout,
        role,
        version: Number.isFinite(Number(layout.version)) ? Math.max(1, Number(layout.version)) : 1,
        updatedAt:
          Number.isFinite(Number(layout.updatedAt)) && Number(layout.updatedAt) > 0
            ? Number(layout.updatedAt)
            : Date.now()
      };

      this.store.set(key, cloneJson(storedLayout));
      this.lastPut.set(key, cloneJson(storedLayout));

      return {
        status: 200,
        body: {
          ok: true,
          role,
          user_id: userId,
          updatedAt: storedLayout.updatedAt
        }
      };
    }

    return { status: 405, body: { ok: false, error: "Method Not Allowed" } };
  }
}

function makeMockReqRes({ method, url, query, body }) {
  const req = new Readable({
    read() {
      this.push(null);
    }
  });

  req.method = String(method || "GET").toUpperCase();
  req.url = String(url || "/");
  req.query = query && typeof query === "object" ? query : {};
  if (body && typeof body === "object") {
    req.body = body;
  }

  const responsePromise = new Promise((resolve) => {
    const chunks = [];
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[String(name || "").toLowerCase()] = value;
      },
      end(chunk) {
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: Number(this.statusCode || 200),
          headers,
          rawBody: raw,
          json: (() => {
            try {
              return raw ? JSON.parse(raw) : null;
            } catch {
              return null;
            }
          })()
        });
      }
    };

    req.__mockResponse = res;
  });

  return { req, res: req.__mockResponse, responsePromise };
}

async function invokeApiHandler(handler, options) {
  const { req, res, responsePromise } = makeMockReqRes(options || {});
  await Promise.resolve(handler(req, res));
  return responsePromise;
}

async function withMockedDashboardApi(callback) {
  const kvPath = path.join(ROOT, "lib", "upstash_kv.js");
  const apiPath = path.join(ROOT, "api", "dashboard-layout.js");
  const oldKv = require.cache[kvPath];
  const oldApi = require.cache[apiPath];
  const mem = new Map();

  require.cache[kvPath] = {
    id: kvPath,
    filename: kvPath,
    loaded: true,
    exports: {
      kvGet: async (key) => (mem.has(key) ? mem.get(key) : null),
      kvSet: async (key, value) => {
        mem.set(key, value);
      }
    }
  };

  delete require.cache[apiPath];

  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const handler = require(apiPath);
    return await callback(handler, mem);
  } finally {
    if (oldKv) require.cache[kvPath] = oldKv;
    else delete require.cache[kvPath];

    if (oldApi) require.cache[apiPath] = oldApi;
    else delete require.cache[apiPath];
  }
}

function severityRank(severity) {
  if (severity === "P0") return 0;
  if (severity === "P1") return 1;
  if (severity === "P2") return 2;
  return 3;
}

function formatError(err) {
  if (!err) return "Unknown error";
  if (err && err.stack) return String(err.stack);
  if (err && err.message) return String(err.message);
  return String(err);
}

async function waitDashboardReady(page, timeoutMs) {
  const t = Math.max(3000, Number(timeoutMs) || 30000);
  await page.waitForSelector("#dashboard_controls", { timeout: t });
  await page.waitForSelector("#dashboard_grid", { timeout: t });
  await page.waitForFunction(() => document.querySelectorAll("#dashboard_grid .dashboard-widget").length > 0, null, {
    timeout: t
  });
}

async function clearDashboardStorage(page) {
  await page.evaluate((keys) => {
    const prefix = `${keys.layoutPrefix}:`;
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key === keys.role ||
        key === keys.user ||
        key === keys.apiUsage ||
        key === keys.engineTools ||
        key === keys.fasthosts ||
        key === keys.debug ||
        key.startsWith(prefix)
      ) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) localStorage.removeItem(key);
  }, STORAGE_KEYS);
}

async function setDebugEnabled(page, enabled) {
  await page.evaluate(
    (payload) => {
      if (payload.enabled) localStorage.setItem(payload.key, "1");
      else localStorage.removeItem(payload.key);
    },
    { key: STORAGE_KEYS.debug, enabled: Boolean(enabled) }
  );
}

async function gotoHomepage(page, baseUrl, timeoutMs) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: Math.max(10000, Number(timeoutMs) || 30000) });
}

async function ensureEditMode(page, enabled) {
  const expected = Boolean(enabled);
  const has = await page.evaluate(() => document.body.classList.contains("dashboard-edit-mode"));
  if (has !== expected) {
    await page.click("#dashboard_edit_toggle");
    await page.waitForFunction((want) => document.body.classList.contains("dashboard-edit-mode") === want, expected, {
      timeout: 10000
    });
  }
}

async function openAddWidgetsModal(page) {
  await ensureEditMode(page, true);
  await page.click("#dashboard_add_widgets_btn");
  await page.waitForSelector("#dashboard_add_modal.open", { timeout: 10000 });
}

async function closeAddWidgetsModal(page) {
  const close = page.locator("#dashboard_add_close_btn");
  if ((await close.count()) > 0) {
    await close.click();
  }
  await page.waitForSelector("#dashboard_add_modal.open", { state: "hidden", timeout: 10000 });
}

async function setRole(page, role) {
  await page.selectOption("#dashboard_role_select", String(role || "user"));
  await page.waitForTimeout(600);
}

async function setUserId(page, userId) {
  await page.fill("#dashboard_user_id_input", String(userId || ""));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
}

async function waitForStatusContains(page, snippet, timeoutMs) {
  const needle = String(snippet || "").toLowerCase();
  await page.waitForFunction(
    (n) => String(document.getElementById("dashboard_save_status")?.textContent || "").toLowerCase().includes(n),
    needle,
    { timeout: Math.max(500, Number(timeoutMs) || 10000) }
  );
}

async function getRoleAndUser(page) {
  return page.evaluate(() => {
    const role = String(document.getElementById("dashboard_role_select")?.value || "user");
    const userId = String(document.getElementById("dashboard_user_id_input")?.value || "").trim();
    return { role, userId };
  });
}

async function getLayoutStorageKey(page) {
  const ctx = await getRoleAndUser(page);
  const userPart = String(ctx.userId || "").trim() || "anon";
  return `${STORAGE_KEYS.layoutPrefix}:${ctx.role}:${userPart}`;
}

async function readLayoutFromStorage(page, explicitKey) {
  const key = explicitKey || (await getLayoutStorageKey(page));
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return { key: k, layout: null };
    try {
      return { key: k, layout: JSON.parse(raw) };
    } catch {
      return { key: k, layout: null };
    }
  }, key);
}

async function writeLayoutToStorage(page, key, layout) {
  await page.evaluate(
    (payload) => {
      localStorage.setItem(payload.key, JSON.stringify(payload.layout));
    },
    { key, layout }
  );
}

async function ensureLocalLayoutSnapshot(page, widgetId = "assistant_chat") {
  let snap = await readLayoutFromStorage(page);
  if (snap.layout && Array.isArray(snap.layout.widgets)) return snap;

  await ensureWidgetEnabled(page, widgetId);
  await openWidgetSettings(page, widgetId);
  const currentTitle = await page.inputValue("#dashboard_settings_title_input");
  await page.fill(
    "#dashboard_settings_title_input",
    currentTitle && currentTitle.trim() ? currentTitle.trim() : "LAYOUT_PRIMER"
  );
  await saveWidgetSettings(page);
  await waitForStatusContains(page, "saved", 12000).catch(() => {});
  snap = await readLayoutFromStorage(page);
  return snap;
}

async function getEnabledWidgetOrder(page) {
  return page.evaluate(() => (
    Array.from(document.querySelectorAll("#dashboard_grid .dashboard-widget[data-widget-id]"))
      .filter((node) => !node.hidden)
      .map((node) => String(node.dataset.widgetId || "").trim())
      .filter(Boolean)
  ));
}

async function widgetInGrid(page, widgetId) {
  const locator = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${widgetId}"]`);
  return (await locator.count()) > 0;
}

async function openWidgetSettings(page, widgetId) {
  await ensureEditMode(page, true);
  const widget = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${widgetId}"]`).first();
  if ((await widget.count()) === 0) {
    throw new Error(`Widget not found in grid for settings: ${widgetId}`);
  }
  await widget.locator(".dashboard-widget-settings").click();
  await page.waitForSelector("#dashboard_settings_modal.open", { timeout: 10000 });
}

async function saveWidgetSettings(page) {
  await page.click("#dashboard_settings_save_btn");
  await page.waitForSelector("#dashboard_settings_modal.open", { state: "hidden", timeout: 10000 });
  await page.waitForTimeout(600);
}

async function toggleWidgetViaAddModal(page, widgetId) {
  await openAddWidgetsModal(page);
  await page.fill("#dashboard_add_search_input", widgetId);
  await page.dispatchEvent("#dashboard_add_search_input", "input");
  await page.waitForTimeout(120);

  const button = page.locator(`#dashboard_add_widget_list button[data-dashboard-widget-toggle="${widgetId}"]`).first();
  if ((await button.count()) === 0) {
    const html = await page.locator("#dashboard_add_widget_list").innerText();
    await closeAddWidgetsModal(page);
    return { ok: false, missing: true, reason: `Toggle button not found. list=${html}` };
  }

  const disabled = await button.isDisabled();
  const label = String(await button.innerText()).trim();
  const itemText = await page.locator("#dashboard_add_widget_list").innerText();

  if (disabled) {
    await closeAddWidgetsModal(page);
    return {
      ok: true,
      disabled: true,
      label,
      unavailableTag: /unavailable in this view/i.test(itemText)
    };
  }

  await button.click();
  await page.waitForTimeout(220);

  await page.fill("#dashboard_add_search_input", widgetId);
  await page.dispatchEvent("#dashboard_add_search_input", "input");
  await page.waitForTimeout(120);

  const button2 = page.locator(`#dashboard_add_widget_list button[data-dashboard-widget-toggle="${widgetId}"]`).first();
  if ((await button2.count()) > 0 && !(await button2.isDisabled())) {
    await button2.click();
    await page.waitForTimeout(220);
  }

  await closeAddWidgetsModal(page);
  return {
    ok: true,
    disabled: false,
    label,
    unavailableTag: false
  };
}

async function dragWidgetBefore(page, dragId, targetId) {
  const handle = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${dragId}"] .dashboard-widget-drag`).first();
  const target = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${targetId}"]`).first();

  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  if (!hb || !tb) throw new Error(`Drag boxes unavailable for ${dragId} -> ${targetId}`);

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + Math.min(20, tb.width / 2), tb.y + 5, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function dragWidgetBeforeByDispatch(page, dragId, targetId, before = true) {
  return page.evaluate(({ dragId: d, targetId: t, before: placeBefore }) => {
    const dragBtn = document.querySelector(
      `#dashboard_grid .dashboard-widget[data-widget-id="${d}"] .dashboard-widget-drag`
    );
    const targetShell = document.querySelector(
      `#dashboard_grid .dashboard-widget[data-widget-id="${t}"]`
    );
    if (!dragBtn || !targetShell) {
      return { started: false, reason: "missing-nodes" };
    }

    const dragRect = dragBtn.getBoundingClientRect();
    const targetRect = targetShell.getBoundingClientRect();
    const startX = dragRect.left + dragRect.width / 2;
    const startY = dragRect.top + dragRect.height / 2;
    const targetX = targetRect.left + Math.min(20, Math.max(8, targetRect.width / 4));
    const targetY = placeBefore
      ? targetRect.top + Math.min(16, Math.max(4, targetRect.height / 6))
      : targetRect.bottom - Math.min(16, Math.max(4, targetRect.height / 6));

    const downEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: startX,
      clientY: startY
    });
    dragBtn.dispatchEvent(downEvent);
    const started = document.body.classList.contains("dashboard-dragging");

    const moveEvent = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: targetX,
      clientY: targetY
    });
    window.dispatchEvent(moveEvent);

    const upEvent = new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: targetX,
      clientY: targetY
    });
    window.dispatchEvent(upEvent);

    return { started, targetX, targetY };
  }, { dragId, targetId, before });
}

async function dragActivationSnapshot(page, dragId, targetId) {
  const handle = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id=\"${dragId}\"] .dashboard-widget-drag`).first();
  const target = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id=\"${targetId}\"]`).first();
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  if (!hb || !tb) throw new Error(`Drag activation boxes unavailable for ${dragId} -> ${targetId}`);

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + Math.min(20, tb.width / 2), tb.y + Math.max(5, Math.min(20, tb.height / 3)), {
    steps: 8
  });
  const active = await page.evaluate(() => document.body.classList.contains("dashboard-dragging"));
  await page.mouse.up();
  await page.waitForTimeout(250);
  return active;
}

async function resizeWidgetByDispatch(page, widgetId, dx, dy) {
  return page.evaluate(({ id, deltaX, deltaY }) => {
    const handle = document.querySelector(
      `#dashboard_grid .dashboard-widget[data-widget-id="${id}"] .dashboard-widget-resize`
    );
    if (!handle) return { started: false, reason: "missing-handle" };

    const rect = handle.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const moveX = startX + Number(deltaX || 0);
    const moveY = startY + Number(deltaY || 0);

    const downEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: startX,
      clientY: startY
    });
    handle.dispatchEvent(downEvent);
    const started = document.body.classList.contains("dashboard-resizing");

    const moveEvent = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: moveX,
      clientY: moveY
    });
    window.dispatchEvent(moveEvent);

    const upEvent = new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: moveX,
      clientY: moveY
    });
    window.dispatchEvent(upEvent);

    return { started, moveX, moveY };
  }, { id: widgetId, deltaX: dx, deltaY: dy });
}

async function resizeWidget(page, widgetId, dx, dy) {
  const handle = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${widgetId}"] .dashboard-widget-resize`).first();
  const hb = await handle.boundingBox();
  if (!hb) throw new Error(`Resize handle unavailable for ${widgetId}`);

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + Number(dx || 0), hb.y + hb.height / 2 + Number(dy || 0), { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function ensureWidgetEnabled(page, widgetId) {
  if (await widgetInGrid(page, widgetId)) return;

  await openAddWidgetsModal(page);
  await page.fill("#dashboard_add_search_input", widgetId);
  await page.dispatchEvent("#dashboard_add_search_input", "input");
  await page.waitForTimeout(120);
  const button = page.locator(`#dashboard_add_widget_list button[data-dashboard-widget-toggle="${widgetId}"]`).first();
  if ((await button.count()) === 0) {
    await closeAddWidgetsModal(page);
    throw new Error(`Cannot enable widget. Toggle not found: ${widgetId}`);
  }
  if (await button.isDisabled()) {
    await closeAddWidgetsModal(page);
    throw new Error(`Cannot enable widget. Toggle disabled: ${widgetId}`);
  }
  const label = String(await button.innerText()).trim().toLowerCase();
  if (label === "add") {
    await button.click();
    await page.waitForTimeout(240);
  }
  await closeAddWidgetsModal(page);
  await page.waitForTimeout(300);
}

async function getWidgetTitle(page, widgetId) {
  const locator = page.locator(`#dashboard_grid .dashboard-widget[data-widget-id="${widgetId}"] .dashboard-widget-title`).first();
  if ((await locator.count()) === 0) return "";
  return String(await locator.innerText()).trim();
}

async function collectWidgetRuntimeState(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#dashboard_grid .dashboard-widget[data-widget-id]"));
    return rows.map((node) => ({
      id: String(node.dataset.widgetId || "").trim(),
      hidden: Boolean(node.hidden),
      classes: String(node.className || "")
    }));
  });
}

function assert(condition, message, extra) {
  if (condition) return;
  const err = new Error(String(message || "Assertion failed"));
  if (extra !== undefined) err.extra = extra;
  throw err;
}

function parseDashboardLayoutKey(key) {
  const raw = String(key || "");
  if (!raw.startsWith(`${STORAGE_KEYS.layoutPrefix}:`)) return null;
  const parts = raw.split(":");
  if (parts.length < 3) return null;
  return {
    role: parts[1] || "user",
    userId: parts.slice(2).join(":") || "anon"
  };
}

async function runApiContracts(report) {
  const checks = [];

  await withMockedDashboardApi(async (handler) => {
    const badPut = await invokeApiHandler(handler, {
      method: "PUT",
      url: "/api/dashboard-layout?role=admin&user_id=qa_user",
      body: { role: "admin", user_id: "qa_user" }
    });

    checks.push({
      id: "API01",
      name: "dashboard-layout rejects malformed PUT",
      passed: badPut.statusCode === 400 && /layout object is required/i.test(String(badPut.json?.error || "")),
      evidence: badPut
    });

    const validLayout = {
      version: 1,
      role: "user",
      updatedAt: Date.now(),
      widgets: [
        {
          id: "assistant_chat",
          x: 0,
          y: 0,
          w: 12,
          h: 20,
          enabled: true,
          settings: { title: "QA", refreshSec: 0, visible: true, size: "large" }
        }
      ]
    };

    const goodPut = await invokeApiHandler(handler, {
      method: "PUT",
      url: "/api/dashboard-layout?role=admin&user_id=qa!user",
      body: { role: "admin", user_id: "qa!user", layout: validLayout }
    });

    checks.push({
      id: "API02",
      name: "dashboard-layout accepts valid PUT",
      passed: goodPut.statusCode === 200 && goodPut.json?.ok === true && Number(goodPut.json?.updatedAt) > 0,
      evidence: goodPut
    });

    const goodGet = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/dashboard-layout?role=ADMIN&user_id=qa!user",
      query: { role: "ADMIN", user_id: "qa!user" }
    });

    checks.push({
      id: "API03",
      name: "dashboard-layout GET returns normalized role/user and layout",
      passed:
        goodGet.statusCode === 200 &&
        goodGet.json?.ok === true &&
        goodGet.json?.role === "admin" &&
        goodGet.json?.user_id === "qauser" &&
        goodGet.json?.layout &&
        Array.isArray(goodGet.json.layout.widgets),
      evidence: goodGet
    });
  });

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const fasthostsHandler = require(path.join(ROOT, "api", "fasthosts", "domain-report.js"));

  const invalid = await invokeApiHandler(fasthostsHandler, {
    method: "GET",
    url: "/api/fasthosts/domain-report?domain=bad_domain",
    query: { domain: "bad_domain" }
  });

  checks.push({
    id: "API04",
    name: "fasthosts API rejects invalid domain",
    passed: invalid.statusCode === 400 && /valid domain/i.test(String(invalid.json?.error || "")),
    evidence: invalid
  });

  const valid = await invokeApiHandler(fasthostsHandler, {
    method: "GET",
    url: "/api/fasthosts/domain-report?domain=example.com",
    query: { domain: "example.com" }
  });

  checks.push({
    id: "API05",
    name: "fasthosts API returns report for example.com",
    passed:
      valid.statusCode === 200 &&
      valid.json?.ok === true &&
      valid.json?.report &&
      valid.json.report.health &&
      typeof valid.json.report.health.overall === "string",
    evidence: {
      statusCode: valid.statusCode,
      ok: valid.json?.ok,
      domain: valid.json?.domain,
      overall: valid.json?.report?.health?.overall,
      indicators: valid.json?.report?.health?.indicators || null,
      error: valid.json?.error || null
    }
  });

  for (const check of checks) {
    report.apiChecks.push({
      id: check.id,
      name: check.name,
      status: check.passed ? "passed" : "failed",
      evidence: check.evidence
    });

    if (!check.passed) {
      report.defects.push({
        id: `DEF-${String(report.defects.length + 1).padStart(3, "0")}`,
        from: check.id,
        category: "API",
        severity: check.id === "API02" || check.id === "API03" ? "P1" : "P2",
        title: check.name,
        evidence: check.evidence
      });
    }
  }
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Dashboard Troubleshooting Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Canonical runtime target: ${report.runtimeTarget}`);
  lines.push(`- Registry source: ${report.registrySource}`);
  lines.push("");

  lines.push("## Baseline Gate");
  lines.push("");
  for (const gate of report.baseline) {
    lines.push(`- ${gate.command}: ${gate.exitCode === 0 ? "PASS" : "FAIL"} (exit ${gate.exitCode})`);
  }
  lines.push("");

  lines.push("## Widget Inventory");
  lines.push("");
  lines.push(`- Total widgets parsed: ${report.inventory.length}`);
  lines.push(`- Widget IDs: ${report.inventory.map((item) => item.id).join(", ")}`);
  lines.push("");
  lines.push("| id | source | selector | defaultEnabled | constraints | selectorExists |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of report.inventory) {
    const c = item.constraints || {};
    const cn = `minW=${c.minW ?? "-"}, minH=${c.minH ?? "-"}, maxW=${c.maxW ?? "-"}, maxH=${c.maxH ?? "-"}`;
    lines.push(
      `| ${item.id} | ${item.source} | ${item.componentSelector || "-"} | ${item.defaultEnabled} | ${cn} | ${
        item.selectorExists === null ? "n/a" : String(item.selectorExists)
      } |`
    );
  }
  lines.push("");

  lines.push("## API Contract Checks");
  lines.push("");
  lines.push("| id | status | name |");
  lines.push("|---|---|---|");
  for (const check of report.apiChecks) {
    lines.push(`| ${check.id} | ${check.status.toUpperCase()} | ${check.name} |`);
  }
  lines.push("");

  lines.push("## Scenario Results");
  lines.push("");
  lines.push("| id | status | name | durationMs |");
  lines.push("|---|---|---|---|");
  for (const row of report.scenarios) {
    lines.push(`| ${row.id} | ${row.status.toUpperCase()} | ${row.name} | ${row.durationMs} |`);
  }
  lines.push("");

  const bySeverity = [...report.defects].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  lines.push("## Defects");
  lines.push("");
  if (!bySeverity.length) {
    lines.push("- No defects recorded.");
  } else {
    for (const defect of bySeverity) {
      lines.push(`- ${defect.id} [${defect.severity}] [${defect.category}] from ${defect.from}: ${defect.title}`);
      if (defect.evidence != null) {
        let evidence = "";
        try {
          evidence = JSON.stringify(defect.evidence);
        } catch {
          evidence = String(defect.evidence);
        }
        lines.push(`  - evidence: ${evidence.slice(0, 800)}`);
      }
    }
  }
  lines.push("");

  lines.push("## Acceptance Criteria");
  lines.push("");
  const a = report.acceptance;
  lines.push(`- 100% widget coverage: ${a.widgetCoverage ? "PASS" : "FAIL"} (${a.coverageCount}/${a.totalWidgets})`);
  lines.push(`- All 20 scenarios executed: ${a.allScenariosExecuted ? "PASS" : "FAIL"} (${a.executedScenarios}/20)`);
  lines.push(`- Zero open P0/P1 issues: ${a.zeroP0P1 ? "PASS" : "FAIL"} (P0=${a.p0Count}, P1=${a.p1Count})`);
  lines.push(`- Evidence recorded for non-pass: ${a.evidenceForFailures ? "PASS" : "FAIL"}`);
  lines.push(`- Prioritized fix queue present: ${a.hasFixQueue ? "PASS" : "FAIL"}`);
  lines.push("");

  lines.push("## Prioritized Fix Queue");
  lines.push("");
  if (!bySeverity.length) {
    lines.push("- None.");
  } else {
    for (const defect of bySeverity) {
      lines.push(`1. [${defect.severity}] ${defect.title} (${defect.category})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(OUTPUT_DIR);

  const generatedAt = nowIso();

  const report = {
    generatedAt,
    baseUrl: args.baseUrl,
    runtimeTarget: "Contents/Resources/Homepage.html",
    registrySource: path.relative(ROOT, DASHBOARD_WIDGETS_FILE),
    baseline: [],
    inventory: [],
    apiChecks: [],
    scenarios: [],
    defects: [],
    notes: [],
    acceptance: {
      widgetCoverage: false,
      coverageCount: 0,
      totalWidgets: 0,
      allScenariosExecuted: false,
      executedScenarios: 0,
      zeroP0P1: false,
      p0Count: 0,
      p1Count: 0,
      evidenceForFailures: false,
      hasFixQueue: false
    }
  };

  if (!fs.existsSync(HOMEPAGE_FILE)) {
    throw new Error(`Missing homepage file: ${HOMEPAGE_FILE}`);
  }

  const registry = parseWidgetRegistry(DASHBOARD_WIDGETS_FILE);
  report.inventory = registry.map((item) => ({ ...item, selectorExists: null }));

  const baselineCmds = [
    ["node", ["--test", "tests/dashboard_layout_model.test.js"]],
    ["python3", ["-m", "unittest", "tests/test_dashboard_layout_model.py"]]
  ];

  for (const [cmd, cmdArgs] of baselineCmds) {
    const res = runCommand(cmd, cmdArgs, ROOT);
    report.baseline.push(res);
    if (res.exitCode !== 0) {
      report.defects.push({
        id: `DEF-${String(report.defects.length + 1).padStart(3, "0")}`,
        from: "BASELINE",
        category: "State",
        severity: "P1",
        title: `Baseline failed: ${res.command}`,
        evidence: { stdout: res.stdout.slice(0, 1200), stderr: res.stderr.slice(0, 1200) }
      });
    }
  }

  await runApiContracts(report);

  const layoutApi = new LayoutMemoryApi();
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({
    headless: !args.headful,
    slowMo: Math.max(0, Number(args.slowMo) || 0)
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });

  await context.route("**/api/dashboard-layout**", async (route, request) => {
    const response = layoutApi.handle(request.method(), request.url(), request.postData() || "");
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(response.body)
    });
  });

  const runtimeErrors = {
    console: [],
    page: []
  };

  const testedWidgets = new Set();

  function recordDefect(payload) {
    report.defects.push({
      id: `DEF-${String(report.defects.length + 1).padStart(3, "0")}`,
      ...payload
    });
  }

  async function withScenario(id, name, category, severity, fn, options = {}) {
    const started = Date.now();
    if (options.resetLayoutApi !== false) {
      layoutApi.store.clear();
      layoutApi.lastPut.clear();
      layoutApi.failGet = false;
      layoutApi.failPut = false;
    }
    try {
      const detail = await fn();
      report.scenarios.push({
        id,
        name,
        status: "passed",
        durationMs: Date.now() - started,
        detail: detail || null
      });
    } catch (err) {
      const evidence = err && err.extra ? err.extra : formatError(err);
      report.scenarios.push({
        id,
        name,
        status: "failed",
        durationMs: Date.now() - started,
        detail: evidence
      });
      recordDefect({
        from: id,
        category,
        severity,
        title: name,
        evidence
      });
    }
  }

  async function newPage(viewport) {
    const page = await context.newPage();
    if (viewport) {
      await page.setViewportSize(viewport);
    }

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        runtimeErrors.console.push({ type: msg.type(), text: msg.text() });
      }
    });

    page.on("pageerror", (err) => {
      runtimeErrors.page.push(String(err?.stack || err?.message || err || "Unknown page error"));
    });

    return page;
  }

  // AUDIT: widget inventory and selector/source checks.
  await withScenario("TC00", "Widget inventory and availability audit", "Render", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await setDebugEnabled(page, true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const selectorChecks = await page.evaluate((items) => (
        items.map((item) => ({
          id: item.id,
          exists: Boolean(item.componentSelector ? document.querySelector(item.componentSelector) : false)
        }))
      ), report.inventory.map((item) => ({ id: item.id, componentSelector: item.componentSelector })));

      const byId = new Map(selectorChecks.map((item) => [item.id, item.exists]));
      let missingStatic = 0;
      for (const item of report.inventory) {
        const exists = byId.get(item.id) || false;
        const sourceKind = String(item.source || "static");
        if (sourceKind === "static" && !exists) missingStatic += 1;
        item.selectorExists = exists;
      }

      const sourceIds = ["top_api_usage", "fasthosts_manager"];
      for (const sourceId of sourceIds) {
        const found = byId.get(sourceId) === true;
        assert(found, `Source widget did not self-create: ${sourceId}`, { sourceId, byId: Object.fromEntries(byId) });
      }

      assert(report.inventory.length >= 16, "Parsed inventory is unexpectedly small", {
        count: report.inventory.length,
        ids: report.inventory.map((item) => item.id)
      });
      assert(missingStatic === 0, "Missing static widget selectors", {
        missing: report.inventory.filter((item) => item.source === "static" && !item.selectorExists).map((item) => item.id)
      });

      return {
        inventoryCount: report.inventory.length,
        staticMissing: missingStatic
      };
    } finally {
      await page.close();
    }
  });

  // TC01 Clean-load default layout per role.
  await withScenario("TC01", "Clean-load default layout per role", "State", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await setDebugEnabled(page, true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const userOrder = await getEnabledWidgetOrder(page);
      assert(userOrder.length > 0, "No widgets visible for user role", { userOrder });

      await setRole(page, "admin");
      await waitDashboardReady(page, args.timeoutMs);
      const adminOrder = await getEnabledWidgetOrder(page);
      assert(adminOrder.length > 0, "No widgets visible for admin role", { adminOrder });

      return {
        userVisible: userOrder.length,
        adminVisible: adminOrder.length
      };
    } finally {
      await page.close();
    }
  });

  // TC02 Role switch preserves separate layouts.
  await withScenario("TC02", "Role switch preserves separate layouts", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      await setUserId(page, "qa-role-user");
      await ensureWidgetEnabled(page, "assistant_chat");
      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "ROLE_USER_LAYOUT");
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);
      const userKey = await getLayoutStorageKey(page);

      await setRole(page, "admin");
      await ensureWidgetEnabled(page, "assistant_chat");
      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "ROLE_ADMIN_LAYOUT");
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);
      const adminKey = await getLayoutStorageKey(page);

      const keys = await page.evaluate((prefix) => {
        const out = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`${prefix}:`)) out.push(key);
        }
        return out;
      }, STORAGE_KEYS.layoutPrefix);

      assert(userKey !== adminKey, "Role keys should differ", { userKey, adminKey, keys });
      assert(keys.includes(userKey) && keys.includes(adminKey), "Role layout keys not persisted", {
        userKey,
        adminKey,
        keys
      });

      return { userKey, adminKey, keyCount: keys.length };
    } finally {
      await page.close();
    }
  });

  // TC03 User switch preserves separate layouts.
  await withScenario("TC03", "User switch preserves separate layouts", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      await setRole(page, "user");
      await setUserId(page, "alpha@example.com");
      await ensureWidgetEnabled(page, "assistant_chat");
      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "USER_ALPHA");
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);
      const alphaKey = await getLayoutStorageKey(page);

      await setUserId(page, "beta@example.com");
      await ensureWidgetEnabled(page, "assistant_chat");
      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "USER_BETA");
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);
      const betaKey = await getLayoutStorageKey(page);

      const keys = await page.evaluate((prefix) => {
        const out = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`${prefix}:`)) out.push(key);
        }
        return out;
      }, STORAGE_KEYS.layoutPrefix);

      assert(alphaKey !== betaKey, "User keys should differ", { alphaKey, betaKey, keys });
      assert(keys.includes(alphaKey) && keys.includes(betaKey), "User layout keys not persisted", {
        alphaKey,
        betaKey,
        keys
      });

      return { alphaKey, betaKey };
    } finally {
      await page.close();
    }
  });

  // TC04 Add/remove each widget.
  await withScenario("TC04", "Add/remove each widget", "Interaction", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureEditMode(page, true);

      const outcomes = [];
      for (const widget of report.inventory) {
        testedWidgets.add(widget.id);
        const outcome = await toggleWidgetViaAddModal(page, widget.id);
        outcomes.push({ id: widget.id, outcome });
        if (!outcome.ok) {
          throw new Error(`Add/remove failed for ${widget.id}: ${outcome.reason || "unknown"}`);
        }
        if (outcome.disabled) {
          assert(outcome.unavailableTag, `Disabled widget missing unavailable label: ${widget.id}`, outcome);
        }
      }

      return {
        tested: outcomes.length,
        disabled: outcomes.filter((item) => item.outcome.disabled).map((item) => item.id)
      };
    } finally {
      await page.close();
    }
  });

  // TC05 Settings save with title/visible/size/custom dimensions.
  await withScenario("TC05", "Settings save with title/visible/size/custom dimensions", "State", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "assistant_chat");

      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "SETTINGS_QA_CHAT");
      await page.fill("#dashboard_settings_refresh_input", "45");
      await page.selectOption("#dashboard_settings_size_select", "custom");
      await page.fill("#dashboard_settings_width_input", "8");
      await page.fill("#dashboard_settings_height_input", "27");
      await page.setChecked("#dashboard_settings_visible_input", true);
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);

      const snap = await readLayoutFromStorage(page);
      const widget = (snap.layout?.widgets || []).find((item) => item.id === "assistant_chat");
      assert(widget, "assistant_chat not found in stored layout", { key: snap.key, layout: snap.layout });
      assert(widget.settings?.title === "SETTINGS_QA_CHAT", "Title did not persist", widget);
      assert(Number(widget.settings?.refreshSec) === 45, "Refresh did not persist", widget);
      assert(String(widget.settings?.size || "") === "custom", "Size did not persist", widget);
      assert(Number(widget.w) === 8 && Number(widget.h) === 27, "Custom geometry did not persist", widget);

      return { key: snap.key, widget };
    } finally {
      await page.close();
    }
  });

  // TC06 Drag reorder persists through refresh.
  await withScenario("TC06", "Drag reorder persists through refresh", "Interaction", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureEditMode(page, true);

      const before = await getEnabledWidgetOrder(page);
      assert(before.length >= 2, "Need at least 2 widgets for drag reorder", { before });

      const dragId = before[1];
      const targetId = before[0];
      const dragProbe = await dragWidgetBeforeByDispatch(page, dragId, targetId, true);
      assert(dragProbe.started === true, "Drag session did not start for reorder scenario", {
        before,
        dragId,
        targetId,
        dragProbe
      });
      await page.waitForTimeout(700);
      const after = await getEnabledWidgetOrder(page);
      assert(after.join("|") !== before.join("|"), "Order did not change after drag", { before, after });
      assert(after[0] === dragId, "Dragged widget did not move to expected top position", {
        before,
        after,
        dragId
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureEditMode(page, true);
      const reloaded = await getEnabledWidgetOrder(page);
      assert(reloaded.join("|") === after.join("|"), "Reordered state did not persist", { before, after, reloaded });

      return { before, after, reloaded };
    } finally {
      await page.close();
    }
  });

  // TC07 Resize persists through refresh.
  await withScenario("TC07", "Resize persists through refresh", "Interaction", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureEditMode(page, true);
      const widgetId = "hero_overview";
      await ensureWidgetEnabled(page, widgetId);

      const beforeSnap = await ensureLocalLayoutSnapshot(page, widgetId);
      const key = beforeSnap.key;
      const beforeWidget = (beforeSnap.layout?.widgets || []).find((item) => item.id === widgetId);

      const resizeProbe = await resizeWidgetByDispatch(page, widgetId, 0, 140);
      assert(resizeProbe.started === true, "Resize session did not start", { widgetId, resizeProbe });
      await page.waitForTimeout(800);
      await waitForStatusContains(page, "saved", 12000).catch(() => {});
      await sleep(800);

      const midSnap = await readLayoutFromStorage(page, key);
      const midWidget = (midSnap.layout?.widgets || []).find((item) => item.id === widgetId);
      assert(midWidget, `Missing ${widgetId} after resize`, { key, midSnap });
      assert(
        Number(midWidget.w) !== Number(beforeWidget?.w) || Number(midWidget.h) !== Number(beforeWidget?.h),
        "Resize did not change stored dimensions",
        { before: beforeWidget, after: midWidget }
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      const reloadedSnap = await readLayoutFromStorage(page, key);
      const reloadWidget = (reloadedSnap.layout?.widgets || []).find((item) => item.id === widgetId);
      assert(
        Number(reloadWidget?.w) === Number(midWidget.w) && Number(reloadWidget?.h) === Number(midWidget.h),
        "Resized geometry not persisted after reload",
        { midWidget, reloadWidget }
      );

      return { before: beforeWidget, after: midWidget, reloaded: reloadWidget };
    } finally {
      await page.close();
    }
  });

  // TC08 Hidden widget behavior in view vs edit mode.
  await withScenario("TC08", "Hidden widget behavior in view vs edit mode", "State", "P2", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "assistant_chat");

      await openWidgetSettings(page, "assistant_chat");
      await page.setChecked("#dashboard_settings_visible_input", false);
      await saveWidgetSettings(page);

      await ensureEditMode(page, false);
      await page.waitForTimeout(500);
      const hiddenInView = await page.evaluate(() => {
        const el = document.querySelector('#dashboard_grid .dashboard-widget[data-widget-id="assistant_chat"]');
        return el ? Boolean(el.hidden) : null;
      });

      await ensureEditMode(page, true);
      const shownInEdit = await page.evaluate(() => {
        const el = document.querySelector('#dashboard_grid .dashboard-widget[data-widget-id="assistant_chat"]');
        const note = el ? el.querySelector(".dashboard-widget-hidden-note") : null;
        return {
          hidden: el ? Boolean(el.hidden) : null,
          noteVisible: note ? getComputedStyle(note).display !== "none" : false
        };
      });

      assert(hiddenInView === true, "Widget should be hidden in view mode", { hiddenInView });
      assert(shownInEdit.hidden === false && shownInEdit.noteVisible === true, "Widget should appear in edit mode with hidden note", shownInEdit);

      return { hiddenInView, shownInEdit };
    } finally {
      await page.close();
    }
  });

  // TC09 Top API usage increments.
  await withScenario("TC09", "top_api_usage count increments on fetch", "Data", "P2", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "top_api_usage");

      page.on("dialog", (dialog) => {
        void dialog.accept();
      });

      const resetBtn = page.locator("#top-api-usage [data-api-usage-reset]").first();
      if ((await resetBtn.count()) > 0) {
        await resetBtn.click();
        await page.waitForTimeout(300);
      }

      await page.evaluate(async () => {
        await fetch("/api/dashboard-layout?role=user");
        await fetch("/api/dashboard-layout?role=user&user_id=usage");
        await fetch("/api/fasthosts/domain-report?domain=example.com");
      });

      const refresh = page.locator("#top-api-usage [data-api-usage-refresh]").first();
      if ((await refresh.count()) > 0) {
        await refresh.click();
      }
      await page.waitForTimeout(600);

      const usage = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        try {
          return JSON.parse(raw);
        } catch {
          return {};
        }
      }, STORAGE_KEYS.apiUsage);

      const total = Object.values(usage).reduce((acc, value) => acc + Number(value || 0), 0);
      assert(total >= 3, "API usage did not increment as expected", { usage, total });

      return { usage, total };
    } finally {
      await page.close();
    }
  });

  // TC10 Top API usage reset clears map.
  await withScenario("TC10", "top_api_usage reset clears map", "Data", "P2", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "top_api_usage");

      await page.evaluate(async () => {
        await fetch("/api/dashboard-layout?role=user");
      });

      page.on("dialog", (dialog) => {
        void dialog.accept();
      });
      const resetBtn = page.locator("#top-api-usage [data-api-usage-reset]").first();
      assert((await resetBtn.count()) > 0, "Reset button missing on top_api_usage widget");
      await resetBtn.click();
      await page.waitForTimeout(600);

      const usage = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return { __parse_error: true };
        }
      }, STORAGE_KEYS.apiUsage);

      const keys = usage && typeof usage === "object" ? Object.keys(usage) : [];
      assert(keys.length === 0, "API usage map was not cleared", { usage, keys });

      return { usage };
    } finally {
      await page.close();
    }
  });

  // TC11 Fasthosts valid domain success.
  await withScenario("TC11", "fasthosts_manager valid domain success", "API", "P1", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "fasthosts_manager");

      await page.fill("#fasthosts-manager input[data-fasthosts-domain]", "example.com");
      await page.click("#fasthosts-manager button[type='submit']");

      await page.waitForFunction(() => {
        const status = document.querySelector("#fasthosts-manager .fasthosts-status");
        if (!status) return false;
        return !/Retrieving WHOIS/i.test(String(status.textContent || ""));
      }, null, { timeout: 35000 });

      const result = await page.evaluate(() => {
        const status = String(document.querySelector("#fasthosts-manager .fasthosts-status")?.textContent || "");
        const output = String(document.querySelector("#fasthosts-manager .fasthosts-output")?.textContent || "");
        return { status, outputSample: output.slice(0, 300) };
      });

      assert(!/Enter a valid domain/i.test(result.status), "Fasthosts valid lookup returned validation error", result);
      assert(/example\.com/i.test(result.outputSample), "Fasthosts output missing example.com", result);

      return result;
    } finally {
      await page.close();
    }
  });

  // TC12 Fasthosts invalid domain error.
  await withScenario("TC12", "fasthosts_manager invalid domain error", "API", "P2", async () => {
    const page = await newPage();
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "fasthosts_manager");

      await page.fill("#fasthosts-manager input[data-fasthosts-domain]", "not_a_domain");
      await page.click("#fasthosts-manager button[type='submit']");
      await page.waitForTimeout(350);

      const status = await page.locator("#fasthosts-manager .fasthosts-status").innerText();
      assert(/valid domain/i.test(String(status || "")), "Invalid domain did not trigger validation message", { status });

      return { status };
    } finally {
      await page.close();
    }
  });

  // TC13 Engine tool registry hydration.
  await withScenario("TC13", "engine_tool registry hydration from localStorage", "Render", "P1", async () => {
    const page = await newPage();
    const engineWidgetId = "engine_tool_qa_probe";
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);

      await page.evaluate((payload) => {
        localStorage.setItem(payload.key, JSON.stringify(payload.list));
      }, {
        key: STORAGE_KEYS.engineTools,
        list: [
          {
            id: engineWidgetId,
            name: "QA Probe",
            description: "Probe dynamic engine widget hydration.",
            theme: "operations",
            primaryAction: "Run Probe",
            intent: "Validate dynamic widget registration.",
            inputs: "domain,env",
            outputs: "status,result",
            dataKeys: "domain,env"
          }
        ]
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await openAddWidgetsModal(page);
      await page.fill("#dashboard_add_search_input", engineWidgetId);
      await page.dispatchEvent("#dashboard_add_search_input", "input");
      await page.waitForTimeout(220);

      const toggle = page.locator(`#dashboard_add_widget_list button[data-dashboard-widget-toggle="${engineWidgetId}"]`).first();
      assert((await toggle.count()) > 0, "Dynamic engine tool widget did not appear in Add Widgets", {
        widgetId: engineWidgetId
      });
      if (!(await toggle.isDisabled())) {
        await toggle.click();
      }
      await closeAddWidgetsModal(page);
      await page.waitForTimeout(400);

      const exists = await widgetInGrid(page, engineWidgetId);
      assert(exists, "Dynamic engine tool widget not rendered in grid", { widgetId: engineWidgetId });
      testedWidgets.add(engineWidgetId);

      return { widgetId: engineWidgetId, exists };
    } finally {
      await page.close();
    }
  });

  // TC14 Engine tool run output shape.
  await withScenario("TC14", "engine_tool run action output shape", "Data", "P2", async () => {
    const page = await newPage();
    const engineWidgetId = "engine_tool_qa_probe";
    const componentId = `#engine_tool_widget_${engineWidgetId}`;
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, engineWidgetId);

      const input = page.locator(`${componentId} input[data-engine-tool-input='domain']`).first();
      if ((await input.count()) > 0) {
        await input.fill("example.com");
      }
      const run = page.locator(`${componentId} button[data-engine-tool-run]`).first();
      assert((await run.count()) > 0, "Engine tool run button missing", { componentId });
      await run.click();
      await page.waitForTimeout(220);

      const output = await page.locator(`${componentId} [data-engine-tool-output]`).innerText();
      let parsed = null;
      try {
        parsed = JSON.parse(String(output || "{}"));
      } catch {
        parsed = null;
      }
      assert(parsed && typeof parsed === "object", "Engine tool output is not valid JSON", { output });
      assert(parsed.tool_id === engineWidgetId, "Engine tool output missing tool_id", parsed);
      assert(parsed.outputs && typeof parsed.outputs === "object", "Engine tool output missing outputs", parsed);

      return { parsed };
    } finally {
      await page.close();
    }
  });

  // TC15 Server layout newer syncs down.
  await withScenario("TC15", "Server layout newer than local syncs down", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      layoutApi.failGet = false;
      layoutApi.failPut = false;
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "assistant_chat");
      await ensureEditMode(page, true);

      // Create a local snapshot first.
      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "SYNC_PRIMER");
      await saveWidgetSettings(page);
      await waitForStatusContains(page, "saved", 10000);

      const localSnap = await ensureLocalLayoutSnapshot(page, "assistant_chat");
      const key = localSnap.key;
      const localLayout = cloneJson(localSnap.layout || {});
      assert(localLayout && Array.isArray(localLayout.widgets), "Local layout unavailable for sync test", { key, localSnap });

      const localWidget = localLayout.widgets.find((item) => item.id === "assistant_chat");
      assert(localWidget, "assistant_chat missing in local layout", { key, localLayout });

      localWidget.settings = localWidget.settings || {};
      localWidget.settings.title = "LOCAL_OLD";
      localLayout.updatedAt = Date.now();

      const remoteLayout = cloneJson(localLayout);
      const remoteWidget = remoteLayout.widgets.find((item) => item.id === "assistant_chat");
      remoteWidget.settings = remoteWidget.settings || {};
      remoteWidget.settings.title = "REMOTE_NEWER";
      remoteLayout.updatedAt = localLayout.updatedAt + 5000;

      const ctx = await getRoleAndUser(page);
      const memKey = layoutApi.keyFor(ctx.role, ctx.userId);
      layoutApi.store.set(memKey, cloneJson(remoteLayout));

      await writeLayoutToStorage(page, key, localLayout);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const title = await getWidgetTitle(page, "assistant_chat");
      assert(title === "REMOTE_NEWER", "Remote newer layout did not win", { title, key, memKey });

      return { title, key, memKey };
    } finally {
      await page.close();
    }
  });

  // TC16 Local layout newer remains local and syncs up.
  await withScenario("TC16", "Local layout newer than server remains local and syncs up", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      layoutApi.failGet = false;
      layoutApi.failPut = false;
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "assistant_chat");

      const snap = await ensureLocalLayoutSnapshot(page, "assistant_chat");
      const key = snap.key;
      const base = cloneJson(snap.layout || {});
      assert(base && Array.isArray(base.widgets), "Missing local base layout", { key, snap });

      const localLayout = cloneJson(base);
      const localWidget = localLayout.widgets.find((item) => item.id === "assistant_chat");
      localWidget.settings = localWidget.settings || {};
      localWidget.settings.title = "LOCAL_NEWER";
      localLayout.updatedAt = Date.now() + 30000;

      const remoteLayout = cloneJson(base);
      const remoteWidget = remoteLayout.widgets.find((item) => item.id === "assistant_chat");
      remoteWidget.settings = remoteWidget.settings || {};
      remoteWidget.settings.title = "REMOTE_OLDER";
      remoteLayout.updatedAt = Date.now() - 20000;

      const ctx = await getRoleAndUser(page);
      const memKey = layoutApi.keyFor(ctx.role, ctx.userId);
      layoutApi.store.set(memKey, cloneJson(remoteLayout));

      await writeLayoutToStorage(page, key, localLayout);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const title = await getWidgetTitle(page, "assistant_chat");
      assert(title === "LOCAL_NEWER", "Local newer layout should remain active", { title, key, memKey });

      await page.waitForTimeout(900);
      const pushed = layoutApi.lastPut.get(memKey);
      const pushedTitle = (pushed?.widgets || []).find((item) => item.id === "assistant_chat")?.settings?.title || "";
      assert(pushedTitle === "LOCAL_NEWER", "Local newer layout was not synced up to server", {
        memKey,
        pushedTitle,
        pushed
      });

      return { title, memKey, pushedTitle };
    } finally {
      await page.close();
    }
  });

  // TC17 Server unavailable falls back to local save/load.
  await withScenario("TC17", "Server unavailable falls back to local save/load", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      layoutApi.failGet = true;
      layoutApi.failPut = true;

      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureWidgetEnabled(page, "assistant_chat");

      await openWidgetSettings(page, "assistant_chat");
      await page.fill("#dashboard_settings_title_input", "LOCAL_ONLY_MODE");
      await saveWidgetSettings(page);

      await waitForStatusContains(page, "saved locally", 15000);
      const key = await getLayoutStorageKey(page);
      const snap = await readLayoutFromStorage(page, key);
      const title = (snap.layout?.widgets || []).find((item) => item.id === "assistant_chat")?.settings?.title || "";
      assert(title === "LOCAL_ONLY_MODE", "Local fallback save did not persist title", { key, title, snap });

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      const rendered = await getWidgetTitle(page, "assistant_chat");
      assert(rendered === "LOCAL_ONLY_MODE", "Local fallback layout did not load after reload", {
        rendered,
        key
      });

      return { key, rendered };
    } finally {
      layoutApi.failGet = false;
      layoutApi.failPut = false;
      await page.close();
    }
  });

  // TC18 Empty-layout recovery.
  await withScenario("TC18", "Empty-layout recovery rehydrates defaults", "Persistence", "P1", async () => {
    const page = await newPage();
    try {
      layoutApi.failGet = true;
      layoutApi.failPut = true;

      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const snap = await ensureLocalLayoutSnapshot(page, "assistant_chat");
      const key = snap.key;
      const base = cloneJson(snap.layout || {});
      assert(base && Array.isArray(base.widgets), "Base layout missing for empty-layout recovery test", { key, snap });

      for (const item of base.widgets) {
        item.enabled = false;
      }
      base.updatedAt = Date.now();
      await writeLayoutToStorage(page, key, base);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);

      const visible = await getEnabledWidgetOrder(page);
      assert(visible.length > 0, "Empty-layout recovery did not restore enabled widgets", { key, visible });

      const recovered = await readLayoutFromStorage(page, key);
      const enabledCount = (recovered.layout?.widgets || []).filter((item) => item && item.enabled).length;
      assert(enabledCount > 0, "Recovered layout still has zero enabled widgets", {
        key,
        enabledCount,
        recovered
      });

      return { key, visibleCount: visible.length, enabledCount };
    } finally {
      layoutApi.failGet = false;
      layoutApi.failPut = false;
      await page.close();
    }
  });

  // TC19 Mobile drag behavior.
  await withScenario("TC19", "Mobile drag blocked unless toggle enabled", "Interaction", "P2", async () => {
    const page = await newPage({ width: 390, height: 844 });
    try {
      await gotoHomepage(page, args.baseUrl, args.timeoutMs);
      await clearDashboardStorage(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitDashboardReady(page, args.timeoutMs);
      await ensureEditMode(page, true);

      const orderA = await getEnabledWidgetOrder(page);
      assert(orderA.length >= 1, "Need at least 1 widget on mobile drag scenario", { orderA });

      const dragId = orderA[0];
      const offActive = await page.evaluate((id) => {
        const btn = document.querySelector(`#dashboard_grid .dashboard-widget[data-widget-id="${id}"] .dashboard-widget-drag`);
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        btn.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        }));
        const active = document.body.classList.contains("dashboard-dragging");
        window.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        }));
        return active;
      }, dragId);
      assert(offActive === false, "Drag session activated while mobile drag toggle is off", {
        orderA,
        offActive
      });

      const toggle = page.locator("#dashboard_mobile_drag_toggle");
      await toggle.check();
      await page.waitForTimeout(220);
      const toggleState = await toggle.isChecked();
      assert(toggleState === true, "Mobile drag toggle did not switch on");

      const onActive = await page.evaluate((id) => {
        const btn = document.querySelector(`#dashboard_grid .dashboard-widget[data-widget-id="${id}"] .dashboard-widget-drag`);
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        btn.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        }));
        const active = document.body.classList.contains("dashboard-dragging");
        window.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        }));
        return active;
      }, dragId);
      assert(onActive === true, "Drag session did not activate when mobile drag toggle is on", {
        dragId,
        onActive
      });

      return { dragId, offActive, onActive };
    } finally {
      await page.close();
    }
  });

  // TC20 Runtime stability.
  await withScenario("TC20", "No uncaught runtime errors across regression", "State", "P1", async () => {
    const criticalConsole = runtimeErrors.console.filter((item) => {
      const text = String(item.text || "");
      if (!text) return false;
      if (/Failed to load resource/i.test(text) && /api\/chat|api\/prompt/i.test(text)) return false;
      return /dashboard|Uncaught|TypeError|ReferenceError|SyntaxError/i.test(text);
    });

    assert(runtimeErrors.page.length === 0, "Uncaught page errors detected", { pageErrors: runtimeErrors.page });
    assert(criticalConsole.length === 0, "Critical console errors detected", { criticalConsole });

    return {
      pageErrorCount: runtimeErrors.page.length,
      criticalConsoleCount: criticalConsole.length,
      allConsoleErrors: runtimeErrors.console.length
    };
  });

  await browser.close();

  const failedScenarios = report.scenarios.filter((item) => item.status !== "passed");
  const failedWithEvidence = failedScenarios.filter((item) => item.detail != null && String(item.detail || "").trim().length > 0);

  const p0Count = report.defects.filter((item) => item.severity === "P0").length;
  const p1Count = report.defects.filter((item) => item.severity === "P1").length;

  report.acceptance.totalWidgets = report.inventory.length;
  report.acceptance.coverageCount = testedWidgets.size;
  report.acceptance.widgetCoverage = testedWidgets.size >= report.inventory.length;
  report.acceptance.executedScenarios = report.scenarios.length;
  report.acceptance.allScenariosExecuted = report.scenarios.length >= 20;
  report.acceptance.p0Count = p0Count;
  report.acceptance.p1Count = p1Count;
  report.acceptance.zeroP0P1 = p0Count === 0 && p1Count === 0;
  report.acceptance.evidenceForFailures = failedWithEvidence.length === failedScenarios.length;
  report.acceptance.hasFixQueue = report.defects.length > 0 || report.scenarios.length > 0;

  const stamp = sanitizeStamp(generatedAt);
  const jsonPath = path.join(OUTPUT_DIR, `dashboard-troubleshoot-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `dashboard-troubleshoot-${stamp}.md`);
  const latestJson = path.join(OUTPUT_DIR, "dashboard-troubleshoot-latest.json");
  const latestMd = path.join(OUTPUT_DIR, "dashboard-troubleshoot-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, buildMarkdownReport(report));
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestMd, buildMarkdownReport(report));

  const anyBaselineFail = report.baseline.some((item) => item.exitCode !== 0);
  const anyApiFail = report.apiChecks.some((item) => item.status !== "passed");
  const anyScenarioFail = report.scenarios.some((item) => item.status !== "passed");

  console.log(`Dashboard troubleshooting report written:`);
  console.log(`- ${jsonPath}`);
  console.log(`- ${mdPath}`);
  console.log(`Latest:`);
  console.log(`- ${latestJson}`);
  console.log(`- ${latestMd}`);
  console.log(`Summary: scenarios=${report.scenarios.length}, failed=${report.scenarios.filter((s) => s.status !== "passed").length}, defects=${report.defects.length}`);

  if (anyBaselineFail || anyApiFail || anyScenarioFail) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(formatError(err));
  process.exitCode = 1;
});
