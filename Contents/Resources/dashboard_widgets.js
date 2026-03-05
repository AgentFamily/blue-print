(() => {
  "use strict";

  const DASHBOARD_LAYOUT_VERSION = 1;
  const DASHBOARD_ROLE_KEY = "atlasDashboardRoleV1";
  const DASHBOARD_USER_ID_KEY = "atlasDashboardUserIdV1";
  const DASHBOARD_LAYOUT_KEY_PREFIX = "atlasDashboardLayoutV1";
  const DASHBOARD_API_PATH = "/api/dashboard-layout";
  const ROLE_VALUES = new Set(["user", "admin"]);
  const MOBILE_QUERY = "(max-width: 700px)";
  const TABLET_QUERY = "(max-width: 1100px)";
  const ENGINE_TOOL_WIDGET_KEY = "atlasEngineToolWidgetsV1";
  const ENGINE_TOOL_WIDGET_EVENT = "atlas-engine-tool-widgets-updated";
  const ENGINE_TOOL_WIDGET_LIMIT = 60;
  const API_USAGE_WIDGET_KEY = "atlasDashboardApiUsageV1";
  const API_USAGE_WIDGET_EVENT = "atlas-dashboard-api-usage-updated";
  const VAULT_STATUS_EVENT = "atlas-vault-state-updated";
  const API_USAGE_WIDGET_ID = "top_api_usage";
  const API_USAGE_WIDGET_LIMIT = 10;
  const API_USAGE_WIDGET_MAX_KEYS = 180;
  const API_ACCESS_STATUS_COOLDOWN_MS = 10000;
  const API_MARKETPLACE_LAST_OPEN_KEY = "atlasApiMarketplaceLastOpenV1";
  const FASTHOSTS_WIDGET_ID = "fasthosts_manager";
  const FASTHOSTS_WIDGET_STORAGE_KEY = "atlasFasthostsDomainV1";
  const FASTHOSTS_WIDGET_ALERTS_KEY = "atlasFasthostsAlertsV1";
  const FASTHOSTS_WIDGET_SYSTEM_ACK_KEY = "atlasFasthostsSystemAlertAcksV1";
  const FASTHOSTS_WIDGET_NOTIFY_KEY = "atlasFasthostsAlertNotifyLedgerV1";
  const FASTHOSTS_WIDGET_ALERT_EVENT = "atlas-fasthosts-alert";
  const FASTHOSTS_ALERT_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const SERVER_MONITOR_WIDGET_ID = "server_monitor_plesk";
  const SERVER_MONITOR_AUTO_REFRESH_MS = 60 * 1000;
  const AGENT_BUDGET_WIDGET_ID = "agent_budget_wallet";
  const AGENT_BUDGET_WIDGET_KEY = "atlasAgentBudgetWalletV1";
  const AGENT_BUDGET_WIDGET_EVENT = "atlas-agent-budget-updated";
  const FOLLOWUP_CALENDAR_WIDGET_ID = "agent_followup_calendar";
  const FOLLOWUP_CALENDAR_WIDGET_KEY = "atlasAgentFollowupsV1";
  const FOLLOWUP_CALENDAR_WIDGET_EVENT = "atlas-agent-followups-updated";
  const FOLLOWUP_CALENDAR_MIGRATION_KEY = "atlasFollowupRuntimeMigratedV1";
  const WELCOME_BOARD_WIDGET_ID = "blueprint_welcome_board";
  const STOVE_WIDGET_ID = "stove";
  const STARTER_WIDGET_MODE = true;
  const STARTER_LAYOUT_APPLIED_KEY_PREFIX = "atlasDashboardStarterLayoutV2";
  const STARTER_WIDGET_IDS = Object.freeze([STOVE_WIDGET_ID, WELCOME_BOARD_WIDGET_ID]);
  const WIDGET_BOARD_STORAGE_KEY = "atlasWidgetBoardV1";
  const WIDGET_BOARD_MAX_WIDGETS = 120;
  const WIDGET_BOARD_TYPES = ["notes", "checklist", "metrics", "link"];
  const FOLLOWUP_FALLBACK_STATE = {
    tasks: []
  };
  const FOLLOWUP_CALENDAR_UI_STATE = {
    expanded: false,
    monthKey: "",
    selectedDay: ""
  };

  const WIDGET_REGISTRY = [
    {
      id: WELCOME_BOARD_WIDGET_ID,
      name: "Widget Board",
      description: "Primary launch board for grouped widgets and categories.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 12, maxW: 12, maxH: 72 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#blueprint-welcome-board",
      defaultProps: { title: "", refreshSec: 0, defaultH: 24 },
      source: "welcome_board",
      componentId: "blueprint-welcome-board"
    },
    {
      id: "hero_overview",
      name: "Hero Overview",
      description: "Top-level blueprint summary and deployment zones.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 12, maxW: 12, maxH: 48 },
      allowedRoles: ["user", "admin"],
      componentSelector: ".hero",
      defaultProps: { title: "", refreshSec: 0, defaultH: 18 }
    },
    {
      id: "assistant_chat",
      name: "Chat Assistant",
      description: "Prompt and assistant workflow panel.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 14, maxW: 12, maxH: 64 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#assistant-chat",
      defaultProps: { title: "", refreshSec: 0, defaultH: 22 }
    },
    {
      id: "mail_memory_signal",
      name: "Mail Memory + Signaling",
      description: "Mail identity link, memory writes, and signal events.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 12, maxW: 12, maxH: 56 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#mail-memory-signal",
      defaultProps: { title: "", refreshSec: 0, defaultH: 20 }
    },
    {
      id: "secure_vault",
      name: "Secure Vault",
      description: "Encrypted key vault and credential controls.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 14, maxW: 12, maxH: 64 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#vault",
      defaultProps: { title: "", refreshSec: 0, defaultH: 20 }
    },
    {
      id: "strategic_workbench",
      name: "Strategic Workbench",
      description: "Plan generation, execution tasks, and progress.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 16, maxW: 12, maxH: 72 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#strategic-workbench",
      defaultProps: { title: "", refreshSec: 0, defaultH: 24 }
    },
    {
      id: STOVE_WIDGET_ID,
      name: "Stove",
      description: "Cook and load blueprint widgets/tools with functional scaffold output.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 14, maxW: 12, maxH: 72 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#stove",
      defaultProps: { title: "", refreshSec: 0, defaultH: 24 }
    },
    {
      id: "agent_browser",
      name: "Agent Browser",
      description: "Browser mode, nav controls, and embedded frame.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 18, maxW: 12, maxH: 84 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#agent-browser",
      defaultProps: { title: "", refreshSec: 0, defaultH: 30 }
    },
    {
      id: "standard_pricing_agent",
      name: "Standard Pricing Agent",
      description: "Quote model controls and standard output.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 14, maxW: 12, maxH: 64 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#standard-pricing-agent",
      defaultProps: { title: "", refreshSec: 0, defaultH: 20 }
    },
    {
      id: "openclaw_verify",
      name: "OpenClaw Verification",
      description: "Spec checklist and browser verification.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 14, maxW: 12, maxH: 64 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#openclaw-verify",
      defaultProps: { title: "", refreshSec: 0, defaultH: 24 }
    },
    {
      id: "diagnostics",
      name: "Diagnostics",
      description: "Browser/runtime diagnostics, service worker state, and cache reset.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 10, maxW: 12, maxH: 56 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#diagnostics",
      defaultProps: { title: "", refreshSec: 0, defaultH: 16 }
    },
    {
      id: API_USAGE_WIDGET_ID,
      name: "Top 10 APIs",
      description: "Most-used API endpoints observed by this browser profile.",
      defaultSize: "medium",
      constraints: { minW: 4, minH: 10, maxW: 12, maxH: 56 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#top-api-usage",
      defaultProps: { title: "", refreshSec: 0, defaultH: 16 },
      defaultEnabled: false,
      source: "api_usage",
      componentId: "top-api-usage"
    },
    {
      id: FASTHOSTS_WIDGET_ID,
      name: "Fasthosts Manager",
      description: "Domain monitor for WHOIS, DNS, SSL, expiry, and registrar health.",
      defaultSize: "medium",
      constraints: { minW: 4, minH: 12, maxW: 12, maxH: 72 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#fasthosts-manager",
      defaultProps: { title: "", refreshSec: 0, defaultH: 18 },
      source: "fasthosts",
      componentId: "fasthosts-manager"
    },
    {
      id: SERVER_MONITOR_WIDGET_ID,
      name: "Server Monitor (Plesk/WebPros)",
      description: "Admin monitor for VPS health, updates, SSL, and alert notifications.",
      defaultSize: "medium",
      constraints: { minW: 4, minH: 14, maxW: 12, maxH: 96 },
      allowedRoles: ["admin"],
      componentSelector: "#server-monitor-plesk",
      defaultProps: { title: "", refreshSec: 0, defaultH: 24 },
      source: "server_monitor_plesk",
      componentId: "server-monitor-plesk"
    },
    {
      id: AGENT_BUDGET_WIDGET_ID,
      name: "Budget Wallet (Stripe/PayPal)",
      description: "Agent spend controls with provider mode, budget guardrails, and transaction ledger.",
      defaultSize: "medium",
      constraints: { minW: 4, minH: 12, maxW: 12, maxH: 84 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#agent-budget-wallet",
      defaultProps: { title: "", refreshSec: 0, defaultH: 20 },
      defaultEnabled: false,
      source: "agent_budget",
      componentId: "agent-budget-wallet"
    },
    {
      id: FOLLOWUP_CALENDAR_WIDGET_ID,
      name: "Follow-up Calendar",
      description: "Timeline for previously organized tasks with overdue alerts, snooze, and completion tracking.",
      defaultSize: "medium",
      constraints: { minW: 4, minH: 12, maxW: 12, maxH: 96 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#agent-followup-calendar",
      defaultProps: { title: "", refreshSec: 0, defaultH: 22 },
      defaultEnabled: false,
      source: "followup_calendar",
      componentId: "agent-followup-calendar"
    },
    {
      id: "automation_map",
      name: "Automation Map",
      description: "Route map and inspector.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 20, maxW: 12, maxH: 96 },
      allowedRoles: ["user", "admin"],
      componentSelector: "section.atlas",
      defaultProps: { title: "", refreshSec: 0, defaultH: 34 }
    },
    {
      id: "route_specs",
      name: "All Route Specs",
      description: "Spec board view for all route nodes.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 10, maxW: 12, maxH: 56 },
      allowedRoles: ["user", "admin"],
      componentSelector: "section.spec-board",
      defaultProps: { title: "", refreshSec: 0, defaultH: 16 }
    },
    {
      id: "automation_territories",
      name: "Automation Territories",
      description: "District-level summary cards.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 8, maxW: 12, maxH: 40 },
      allowedRoles: ["user", "admin"],
      componentSelector: "section.territories",
      defaultProps: { title: "", refreshSec: 0, defaultH: 14 }
    },
    {
      id: "end_of_day",
      name: "End of Day",
      description: "Agent report, density metrics, and export actions.",
      defaultSize: "large",
      constraints: { minW: 6, minH: 18, maxW: 12, maxH: 96 },
      allowedRoles: ["user", "admin"],
      componentSelector: "#end-of-day",
      defaultProps: { title: "", refreshSec: 0, defaultH: 36 }
    }
  ];

  const REGISTRY_BY_ID = new Map(WIDGET_REGISTRY.map((item) => [item.id, item]));

  const state = {
    role: "user",
    userId: "",
    editMode: false,
    mobileDragEnabled: false,
    layout: null,
    grid: null,
    root: null,
    shells: new Map(),
    saveTimer: null,
    saveStamp: 0,
    resizeSession: null,
    pointerDrag: null,
    layoutLoadToken: 0,
    gridBootstrapAttempts: 0,
    gridBootstrapTimer: null,
    didInitContext: false,
    activeWidgetId: "",
    ui: {
      controls: null,
      editToggle: null,
      addBtn: null,
      resetBtn: null,
      roleSelect: null,
      userIdInput: null,
      mobileDragToggle: null,
      status: null,
      settingsModal: null,
      addModal: null,
      settingsName: null,
      settingsTitle: null,
      settingsVisible: null,
      settingsSize: null,
      settingsWidth: null,
      settingsHeight: null,
      settingsRefresh: null,
      addSearch: null,
      addList: null
    }
  };

  function isDebugEnabled() {
    try {
      return String(localStorage.getItem("atlasDashboardDebug") || "") === "1";
    } catch {
      return false;
    }
  }

  function debugLog(event, payload) {
    if (!isDebugEnabled()) return;
    try {
      console.debug(`[dashboard] ${String(event || "").trim()}`, payload || {});
    } catch {
      // ignore
    }
  }

  function safeQuery(scope, selector) {
    if (!scope || typeof scope.querySelector !== "function") return null;
    const sel = String(selector || "").trim();
    if (!sel) return null;
    try {
      return scope.querySelector(sel);
    } catch (err) {
      debugLog("selector-invalid", { selector: sel, error: String(err?.message || err || "invalid-selector") });
      return null;
    }
  }

  function selectDashboardRoot() {
    if (state.root && state.root.isConnected) return state.root;
    const topbar = safeQuery(document, "header.topbar");
    if (topbar && topbar.parentElement) {
      let next = topbar.nextElementSibling;
      while (next) {
        if (String(next.tagName || "").toLowerCase() === "main") return next;
        next = next.nextElementSibling;
      }
    }
    return (
      safeQuery(document, "main.shell") ||
      safeQuery(document, "main.wrap") ||
      safeQuery(document, "main")
    );
  }

  function normalizeRole(value) {
    const v = String(value || "").trim().toLowerCase();
    return ROLE_VALUES.has(v) ? v : "user";
  }

  function normalizeUserId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.replace(/[^a-zA-Z0-9._@-]/g, "").slice(0, 120);
  }

  function safeParseJson(raw) {
    try {
      return JSON.parse(String(raw || ""));
    } catch {
      return null;
    }
  }

  function cloneLayout(layout) {
    return safeParseJson(JSON.stringify(layout)) || null;
  }

  function clampInt(value, min, max) {
    const n = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeEngineToolId(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    if (!raw) return "";
    if (raw.startsWith("engine_tool_")) return raw;
    return `engine_tool_${raw}`.slice(0, 64);
  }

  function splitEngineToolList(value, maxItems, maxLen) {
    const itemLimit = Math.max(1, Number(maxItems) || 1);
    const lenLimit = Math.max(1, Number(maxLen) || 60);
    const out = [];
    const seen = new Set();
    const parts = String(value || "").split(/[,\n;]+/);
    for (const part of parts) {
      const item = String(part || "").replace(/\s+/g, " ").trim().slice(0, lenLimit);
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= itemLimit) break;
    }
    return out;
  }

  function normalizeEngineToolRecord(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const fallbackName = `Stove Tool ${Number(index || 0) + 1}`;
    const id = normalizeEngineToolId(raw.id || raw.widgetId || raw.name || fallbackName);
    if (!id) return null;
    const themeRaw = String(raw.theme || "").trim().toLowerCase();
    const theme = ["blueprint", "operations", "audit"].includes(themeRaw) ? themeRaw : "blueprint";
    const name = String(raw.name || fallbackName).replace(/\s+/g, " ").trim().slice(0, 90) || fallbackName;
    const primaryAction = String(raw.primaryAction || "Run").replace(/\s+/g, " ").trim().slice(0, 80) || "Run";
    const intent = String(raw.intent || raw.description || "Generated tool widget.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500) || "Generated tool widget.";
    const description = String(raw.description || intent)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "Generated tool widget.";
    const inputs = splitEngineToolList(raw.inputs, 8, 40);
    const outputs = splitEngineToolList(raw.outputs, 8, 40);
    const dataKeys = splitEngineToolList(raw.dataKeys, 14, 40)
      .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""))
      .filter(Boolean);
    return {
      id,
      name,
      theme,
      primaryAction,
      intent,
      description,
      inputs,
      outputs,
      dataKeys,
      createdAt: String(raw.createdAt || "").trim() || new Date().toISOString(),
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now()
    };
  }

  function buildEngineToolWidgetDef(tool) {
    const componentId = `engine_tool_widget_${tool.id}`;
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description || `Stove tool widget (${tool.theme}).`,
      defaultSize: "medium",
      constraints: { minW: 4, minH: 10, maxW: 12, maxH: 72 },
      allowedRoles: ["user", "admin"],
      componentSelector: `#${componentId}`,
      defaultProps: { title: "", refreshSec: 0, defaultH: 16 },
      defaultEnabled: false,
      source: "engine_tool",
      componentId,
      engineTool: tool
    };
  }

  function loadEngineToolRecords() {
    try {
      const raw = String(localStorage.getItem(ENGINE_TOOL_WIDGET_KEY) || "").trim();
      if (!raw) return [];
      const parsed = safeParseJson(raw);
      if (!Array.isArray(parsed)) return [];
      const out = [];
      const seen = new Set();
      for (let i = 0; i < parsed.length; i += 1) {
        const next = normalizeEngineToolRecord(parsed[i], i);
        if (!next || seen.has(next.id)) continue;
        seen.add(next.id);
        out.push(next);
        if (out.length >= ENGINE_TOOL_WIDGET_LIMIT) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function applyEngineToolRegistry() {
    for (let i = WIDGET_REGISTRY.length - 1; i >= 0; i -= 1) {
      if (String(WIDGET_REGISTRY[i]?.source || "") !== "engine_tool") continue;
      const id = String(WIDGET_REGISTRY[i]?.id || "").trim();
      if (id) REGISTRY_BY_ID.delete(id);
      WIDGET_REGISTRY.splice(i, 1);
    }
    const records = loadEngineToolRecords();
    for (const record of records) {
      const def = buildEngineToolWidgetDef(record);
      WIDGET_REGISTRY.push(def);
      REGISTRY_BY_ID.set(def.id, def);
    }
  }

  function engineToolFieldKey(label, index) {
    const raw = String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "");
    return raw || `field_${Number(index || 0) + 1}`;
  }

  function engineToolOutputValue(label, payload) {
    const key = engineToolFieldKey(label, 0);
    if (payload && Object.prototype.hasOwnProperty.call(payload, key) && String(payload[key] || "").trim()) {
      return String(payload[key] || "").trim();
    }
    return "ready";
  }

  function renderEngineToolComponent(node, widgetDef) {
    if (!node || !widgetDef || typeof node.innerHTML !== "string") return;
    const tool = widgetDef.engineTool || {};
    const inputs = Array.isArray(tool.inputs) ? tool.inputs : [];
    const outputs = Array.isArray(tool.outputs) ? tool.outputs : [];
    const dataKeys = Array.isArray(tool.dataKeys) ? tool.dataKeys : [];
    const renderHash = safeParseJson(JSON.stringify({
      id: widgetDef.id,
      name: tool.name,
      action: tool.primaryAction,
      intent: tool.intent,
      inputs,
      outputs,
      dataKeys
    }));
    const hashText = JSON.stringify(renderHash || {});
    if (node.dataset.engineToolHash === hashText) return;
    node.dataset.engineToolHash = hashText;

    node.className = "blueprint-card engine-tool-widget";
    node.innerHTML = `
      <h3>${escapeHtml(String(tool.name || widgetDef.name || "Stove Tool"))}</h3>
      <div class="engine-tool-grid">
        <p class="engine-tool-intent">${escapeHtml(String(tool.intent || "Generated tool widget."))}</p>
        <div class="engine-tool-inputs">
          ${inputs.map((label, index) => (
            `<label>${escapeHtml(String(label || `Input ${index + 1}`))}
              <input type="text" data-engine-tool-input="${escapeHtml(engineToolFieldKey(label, index))}" autocomplete="off" />
            </label>`
          )).join("")}
        </div>
        <div class="engine-tool-actions">
          <button type="button" data-engine-tool-run>${escapeHtml(String(tool.primaryAction || "Run"))}</button>
        </div>
        <div class="engine-tool-status" data-engine-tool-status>Ready.</div>
        <pre class="engine-tool-output" data-engine-tool-output>{}</pre>
      </div>
    `;

    const runBtn = node.querySelector("button[data-engine-tool-run]");
    const outputNode = node.querySelector("[data-engine-tool-output]");
    const statusNode = node.querySelector("[data-engine-tool-status]");
    runBtn?.addEventListener("click", () => {
      const payload = {};
      node.querySelectorAll("input[data-engine-tool-input]").forEach((input) => {
        const key = String(input.getAttribute("data-engine-tool-input") || "").trim();
        if (!key) return;
        payload[key] = String(input.value || "").trim();
      });
      for (const keyRaw of dataKeys) {
        const key = String(keyRaw || "").trim();
        if (!key || Object.prototype.hasOwnProperty.call(payload, key)) continue;
        payload[key] = "";
      }
      const result = {
        tool_id: widgetDef.id,
        generated_at: new Date().toISOString(),
        inputs: payload,
        outputs: Object.fromEntries(outputs.map((label) => [engineToolFieldKey(label, 0), engineToolOutputValue(label, payload)]))
      };
      if (outputNode) outputNode.textContent = JSON.stringify(result, null, 2);
      if (statusNode) statusNode.textContent = `${String(tool.primaryAction || "Run")} complete.`;
    });
  }

  function ensureEngineToolComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "engine_tool") return null;
    const componentId = String(widgetDef.componentId || "").trim() || `engine_tool_widget_${widgetDef.id}`;
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderEngineToolComponent(node, widgetDef);
    return node;
  }

  function isTrackableApiPath(pathname) {
    const path = String(pathname || "").trim().toLowerCase();
    if (!path) return false;
    return (
      path === "/api" ||
      path.startsWith("/api/") ||
      path.startsWith("/browser/") ||
      path.startsWith("/eod/") ||
      path.startsWith("/oauth/")
    );
  }

  function normalizeApiUsageRoute(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(String(rawUrl), window.location.origin);
      const path = String(url.pathname || "").replace(/\/{2,}/g, "/").trim();
      if (!isTrackableApiPath(path)) return "";
      const normalizedPath = path
        .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/:id")
        .replace(/\/\d{2,}(?=\/|$)/g, "/:id")
        .slice(0, 180);
      const sameOrigin = String(url.host || "").toLowerCase() === String(window.location.host || "").toLowerCase();
      if (sameOrigin) return normalizedPath || "/";
      return `${String(url.host || "").toLowerCase()}${normalizedPath || "/"}`.slice(0, 200);
    } catch {
      return "";
    }
  }

  function normalizeApiUsageMap(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const entries = [];
    for (const [key, value] of Object.entries(source)) {
      const route = normalizeApiUsageRoute(key);
      const count = Math.max(0, Number.parseInt(String(value || "0"), 10) || 0);
      if (!route || count <= 0) continue;
      entries.push([route, count]);
    }
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const trimmed = entries.slice(0, API_USAGE_WIDGET_MAX_KEYS);
    return Object.fromEntries(trimmed);
  }

  function loadApiUsageMap() {
    try {
      const raw = String(localStorage.getItem(API_USAGE_WIDGET_KEY) || "").trim();
      if (!raw) return {};
      const parsed = safeParseJson(raw);
      return normalizeApiUsageMap(parsed);
    } catch {
      return {};
    }
  }

  function saveApiUsageMap(map) {
    try {
      localStorage.setItem(API_USAGE_WIDGET_KEY, JSON.stringify(normalizeApiUsageMap(map)));
      return true;
    } catch {
      return false;
    }
  }

  function topApiUsageRows() {
    return Object.entries(loadApiUsageMap())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, API_USAGE_WIDGET_LIMIT)
      .map(([route, count], index) => ({ rank: index + 1, route, count: Math.max(0, Number(count) || 0) }));
  }

  function loadApiMarketplaceLastOpen() {
    try {
      const raw = String(localStorage.getItem(API_MARKETPLACE_LAST_OPEN_KEY) || "").trim();
      if (!raw) return null;
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const at = Number(parsed.at || 0);
      return {
        at: Number.isFinite(at) && at > 0 ? at : 0,
        workspaceId: normalizeWorkspaceId(parsed.workspaceId || ""),
        url: String(parsed.url || "").trim(),
        source: String(parsed.source || "").trim().slice(0, 32)
      };
    } catch {
      return null;
    }
  }

  function apiMarketplaceOpenLabel(meta) {
    if (!meta || !meta.at) return "never opened";
    try {
      return `opened ${new Date(meta.at).toLocaleTimeString()}`;
    } catch {
      return "opened";
    }
  }

  function normalizeWorkspaceId(value) {
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, 120);
  }

  function resolveWorkspaceIdHint() {
    const fromSignal = normalizeWorkspaceId(document.getElementById("signal_workspace_id")?.value || "");
    if (fromSignal) return fromSignal;
    return "";
  }

  function findActiveConnection(connections) {
    if (!Array.isArray(connections)) return null;
    return connections.find((item) => String(item?.status || "").toLowerCase() === "active") || null;
  }

  function normalizeConnectorAccessRows(connectors) {
    const source = Array.isArray(connectors) ? connectors : [];
    const rows = [];
    for (const row of source) {
      if (!row || typeof row !== "object") continue;
      const id = String(row.id || "").trim();
      if (!id) continue;
      const label = String(row.label || id).trim() || id;
      const active = findActiveConnection(row.connections);
      const updatedAt = Date.parse(String(active?.updatedAt || ""));
      rows.push({
        id,
        label,
        authType: String(row.authType || "apiKey"),
        connected: Boolean(active),
        connectionId: active ? String(active.id || "") : "",
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        installUrl: String(row?.actions?.installConnectorUrl || "").trim(),
        testUrl: String(row?.actions?.testConnectorUrl || "").trim(),
        usedByWidgets: Array.isArray(row.usedByWidgets) ? row.usedByWidgets.map((item) => String(item?.name || "").trim()).filter(Boolean) : []
      });
    }
    rows.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return rows;
  }

  function ensureApiUsageState(node) {
    if (!node || typeof node !== "object") return null;
    if (!node.__apiUsageState || typeof node.__apiUsageState !== "object") {
      node.__apiUsageState = {
        accessBusy: false,
        accessError: "",
        accessFetchedAt: 0,
        didInitialAccessCheck: false,
        auth: {
          loggedIn: false,
          userId: "",
          userEmail: "",
          workspaces: []
        },
        workspaceId: "",
        connectors: []
      };
    }
    return node.__apiUsageState;
  }

  function apiAccessTimeLabel(msValue) {
    const ms = Number(msValue);
    if (!Number.isFinite(ms) || ms <= 0) return "never";
    try {
      return new Date(ms).toLocaleTimeString();
    } catch {
      return new Date(ms).toISOString();
    }
  }

  function inferVaultAccessState() {
    const opsLabel = String(document.getElementById("ops_vault_status")?.textContent || "").trim();
    const vaultLabel = String(document.getElementById("vault_status")?.textContent || "").trim();
    const text = opsLabel || vaultLabel || "Unknown";
    const lower = text.toLowerCase();
    if (lower.includes("unavailable")) {
      return { level: "error", label: text };
    }
    if (lower.includes("unlock")) {
      return { level: "ok", label: text };
    }
    if (lower.includes("lock")) {
      return { level: "warn", label: text };
    }
    return { level: "warn", label: text };
  }

  async function fetchJsonNoThrow(url, init) {
    try {
      const response = await fetch(url, { cache: "no-store", ...(init || {}) });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    } catch (error) {
      return { response: null, payload: null, error };
    }
  }

  function parseApiErrorLabel(result, fallback) {
    if (!result) return fallback;
    if (result.error) return String(result.error?.message || result.error || fallback);
    const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
    const message = String(payload.message || payload.error || "").trim();
    if (message) return message;
    const status = Number(result.response?.status || 0);
    return status ? `${fallback} (${status})` : fallback;
  }

  async function refreshApiAccessStatus(node, widgetDef, options) {
    const stateObj = ensureApiUsageState(node);
    if (!stateObj) return;
    if (!node.isConnected) return;
    const force = Boolean(options?.force);
    const now = Date.now();
    if (stateObj.accessBusy) return;
    if (!force && stateObj.accessFetchedAt > 0 && (now - stateObj.accessFetchedAt) < API_ACCESS_STATUS_COOLDOWN_MS) return;

    stateObj.accessBusy = true;
    stateObj.accessError = "";
    renderApiUsageComponent(node, widgetDef);

    const authSnapshot = {
      loggedIn: false,
      userId: "",
      userEmail: "",
      workspaces: []
    };
    let workspaceId = resolveWorkspaceIdHint();
    let connectors = [];
    let accessError = "";

    const authResult = await fetchJsonNoThrow("/api/auth/me", { method: "GET" });
    if (authResult.response?.ok && authResult.payload?.ok === true) {
      const payload = authResult.payload || {};
      authSnapshot.loggedIn = true;
      authSnapshot.userId = String(payload?.user?.id || "").trim();
      authSnapshot.userEmail = String(payload?.user?.email || "").trim();
      authSnapshot.workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
      if (!workspaceId) {
        workspaceId = normalizeWorkspaceId(authSnapshot.workspaces[0]?.id || "");
      }
    } else if (authResult.response?.status === 401) {
      authSnapshot.loggedIn = false;
    } else {
      accessError = parseApiErrorLabel(authResult, "Could not verify browser auth session");
    }

    if (authSnapshot.loggedIn) {
      const connectorResult = await fetchJsonNoThrow(`/api/connectors?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "GET" });
      if (connectorResult.response?.ok && connectorResult.payload?.ok === true) {
        workspaceId = normalizeWorkspaceId(connectorResult.payload.workspaceId || workspaceId);
        connectors = normalizeConnectorAccessRows(connectorResult.payload.connectors);
      } else {
        accessError = accessError || parseApiErrorLabel(connectorResult, "Could not load connector access");
      }
    }

    stateObj.auth = authSnapshot;
    stateObj.workspaceId = workspaceId;
    stateObj.connectors = connectors;
    stateObj.accessError = accessError;
    stateObj.accessFetchedAt = Date.now();
    stateObj.accessBusy = false;
    if (!node.isConnected) return;
    renderApiUsageComponent(node, widgetDef);
  }

  function emitApiUsageUpdate(detail) {
    try {
      window.dispatchEvent(new CustomEvent(API_USAGE_WIDGET_EVENT, { detail: detail || {} }));
    } catch {
      // ignore
    }
  }

  function recordApiUsage(rawUrl) {
    const route = normalizeApiUsageRoute(rawUrl);
    if (!route) return;
    const map = loadApiUsageMap();
    map[route] = Math.max(0, Number.parseInt(String(map[route] || "0"), 10) || 0) + 1;
    saveApiUsageMap(map);
    emitApiUsageUpdate({ route, count: map[route] });
  }

  function publishApiUsageBridge() {
    try {
      window.__atlasRecordApiUsage = (value) => {
        recordApiUsage(value);
      };
      const queued = Array.isArray(window.__atlasPendingApiUsage) ? window.__atlasPendingApiUsage : [];
      if (queued.length) {
        for (const item of queued) recordApiUsage(item);
        window.__atlasPendingApiUsage = [];
      }
    } catch {
      // ignore
    }
  }

  function fetchInputUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (typeof input?.url === "string") return input.url;
    return "";
  }

  function installApiUsageTracker() {
    if (window.__atlasApiUsageTrackerInstalled) return;
    if (typeof window.fetch !== "function") return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function dashboardTrackedFetch(input, init) {
      try {
        recordApiUsage(fetchInputUrl(input));
      } catch {
        // ignore
      }
      return originalFetch(input, init);
    };
    window.__atlasApiUsageTrackerInstalled = true;
  }

  function renderApiUsageComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    const apiState = ensureApiUsageState(node);
    if (!apiState) return;
    const rows = topApiUsageRows();
    node.className = "blueprint-card api-usage-widget";

    const rowsHtml = rows.length
      ? rows.map((row) => (
        `<li><span class="api-usage-route">${escapeHtml(row.route)}</span><strong>${escapeHtml(String(row.count))}</strong></li>`
      )).join("")
      : `<li class="api-usage-empty">No API requests tracked yet. Use the app and click Refresh.</li>`;

    const auth = apiState.auth || {};
    const vaultState = inferVaultAccessState();
    const connectors = Array.isArray(apiState.connectors) ? apiState.connectors : [];
    const connectedCount = connectors.reduce((sum, row) => sum + (row.connected ? 1 : 0), 0);
    const authLabel = auth.loggedIn
      ? `Logged in${auth.userEmail ? ` as ${auth.userEmail}` : ""}`
      : "Not logged in";
    const authLevelClass = auth.loggedIn ? "is-ok" : "is-warn";
    const vaultLevelClass = vaultState.level === "error" ? "is-error" : vaultState.level === "ok" ? "is-ok" : "is-warn";
    const workspaceId = normalizeWorkspaceId(apiState.workspaceId || "");
    const installCenterHref = `/api/connectors?workspaceId=${encodeURIComponent(workspaceId || "ws_core")}&view=install`;
    const marketMeta = loadApiMarketplaceLastOpen();
    const marketLabel = apiMarketplaceOpenLabel(marketMeta);
    const connectorsHtml = connectors.length
      ? connectors.map((row) => {
        const badgeClass = row.connected ? "is-ok" : "is-warn";
        const badgeLabel = row.connected ? "Connected" : "Not connected";
        const widgetNames = row.usedByWidgets.length ? row.usedByWidgets.join(", ") : "General";
        const stamp = row.updatedAt > 0 ? apiAccessTimeLabel(row.updatedAt) : "n/a";
        const meta = `${row.authType} | ${widgetNames}`;
        const actions = [];
        if (row.installUrl) actions.push(`<a href="${escapeHtml(row.installUrl)}" target="_blank" rel="noreferrer">Install</a>`);
        if (row.testUrl) actions.push(`<a href="${escapeHtml(row.testUrl)}" target="_blank" rel="noreferrer">Test</a>`);
        return `
          <li class="api-access-item">
            <div class="api-access-item-main">
              <strong>${escapeHtml(row.label)}</strong>
              <span>${escapeHtml(meta)}</span>
              <span>Updated: ${escapeHtml(stamp)}</span>
            </div>
            <div class="api-access-item-side">
              <span class="api-access-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
              <div class="api-access-links">${actions.join(" ")}</div>
            </div>
          </li>
        `;
      }).join("")
      : `<li class="api-access-empty">${auth.loggedIn ? "No connectors returned for this workspace." : "Log in to check connector status."}</li>`;

    const renderHash = JSON.stringify({
      rows,
      accessBusy: Boolean(apiState.accessBusy),
      accessError: String(apiState.accessError || ""),
      authLoggedIn: Boolean(auth.loggedIn),
      authUserEmail: String(auth.userEmail || ""),
      workspaceId,
      connectorCount: connectors.length,
      connectedCount,
      connectorStamp: connectors.map((row) => `${row.id}:${row.connected ? "1" : "0"}:${row.updatedAt}`).join("|"),
      vaultLabel: String(vaultState.label || ""),
      fetchedAt: Number(apiState.accessFetchedAt || 0),
      marketAt: Number(marketMeta?.at || 0),
      marketWorkspace: String(marketMeta?.workspaceId || ""),
      marketSource: String(marketMeta?.source || "")
    });
    if (node.dataset.apiUsageRenderHash === renderHash) return;
    node.dataset.apiUsageRenderHash = renderHash;

    node.innerHTML = `
      <h3>${escapeHtml(String(widgetDef.name || "Top 10 APIs"))}</h3>
      <p class="api-usage-meta">Browser-local frequency across API endpoints.</p>
      <div class="api-usage-actions">
        <button type="button" data-api-usage-refresh>Refresh</button>
        <button type="button" data-api-usage-reset>Reset</button>
        <button type="button" data-api-access-refresh>${apiState.accessBusy ? "Checking..." : "Check Access"}</button>
        <a class="api-access-install-link" data-api-marketplace-open href="${escapeHtml(installCenterHref)}" target="_blank" rel="noreferrer">API MarketPlace</a>
      </div>
      <ol class="api-usage-list">${rowsHtml}</ol>
      <div class="api-access-panel">
        <div class="api-access-summary">
          <span>Browser Auth: <strong class="api-access-badge ${authLevelClass}">${escapeHtml(authLabel)}</strong></span>
          <span>Browser Vault: <strong class="api-access-badge ${vaultLevelClass}">${escapeHtml(vaultState.label)}</strong></span>
          <span>Workspace: <strong>${escapeHtml(workspaceId || "n/a")}</strong></span>
          <span>Connectors: <strong>${escapeHtml(`${connectedCount}/${connectors.length}`)}</strong></span>
          <span>Last Check: <strong>${escapeHtml(apiAccessTimeLabel(apiState.accessFetchedAt))}</strong></span>
          <span>API MarketPlace: <strong>${escapeHtml(marketLabel)}</strong></span>
        </div>
        <ul class="api-access-list">${connectorsHtml}</ul>
        ${apiState.accessError ? `<div class="api-access-error">${escapeHtml(apiState.accessError)}</div>` : ""}
      </div>
    `;

    node.querySelector("[data-api-usage-refresh]")?.addEventListener("click", () => {
      renderApiUsageComponent(node, widgetDef);
    });

    node.querySelector("[data-api-usage-reset]")?.addEventListener("click", () => {
      if (!window.confirm("Reset tracked API usage history for this browser profile?")) return;
      saveApiUsageMap({});
      emitApiUsageUpdate({ reset: true });
      renderApiUsageComponent(node, widgetDef);
    });

    node.querySelector("[data-api-access-refresh]")?.addEventListener("click", () => {
      void refreshApiAccessStatus(node, widgetDef, { force: true });
    });

    node.querySelector("[data-api-marketplace-open]")?.addEventListener("click", () => {
      try {
        localStorage.setItem(API_MARKETPLACE_LAST_OPEN_KEY, JSON.stringify({
          at: Date.now(),
          workspaceId: workspaceId || "ws_core",
          url: installCenterHref,
          source: "top_api_widget"
        }));
      } catch {
        // ignore
      }
      recordApiUsage(installCenterHref);
    });

    if (!apiState.didInitialAccessCheck && node.isConnected) {
      apiState.didInitialAccessCheck = true;
      void refreshApiAccessStatus(node, widgetDef, { force: true });
    }
  }

  function ensureApiUsageComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "api_usage") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "top-api-usage";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderApiUsageComponent(node, widgetDef);
    return node;
  }

  function widgetBoardCategoryTemplate() {
    return [
      { id: "board_marketing", name: "Marketing" },
      { id: "board_valuation", name: "Valuation" },
      { id: "board_finder", name: "Finder" },
      { id: "board_operations", name: "Operations" }
    ];
  }

  function widgetBoardNormalizeId(value, fallback) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_:-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return raw || String(fallback || `widget_${Date.now()}`).trim();
  }

  function widgetBoardNormalizeWidget(rawWidget, index) {
    const raw = rawWidget && typeof rawWidget === "object" ? rawWidget : {};
    const typeCandidate = String(raw.type || "notes").trim().toLowerCase();
    const type = WIDGET_BOARD_TYPES.includes(typeCandidate) ? typeCandidate : "notes";
    const title = String(raw.title || `Widget ${Number(index || 0) + 1}`)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || `Widget ${Number(index || 0) + 1}`;
    const cfg = raw.config && typeof raw.config === "object" ? raw.config : {};
    return {
      id: widgetBoardNormalizeId(raw.id, `widget_${Date.now()}_${index}`),
      type,
      title,
      config: safeParseJson(JSON.stringify(cfg)) || {}
    };
  }

  function widgetBoardDefaultBoards() {
    return widgetBoardCategoryTemplate().map((row) => ({
      id: row.id,
      name: row.name,
      widgets: []
    }));
  }

  function widgetBoardNormalizeBoards(rawBoards) {
    const source = Array.isArray(rawBoards) ? rawBoards : [];
    const byName = new Map();
    for (const row of source) {
      if (!row || typeof row !== "object") continue;
      const name = String(row.name || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      if (!name) continue;
      const widgetsSource = Array.isArray(row.widgets) ? row.widgets : [];
      const widgets = [];
      const seen = new Set();
      for (let i = 0; i < widgetsSource.length; i += 1) {
        const next = widgetBoardNormalizeWidget(widgetsSource[i], i);
        if (!next?.id || seen.has(next.id)) continue;
        seen.add(next.id);
        widgets.push(next);
        if (widgets.length >= WIDGET_BOARD_MAX_WIDGETS) break;
      }
      byName.set(name.toLowerCase(), {
        id: widgetBoardNormalizeId(row.id, `board_${name.toLowerCase()}`),
        name,
        widgets
      });
    }

    const ordered = [];
    for (const template of widgetBoardCategoryTemplate()) {
      const matched = byName.get(template.name.toLowerCase());
      if (matched) ordered.push(matched);
      else ordered.push({ id: template.id, name: template.name, widgets: [] });
    }
    return ordered;
  }

  function loadWidgetBoards() {
    try {
      const raw = String(localStorage.getItem(WIDGET_BOARD_STORAGE_KEY) || "").trim();
      if (!raw) return widgetBoardDefaultBoards();
      const parsed = safeParseJson(raw);
      if (!parsed) return widgetBoardDefaultBoards();
      if (Array.isArray(parsed)) return widgetBoardNormalizeBoards(parsed);
      if (Array.isArray(parsed?.boards)) return widgetBoardNormalizeBoards(parsed.boards);
      return widgetBoardDefaultBoards();
    } catch {
      return widgetBoardDefaultBoards();
    }
  }

  function saveWidgetBoards(boards) {
    const safe = widgetBoardNormalizeBoards(boards);
    try {
      localStorage.setItem(WIDGET_BOARD_STORAGE_KEY, JSON.stringify({
        boards: safe,
        updatedAt: Date.now()
      }));
      return safe;
    } catch {
      return safe;
    }
  }

  function widgetBoardActiveBoard(stateObj) {
    if (!stateObj || !Array.isArray(stateObj.boards)) return null;
    const target = String(stateObj.activeBoardId || "").trim();
    const byId = stateObj.boards.find((row) => String(row?.id || "") === target);
    if (byId) return byId;
    return stateObj.boards[0] || null;
  }

  function widgetBoardTypeLabel(type) {
    const key = String(type || "notes").trim().toLowerCase();
    if (key === "checklist") return "Checklist";
    if (key === "metrics") return "Metrics";
    if (key === "link") return "Link";
    return "Notes";
  }

  function widgetBoardDefaultConfig(type) {
    const key = String(type || "").trim().toLowerCase();
    if (key === "checklist") {
      return { items: ["Item one", "Item two", "Item three"] };
    }
    if (key === "metrics") {
      return { value: "0", unit: "points", trend: "+0%" };
    }
    if (key === "link") {
      return { label: "Open resource", url: "https://example.com" };
    }
    return { text: "Add notes here..." };
  }

  function widgetBoardSafeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function widgetBoardRenderModalContent(widget) {
    const item = widget && typeof widget === "object" ? widget : {};
    const type = String(item.type || "notes").trim().toLowerCase();
    const cfg = item.config && typeof item.config === "object" ? item.config : {};
    if (type === "checklist") {
      const rows = Array.isArray(cfg.items) ? cfg.items.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!rows.length) return "<p>No checklist items.</p>";
      return `<ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`;
    }
    if (type === "metrics") {
      const value = String(cfg.value || "0").trim();
      const unit = String(cfg.unit || "").trim();
      const trend = String(cfg.trend || "").trim();
      return `
        <div class="widget-board-metric-view">
          <strong>${escapeHtml(value)} ${escapeHtml(unit)}</strong>
          <span>Trend: ${escapeHtml(trend || "n/a")}</span>
        </div>
      `;
    }
    if (type === "link") {
      const label = String(cfg.label || "Open").trim() || "Open";
      const url = widgetBoardSafeUrl(cfg.url);
      if (!url) return "<p>No link configured.</p>";
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
    }
    const text = String(cfg.text || "").trim();
    return `<p>${escapeHtml(text || "No notes added yet.")}</p>`;
  }

  function ensureWelcomeBoardState(node) {
    if (!node || typeof node !== "object") return null;
    if (!node.__welcomeBoardState || typeof node.__welcomeBoardState !== "object") {
      const boards = loadWidgetBoards();
      node.__welcomeBoardState = {
        boards,
        activeBoardId: String(boards[0]?.id || ""),
        dragWidgetId: "",
        adding: false,
        modal: {
          open: false,
          widgetId: "",
          boardId: "",
          loading: false,
          title: "",
          bodyHtml: ""
        }
      };
    }
    return node.__welcomeBoardState;
  }

  function widgetBoardPersistAndRender(node, widgetDef, stateObj, boards) {
    stateObj.boards = saveWidgetBoards(boards);
    if (!stateObj.boards.some((row) => String(row?.id || "") === String(stateObj.activeBoardId || ""))) {
      stateObj.activeBoardId = String(stateObj.boards[0]?.id || "");
    }
    renderWelcomeBoardComponent(node, widgetDef);
  }

  function widgetBoardOpenModal(node, widgetDef, stateObj, boardId, widgetId) {
    const board = stateObj.boards.find((row) => String(row?.id || "") === String(boardId || ""));
    const widget = board?.widgets?.find((row) => String(row?.id || "") === String(widgetId || ""));
    if (!board || !widget) return;
    stateObj.modal = {
      open: true,
      widgetId: widget.id,
      boardId: board.id,
      loading: true,
      title: widget.title,
      bodyHtml: ""
    };
    renderWelcomeBoardComponent(node, widgetDef);
    window.setTimeout(() => {
      if (!node.isConnected) return;
      stateObj.modal.loading = false;
      stateObj.modal.bodyHtml = widgetBoardRenderModalContent(widget);
      renderWelcomeBoardComponent(node, widgetDef);
    }, 160);
  }

  function widgetBoardCloseModal(stateObj) {
    stateObj.modal = {
      open: false,
      widgetId: "",
      boardId: "",
      loading: false,
      title: "",
      bodyHtml: ""
    };
  }

  function renderWelcomeBoardComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    const stateObj = ensureWelcomeBoardState(node);
    if (!stateObj) return;
    const activeBoard = widgetBoardActiveBoard(stateObj);
    const boards = Array.isArray(stateObj.boards) ? stateObj.boards : [];
    const widgets = Array.isArray(activeBoard?.widgets) ? activeBoard.widgets : [];
    const heading = String(widgetDef.name || "Widget Board");
    const vaultState = inferVaultAccessState();
    const role = normalizeRole(state.role || "user");

    const boardTabsHtml = boards.map((board) => {
      const isActive = String(board?.id || "") === String(activeBoard?.id || "");
      return `<button type="button" class="${isActive ? "is-active" : ""}" data-widget-board-tab="${escapeHtml(String(board?.id || ""))}">${escapeHtml(String(board?.name || "Board"))}</button>`;
    }).join("");

    const cardsHtml = widgets.length
      ? widgets.map((item) => `
        <article class="widget-board-card" draggable="true" data-widget-board-card="${escapeHtml(String(item.id || ""))}">
          <div class="widget-board-card-head">
            <strong>${escapeHtml(String(item.title || "Widget"))}</strong>
            <span>${escapeHtml(widgetBoardTypeLabel(item.type))}</span>
          </div>
          <div class="widget-board-card-actions">
            <button type="button" data-widget-board-open="${escapeHtml(String(item.id || ""))}">Open</button>
            <button type="button" data-widget-board-remove="${escapeHtml(String(item.id || ""))}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<p class="widget-board-empty">No widgets yet in ${escapeHtml(String(activeBoard?.name || "this board"))}. Add one below.</p>`;

    const modalOpen = Boolean(stateObj.modal?.open);
    const modalHtml = modalOpen
      ? `
        <section class="widget-board-modal" data-widget-board-modal>
          <div class="widget-board-modal-dialog">
            <div class="widget-board-modal-head">
              <strong>${escapeHtml(String(stateObj.modal?.title || "Widget"))}</strong>
              <button type="button" data-widget-board-close>Close</button>
            </div>
            <div class="widget-board-modal-body">
              ${stateObj.modal?.loading ? "<p>Loading widget...</p>" : String(stateObj.modal?.bodyHtml || "<p>No content.</p>")}
            </div>
          </div>
        </section>
      `
      : "";

    node.className = "blueprint-card welcome-board-widget";
    node.innerHTML = `
      <section class="widget-board-shell">
        <header class="widget-board-header">
          <div>
            <span class="widget-board-kicker">WidgetBoard</span>
            <h2>${escapeHtml(heading)}</h2>
            <p>Boards are grouped by category labels: Marketing, Valuation, Finder, Operations.</p>
          </div>
          <div class="widget-board-meta">
            <span>Role: <strong>${escapeHtml(role.toUpperCase())}</strong></span>
            <span>Vault: <strong>${escapeHtml(vaultState.label || "Unknown")}</strong></span>
          </div>
        </header>

        <nav class="widget-board-tabs">
          ${boardTabsHtml}
        </nav>

        <section class="widget-board-cards" data-widget-board-cards>
          ${cardsHtml}
        </section>

        <form class="widget-board-add" data-widget-board-add>
          <select data-widget-board-type>
            ${WIDGET_BOARD_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(widgetBoardTypeLabel(type))}</option>`).join("")}
          </select>
          <input type="text" data-widget-board-title maxlength="100" placeholder="New widget title" required />
          <button type="submit">Add Widget</button>
        </form>
      </section>
      ${modalHtml}
    `;

    node.querySelectorAll("button[data-widget-board-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const boardId = String(btn.getAttribute("data-widget-board-tab") || "").trim();
        if (!boardId) return;
        stateObj.activeBoardId = boardId;
        widgetBoardCloseModal(stateObj);
        renderWelcomeBoardComponent(node, widgetDef);
      });
    });

    node.querySelector("form[data-widget-board-add]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const board = widgetBoardActiveBoard(stateObj);
      if (!board) return;
      const type = String(node.querySelector("[data-widget-board-type]")?.value || "notes").trim().toLowerCase();
      const safeType = WIDGET_BOARD_TYPES.includes(type) ? type : "notes";
      const title = String(node.querySelector("[data-widget-board-title]")?.value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
      if (!title) return;
      const nextBoards = stateObj.boards.map((row) => {
        if (String(row?.id || "") !== String(board.id || "")) return row;
        const widgetsNext = Array.isArray(row.widgets) ? row.widgets.slice(0, WIDGET_BOARD_MAX_WIDGETS - 1) : [];
        widgetsNext.push({
          id: widgetBoardNormalizeId(`${safeType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, `widget_${Date.now()}`),
          type: safeType,
          title,
          config: widgetBoardDefaultConfig(safeType)
        });
        return {
          ...row,
          widgets: widgetsNext
        };
      });
      widgetBoardPersistAndRender(node, widgetDef, stateObj, nextBoards);
    });

    node.querySelectorAll("button[data-widget-board-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const widgetId = String(btn.getAttribute("data-widget-board-remove") || "").trim();
        if (!widgetId || !activeBoard) return;
        const nextBoards = stateObj.boards.map((row) => {
          if (String(row?.id || "") !== String(activeBoard.id || "")) return row;
          return {
            ...row,
            widgets: (Array.isArray(row.widgets) ? row.widgets : []).filter((item) => String(item?.id || "") !== widgetId)
          };
        });
        if (String(stateObj.modal?.widgetId || "") === widgetId) {
          widgetBoardCloseModal(stateObj);
        }
        widgetBoardPersistAndRender(node, widgetDef, stateObj, nextBoards);
      });
    });

    node.querySelectorAll("button[data-widget-board-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const widgetId = String(btn.getAttribute("data-widget-board-open") || "").trim();
        if (!widgetId || !activeBoard) return;
        widgetBoardOpenModal(node, widgetDef, stateObj, activeBoard.id, widgetId);
      });
    });

    node.querySelector("[data-widget-board-close]")?.addEventListener("click", () => {
      widgetBoardCloseModal(stateObj);
      renderWelcomeBoardComponent(node, widgetDef);
    });

    node.querySelector("[data-widget-board-modal]")?.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget) return;
      widgetBoardCloseModal(stateObj);
      renderWelcomeBoardComponent(node, widgetDef);
    });

    node.querySelectorAll("[data-widget-board-card]").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        const widgetId = String(card.getAttribute("data-widget-board-card") || "").trim();
        if (!widgetId) return;
        stateObj.dragWidgetId = widgetId;
        card.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", widgetId);
        }
      });

      card.addEventListener("dragend", () => {
        stateObj.dragWidgetId = "";
        card.classList.remove("is-dragging");
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });

      card.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!activeBoard) return;
        const targetId = String(card.getAttribute("data-widget-board-card") || "").trim();
        const dragId = String(stateObj.dragWidgetId || "").trim() || String(event.dataTransfer?.getData("text/plain") || "").trim();
        if (!targetId || !dragId || targetId === dragId) return;
        const nextBoards = stateObj.boards.map((row) => {
          if (String(row?.id || "") !== String(activeBoard.id || "")) return row;
          const source = Array.isArray(row.widgets) ? row.widgets.slice() : [];
          const from = source.findIndex((item) => String(item?.id || "") === dragId);
          const to = source.findIndex((item) => String(item?.id || "") === targetId);
          if (from < 0 || to < 0) return row;
          const moved = source.splice(from, 1)[0];
          const insertAt = from < to ? to - 1 : to;
          source.splice(insertAt, 0, moved);
          return {
            ...row,
            widgets: source
          };
        });
        widgetBoardPersistAndRender(node, widgetDef, stateObj, nextBoards);
      });
    });
  }

  function ensureWelcomeBoardComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "welcome_board") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "blueprint-welcome-board";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderWelcomeBoardComponent(node, widgetDef);
    return node;
  }

  function normalizeDomainForLookup(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    const stripped = raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .replace(/:\d+$/, "")
      .replace(/\.+$/, "");
    if (!stripped || stripped.length > 253) return "";
    const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
    return domainPattern.test(stripped) ? stripped : "";
  }

  function loadFasthostsDomain() {
    try {
      return normalizeDomainForLookup(localStorage.getItem(FASTHOSTS_WIDGET_STORAGE_KEY) || "");
    } catch {
      return "";
    }
  }

  function saveFasthostsDomain(domain) {
    try {
      if (!domain) {
        localStorage.removeItem(FASTHOSTS_WIDGET_STORAGE_KEY);
      } else {
        localStorage.setItem(FASTHOSTS_WIDGET_STORAGE_KEY, normalizeDomainForLookup(domain));
      }
    } catch {
      // ignore
    }
  }

  function normalizeFasthostsAlertType(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "renewal") return "renewal";
    if (v === "payment") return "payment";
    if (v === "domain") return "domain";
    return "invoice";
  }

  function normalizeFasthostsAlertStatus(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "paid") return "paid";
    if (v === "dismissed") return "dismissed";
    return "open";
  }

  function normalizeFasthostsAlertCurrency(value) {
    const v = String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return v || "GBP";
  }

  function parseFasthostsAlertAmount(value) {
    const text = String(value || "").trim().replace(/[^0-9.\-]/g, "");
    if (!text) return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  function normalizeFasthostsBillingAlert(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now();
    const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : createdAt;
    const title = String(raw.title || raw.label || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!title) return null;
    const dueMs = Date.parse(String(raw.dueAt || raw.dueDate || "").trim());
    return {
      id: String(raw.id || `fh_alert_${createdAt}_${index}`).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 96),
      type: normalizeFasthostsAlertType(raw.type || "invoice"),
      title,
      dueAt: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : "",
      amount: parseFasthostsAlertAmount(raw.amount),
      currency: normalizeFasthostsAlertCurrency(raw.currency || "GBP"),
      notes: String(raw.notes || "").replace(/\s+/g, " ").trim().slice(0, 240),
      status: normalizeFasthostsAlertStatus(raw.status || "open"),
      createdAt,
      updatedAt
    };
  }

  function loadFasthostsBillingAlerts() {
    try {
      const raw = String(localStorage.getItem(FASTHOSTS_WIDGET_ALERTS_KEY) || "").trim();
      if (!raw) return [];
      const parsed = safeParseJson(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      const out = [];
      for (let i = 0; i < list.length; i += 1) {
        const row = normalizeFasthostsBillingAlert(list[i], i);
        if (!row) continue;
        out.push(row);
        if (out.length >= 240) break;
      }
      out.sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        const ad = Date.parse(String(a.dueAt || "")) || Number.MAX_SAFE_INTEGER;
        const bd = Date.parse(String(b.dueAt || "")) || Number.MAX_SAFE_INTEGER;
        return ad - bd;
      });
      return out;
    } catch {
      return [];
    }
  }

  function saveFasthostsBillingAlerts(list, detail) {
    const source = Array.isArray(list) ? list : [];
    const out = [];
    for (let i = 0; i < source.length; i += 1) {
      const row = normalizeFasthostsBillingAlert(source[i], i);
      if (!row) continue;
      out.push(row);
      if (out.length >= 240) break;
    }
    try {
      localStorage.setItem(FASTHOSTS_WIDGET_ALERTS_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
    try {
      const hub = followupRuntimeHub();
      if (hub && typeof hub.notify === "function") {
        hub.notify("fasthostsAlerts", {
          action: String(detail?.action || "update"),
          count: out.length
        });
      }
    } catch {
      // ignore
    }
    return out;
  }

  function loadFasthostsSystemAlertAcks() {
    try {
      const parsed = safeParseJson(localStorage.getItem(FASTHOSTS_WIDGET_SYSTEM_ACK_KEY) || "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out = {};
      for (const [key, value] of Object.entries(parsed)) {
        const stamp = Number(value);
        if (!key || !Number.isFinite(stamp) || stamp <= 0) continue;
        out[String(key)] = stamp;
      }
      return out;
    } catch {
      return {};
    }
  }

  function saveFasthostsSystemAlertAcks(map) {
    const source = map && typeof map === "object" && !Array.isArray(map) ? map : {};
    const out = {};
    for (const [key, value] of Object.entries(source)) {
      const stamp = Number(value);
      if (!key || !Number.isFinite(stamp) || stamp <= 0) continue;
      out[String(key)] = stamp;
    }
    try {
      localStorage.setItem(FASTHOSTS_WIDGET_SYSTEM_ACK_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
    return out;
  }

  function loadFasthostsNotifyLedger() {
    try {
      const parsed = safeParseJson(localStorage.getItem(FASTHOSTS_WIDGET_NOTIFY_KEY) || "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out = {};
      for (const [key, value] of Object.entries(parsed)) {
        const stamp = Number(value);
        if (!key || !Number.isFinite(stamp) || stamp <= 0) continue;
        out[String(key)] = stamp;
      }
      return out;
    } catch {
      return {};
    }
  }

  function saveFasthostsNotifyLedger(map) {
    const source = map && typeof map === "object" && !Array.isArray(map) ? map : {};
    const out = {};
    for (const [key, value] of Object.entries(source)) {
      const stamp = Number(value);
      if (!key || !Number.isFinite(stamp) || stamp <= 0) continue;
      out[String(key)] = stamp;
    }
    try {
      localStorage.setItem(FASTHOSTS_WIDGET_NOTIFY_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
    return out;
  }

  function fasthostsAlertDaysRemaining(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.floor((ms - Date.now()) / 86400000);
  }

  function fasthostsAlertLevelFromDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n)) return "info";
    if (n <= 3) return "critical";
    if (n <= 14) return "warn";
    return "info";
  }

  function fasthostsAlertLevelRank(level) {
    const v = String(level || "").trim().toLowerCase();
    if (v === "critical") return 3;
    if (v === "warn") return 2;
    if (v === "info") return 1;
    return 0;
  }

  function fasthostsAlertLevelClass(level) {
    const v = String(level || "").trim().toLowerCase();
    if (v === "critical") return "is-critical";
    if (v === "warn") return "is-warn";
    if (v === "info") return "is-info";
    return "is-unknown";
  }

  function formatFasthostsAlertDue(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "No due date";
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return new Date(ms).toISOString();
    }
  }

  function formatFasthostsAlertAmount(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return "";
    const curr = normalizeFasthostsAlertCurrency(currency);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: curr, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${curr} ${n.toFixed(2)}`;
    }
  }

  function buildFasthostsSystemAlerts(report, domain, ackMap) {
    const out = [];
    const safeReport = report && typeof report === "object" ? report : {};
    const safeAcks = ackMap && typeof ackMap === "object" ? ackMap : {};
    const activeDomain = normalizeDomainForLookup(domain || safeReport?.domain || "");
    const expiryIso = String(safeReport?.expiry?.date || safeReport?.whois?.expiryDate || "").trim();
    const expiryDays = numberOrNull(safeReport?.expiry?.daysRemaining);
    if (expiryIso && expiryDays != null && expiryDays <= 45) {
      const id = `sys_domain_expiry_${activeDomain || "domain"}_${expiryIso.slice(0, 10)}`;
      if (!safeAcks[id]) {
        out.push({
          id,
          source: "system",
          type: "domain_expiry",
          level: fasthostsAlertLevelFromDays(expiryDays),
          title: `Domain renewal due: ${activeDomain || "domain"}`,
          dueAt: expiryIso,
          details: `Domain expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}.`,
          daysRemaining: expiryDays
        });
      }
    }

    const sslIso = String(safeReport?.ssl?.validTo || "").trim();
    const sslDays = numberOrNull(safeReport?.ssl?.daysRemaining);
    if (sslIso && sslDays != null && sslDays <= 45) {
      const id = `sys_ssl_expiry_${activeDomain || "domain"}_${sslIso.slice(0, 10)}`;
      if (!safeAcks[id]) {
        out.push({
          id,
          source: "system",
          type: "ssl_expiry",
          level: fasthostsAlertLevelFromDays(sslDays),
          title: `SSL certificate nearing expiry: ${activeDomain || "domain"}`,
          dueAt: sslIso,
          details: `SSL validity ends in ${sslDays} day${sslDays === 1 ? "" : "s"}.`,
          daysRemaining: sslDays
        });
      }
    }

    const overall = String(safeReport?.health?.overall || "").trim().toLowerCase();
    if (overall === "critical" || overall === "warn") {
      const generatedAt = String(safeReport?.generatedAt || "").trim();
      const dayKey = generatedAt ? generatedAt.slice(0, 10) : "latest";
      const id = `sys_health_${overall}_${activeDomain || "domain"}_${dayKey}`;
      if (!safeAcks[id]) {
        out.push({
          id,
          source: "system",
          type: "health",
          level: overall === "critical" ? "critical" : "warn",
          title: `Domain health ${overall}: ${activeDomain || "domain"}`,
          dueAt: generatedAt || "",
          details: "One or more FastHosts checks need attention.",
          daysRemaining: null
        });
      }
    }
    return out;
  }

  function buildFasthostsBillingAlerts(items) {
    const list = Array.isArray(items) ? items : [];
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const status = normalizeFasthostsAlertStatus(item.status);
      if (status !== "open") continue;
      const dueAt = String(item.dueAt || "").trim();
      const days = fasthostsAlertDaysRemaining(dueAt);
      if (days != null && days > 60) continue;
      const level = fasthostsAlertLevelFromDays(days);
      out.push({
        id: `billing_${String(item.id || "").trim()}`,
        source: "billing",
        type: normalizeFasthostsAlertType(item.type || "invoice"),
        level,
        title: String(item.title || "Billing alert").trim(),
        dueAt,
        amount: item.amount,
        currency: item.currency,
        details: String(item.notes || "").trim(),
        daysRemaining: days,
        billingId: String(item.id || "").trim(),
        status
      });
    }
    return out;
  }

  function summarizeFasthostsAlerts(alerts) {
    const source = Array.isArray(alerts) ? alerts : [];
    const out = { total: 0, critical: 0, warn: 0, info: 0 };
    for (const alert of source) {
      out.total += 1;
      const level = String(alert?.level || "").trim().toLowerCase();
      if (level === "critical") out.critical += 1;
      else if (level === "warn") out.warn += 1;
      else out.info += 1;
    }
    return out;
  }

  function shouldNotifyFasthostsAlert(alert) {
    if (!alert || typeof alert !== "object") return false;
    const level = String(alert.level || "").trim().toLowerCase();
    if (level !== "critical" && level !== "warn") return false;
    const days = Number(alert.daysRemaining);
    if (!Number.isFinite(days)) return true;
    if (level === "critical") return true;
    return days <= 14;
  }

  function dispatchFasthostsAlert(alert, domain) {
    try {
      window.dispatchEvent(new CustomEvent(FASTHOSTS_WIDGET_ALERT_EVENT, {
        detail: {
          domain: String(domain || "").trim(),
          alert: alert && typeof alert === "object" ? alert : {}
        }
      }));
    } catch {
      // ignore
    }
    try {
      const hub = followupRuntimeHub();
      if (hub && typeof hub.notify === "function") {
        hub.notify("fasthostsAlerts", {
          action: "notify",
          domain: String(domain || "").trim(),
          alertId: String(alert?.id || "").trim(),
          level: String(alert?.level || "").trim(),
          type: String(alert?.type || "").trim()
        });
      }
    } catch {
      // ignore
    }
  }

  function maybeNotifyFasthostsAlerts(stateObj, domain, alerts) {
    if (!stateObj || !alerts || !Array.isArray(alerts) || !alerts.length) return;
    const now = Date.now();
    const ledger = stateObj.notifyLedger && typeof stateObj.notifyLedger === "object"
      ? { ...stateObj.notifyLedger }
      : loadFasthostsNotifyLedger();
    let changed = false;
    for (const alert of alerts) {
      if (!shouldNotifyFasthostsAlert(alert)) continue;
      const notifyKey = `${String(alert.id || "").trim()}|${String(alert.dueAt || "").trim()}`;
      if (!notifyKey) continue;
      const prev = Number(ledger[notifyKey] || 0);
      if (Number.isFinite(prev) && prev > 0 && (now - prev) < FASTHOSTS_ALERT_NOTIFY_COOLDOWN_MS) continue;
      ledger[notifyKey] = now;
      changed = true;
      dispatchFasthostsAlert(alert, domain);
      try {
        if (typeof window.Notification === "function" && window.Notification.permission === "granted") {
          const title = String(alert.title || "FastHosts alert").trim();
          const dueLabel = alert?.dueAt ? `Due: ${formatFasthostsAlertDue(alert.dueAt)}` : "Action required";
          const bodyParts = [String(alert.level || "").toUpperCase(), dueLabel]
            .filter(Boolean)
            .join(" | ");
          // eslint-disable-next-line no-new
          new window.Notification(title, { body: bodyParts, tag: notifyKey });
        }
      } catch {
        // ignore
      }
    }
    if (changed) {
      stateObj.notifyLedger = saveFasthostsNotifyLedger(ledger);
    }
  }

  function requestFasthostsNotificationPermission() {
    try {
      if (typeof window.Notification !== "function") return Promise.resolve("unsupported");
      if (window.Notification.permission === "granted") return Promise.resolve("granted");
      if (typeof window.Notification.requestPermission === "function") {
        return window.Notification.requestPermission();
      }
      return Promise.resolve(window.Notification.permission || "default");
    } catch {
      return Promise.resolve("denied");
    }
  }

  function fasthostsNotificationLabel() {
    try {
      if (typeof window.Notification !== "function") return "Desktop notifications unsupported in this browser.";
      const stateValue = String(window.Notification.permission || "default").trim();
      if (stateValue === "granted") return "Desktop notifications are enabled.";
      if (stateValue === "denied") return "Desktop notifications are blocked.";
      return "Desktop notifications are not enabled yet.";
    } catch {
      return "Desktop notifications unavailable.";
    }
  }

  function installFasthostsAlertBridge() {
    if (window.__atlasFasthostsAlertBridgeInstalled) return;
    window.__atlasFasthostsAlertBridgeInstalled = true;
    window.agentcFasthostsAlerts = {
      list() {
        return loadFasthostsBillingAlerts();
      },
      add(alert) {
        const current = loadFasthostsBillingAlerts();
        const row = normalizeFasthostsBillingAlert(alert, current.length);
        if (!row) return current;
        return saveFasthostsBillingAlerts([row, ...current], { action: "bridge-add" });
      },
      markPaid(alertId) {
        const id = String(alertId || "").trim();
        if (!id) return loadFasthostsBillingAlerts();
        const next = loadFasthostsBillingAlerts().map((item) => (
          item.id === id
            ? { ...item, status: "paid", updatedAt: Date.now() }
            : item
        ));
        return saveFasthostsBillingAlerts(next, { action: "bridge-paid", alertId: id });
      },
      dismiss(alertId) {
        const id = String(alertId || "").trim();
        if (!id) return loadFasthostsBillingAlerts();
        const next = loadFasthostsBillingAlerts().map((item) => (
          item.id === id
            ? { ...item, status: "dismissed", updatedAt: Date.now() }
            : item
        ));
        return saveFasthostsBillingAlerts(next, { action: "bridge-dismiss", alertId: id });
      }
    };
  }

  function ensureFasthostsState(node) {
    if (!node || typeof node !== "object") return null;
    if (!node.__fasthostsState || typeof node.__fasthostsState !== "object") {
      node.__fasthostsState = {
        domain: loadFasthostsDomain(),
        busy: false,
        error: "",
        report: null,
        requestToken: 0,
        didAutoLookup: false,
        billingAlerts: loadFasthostsBillingAlerts(),
        systemAcks: loadFasthostsSystemAlertAcks(),
        notifyLedger: loadFasthostsNotifyLedger(),
        showResolved: false
      };
    }
    return node.__fasthostsState;
  }

  function fasthostsIndicatorClass(level) {
    const value = String(level || "").trim().toLowerCase();
    if (value === "good" || value === "healthy" || value === "ok") return "is-good";
    if (value === "warn" || value === "warning") return "is-warn";
    if (value === "critical" || value === "error" || value === "bad" || value === "down") return "is-critical";
    return "is-unknown";
  }

  function fasthostsIndicatorLabel(level) {
    const value = String(level || "").trim().toLowerCase();
    if (value === "good" || value === "healthy" || value === "ok") return "Healthy";
    if (value === "warn" || value === "warning") return "Warning";
    if (value === "critical" || value === "error" || value === "bad" || value === "down") return "Critical";
    return "Unknown";
  }

  function formatDomainDate(value) {
    const ms = Date.parse(String(value || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "Unknown";
    try {
      return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  function formatLookupStamp(value) {
    const ms = Date.parse(String(value || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return new Date(ms).toISOString();
    }
  }

  function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function runFasthostsLookup(node, widgetDef, rawDomain) {
    const stateObj = ensureFasthostsState(node);
    if (!stateObj) return;
    const domain = normalizeDomainForLookup(rawDomain || stateObj.domain || "");
    if (!domain) {
      stateObj.error = "Enter a valid domain (e.g. example.com).";
      stateObj.busy = false;
      stateObj.report = null;
      renderFasthostsComponent(node, widgetDef);
      return;
    }

    stateObj.domain = domain;
    saveFasthostsDomain(domain);
    stateObj.error = "";
    stateObj.busy = true;
    const token = stateObj.requestToken + 1;
    stateObj.requestToken = token;
    renderFasthostsComponent(node, widgetDef);

    try {
      const route = `/api/fasthosts/domain-report?domain=${encodeURIComponent(domain)}`;
      const res = await fetch(route, { method: "GET", cache: "no-store" });
      const payload = await res.json().catch(() => null);
      if (token !== stateObj.requestToken) return;
      if (!res.ok || !payload || payload.ok !== true || !payload.report || typeof payload.report !== "object") {
        const reason = String(payload?.error || `Lookup failed (${res.status || 500}).`);
        throw new Error(reason);
      }
      stateObj.report = payload.report;
      stateObj.error = "";
    } catch (err) {
      if (token !== stateObj.requestToken) return;
      stateObj.report = null;
      stateObj.error = String(err?.message || "Domain lookup failed.");
    } finally {
      if (token === stateObj.requestToken) {
        stateObj.busy = false;
      }
      renderFasthostsComponent(node, widgetDef);
    }
  }

  function renderFasthostsComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    installFasthostsAlertBridge();
    const stateObj = ensureFasthostsState(node);
    if (!stateObj) return;
    const report = stateObj.report && typeof stateObj.report === "object" ? stateObj.report : null;
    const health = report?.health && typeof report.health === "object" ? report.health : {};
    const indicators = health?.indicators && typeof health.indicators === "object" ? health.indicators : {};
    const whoisLevel = String(indicators?.whois || report?.whois?.status || "unknown").toLowerCase();
    const dnsLevel = String(indicators?.dns || report?.dns?.status || "unknown").toLowerCase();
    const sslLevel = String(indicators?.ssl || report?.ssl?.status || "unknown").toLowerCase();
    const expiryLevel = String(indicators?.expiry || report?.expiry?.status || "unknown").toLowerCase();
    const overallLevel = String(health?.overall || "unknown").toLowerCase();

    const registrar = String(report?.registrar?.name || report?.whois?.registrar || "Unknown");
    const expiryDate = formatDomainDate(report?.expiry?.date || report?.whois?.expiryDate || "");
    const expiryDays = numberOrNull(report?.expiry?.daysRemaining);
    const dnsTotal = numberOrNull(report?.dns?.totalRecords);
    const sslValidTo = formatDomainDate(report?.ssl?.validTo || "");
    const lookupStamp = formatLookupStamp(report?.generatedAt || "");
    const statusText = stateObj.busy
      ? "Retrieving WHOIS, DNS, SSL, expiry, and registrar details..."
      : (stateObj.error || (lookupStamp ? `Report updated ${lookupStamp}.` : "Enter a domain and run a health check."));

    const outputPayload = report || {
      domain: stateObj.domain || "",
      message: "No report yet. Run a lookup to generate domain status output."
    };
    const outputText = JSON.stringify(outputPayload, null, 2);
    const buttonLabel = stateObj.busy ? "Checking..." : "Run Check";
    const buttonDisabled = stateObj.busy ? "disabled" : "";
    const notificationState = fasthostsNotificationLabel();

    stateObj.billingAlerts = loadFasthostsBillingAlerts();
    stateObj.systemAcks = loadFasthostsSystemAlertAcks();
    const billingOpenAlerts = buildFasthostsBillingAlerts(stateObj.billingAlerts);
    const systemAlerts = buildFasthostsSystemAlerts(report, stateObj.domain, stateObj.systemAcks);
    const activeAlerts = [...systemAlerts, ...billingOpenAlerts].sort((a, b) => {
      const pr = fasthostsAlertLevelRank(b.level) - fasthostsAlertLevelRank(a.level);
      if (pr !== 0) return pr;
      const ad = Date.parse(String(a.dueAt || "")) || Number.MAX_SAFE_INTEGER;
      const bd = Date.parse(String(b.dueAt || "")) || Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
    const alertSummary = summarizeFasthostsAlerts(activeAlerts);
    maybeNotifyFasthostsAlerts(stateObj, stateObj.domain, activeAlerts);

    const resolvedBilling = stateObj.billingAlerts.filter((item) => normalizeFasthostsAlertStatus(item.status) !== "open");
    const renderAlertAmount = (alert) => formatFasthostsAlertAmount(alert?.amount, alert?.currency);
    const renderAlertDays = (alert) => {
      const days = Number(alert?.daysRemaining);
      if (!Number.isFinite(days)) return "";
      if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
      if (days === 0) return "Due today";
      return `${days} day${days === 1 ? "" : "s"} left`;
    };
    const activeAlertsHtml = activeAlerts.length
      ? activeAlerts.map((alert) => {
        const amountText = renderAlertAmount(alert);
        const daysText = renderAlertDays(alert);
        const detailParts = [
          daysText,
          alert?.dueAt ? `Due ${formatFasthostsAlertDue(alert.dueAt)}` : "",
          amountText
        ].filter(Boolean);
        const detailText = [String(alert?.details || "").trim(), detailParts.join(" | ")].filter(Boolean).join(" - ");
        const levelLabel = String(alert?.level || "info").toUpperCase();
        const typeLabel = String(alert?.type || "alert").replace(/_/g, " ");
        const actionButtons = String(alert?.source || "") === "billing"
          ? `
              <button type="button" data-fh-alert-action="paid" data-fh-alert-id="${escapeHtml(String(alert?.billingId || ""))}" data-fh-alert-source="billing">Paid</button>
              <button type="button" data-fh-alert-action="snooze" data-fh-alert-id="${escapeHtml(String(alert?.billingId || ""))}" data-fh-alert-source="billing">+1 day</button>
              <button type="button" data-fh-alert-action="dismiss" data-fh-alert-id="${escapeHtml(String(alert?.billingId || ""))}" data-fh-alert-source="billing">Dismiss</button>
            `
          : `
              <button type="button" data-fh-alert-action="ack" data-fh-alert-id="${escapeHtml(String(alert?.id || ""))}" data-fh-alert-source="system">Acknowledge</button>
            `;
        return `
          <li class="fasthosts-alert-item ${fasthostsAlertLevelClass(alert?.level)}">
            <div class="fasthosts-alert-head">
              <strong>${escapeHtml(String(alert?.title || "Alert"))}</strong>
              <span>${escapeHtml(levelLabel)} | ${escapeHtml(typeLabel)}</span>
            </div>
            <p>${escapeHtml(detailText || "Action required.")}</p>
            <div class="fasthosts-alert-actions">${actionButtons}</div>
          </li>
        `;
      }).join("")
      : `<li class="fasthosts-alert-empty">No active FastHosts alerts.</li>`;

    const resolvedAlertsHtml = stateObj.showResolved
      ? (resolvedBilling.length
        ? resolvedBilling.map((alert) => {
          const dueText = alert?.dueAt ? `Due ${formatFasthostsAlertDue(alert.dueAt)}` : "";
          const amountText = formatFasthostsAlertAmount(alert?.amount, alert?.currency);
          const details = [dueText, amountText, String(alert?.status || "").toUpperCase()].filter(Boolean).join(" | ");
          return `
            <li class="fasthosts-alert-item is-resolved">
              <div class="fasthosts-alert-head">
                <strong>${escapeHtml(String(alert?.title || "Resolved alert"))}</strong>
                <span>${escapeHtml(String(alert?.type || "alert"))}</span>
              </div>
              <p>${escapeHtml(details || "Resolved")}</p>
              <div class="fasthosts-alert-actions">
                <button type="button" data-fh-alert-action="reopen" data-fh-alert-id="${escapeHtml(String(alert?.id || ""))}" data-fh-alert-source="billing">Reopen</button>
                <button type="button" data-fh-alert-action="delete" data-fh-alert-id="${escapeHtml(String(alert?.id || ""))}" data-fh-alert-source="billing">Delete</button>
              </div>
            </li>
          `;
        }).join("")
        : `<li class="fasthosts-alert-empty">No resolved alerts.</li>`)
      : "";

    node.className = "blueprint-card fasthosts-widget";
    node.innerHTML = `
      <h3>${escapeHtml(String(widgetDef.name || "Fasthosts Manager"))}</h3>
      <div class="fasthosts-grid">
        <form class="fasthosts-form" data-fasthosts-form>
          <label>Domain name
            <div class="fasthosts-input-row">
              <input type="text" data-fasthosts-domain placeholder="example.com" autocomplete="off" value="${escapeHtml(stateObj.domain || "")}" />
              <button type="submit" ${buttonDisabled}>${escapeHtml(buttonLabel)}</button>
            </div>
          </label>
        </form>
        <div class="fasthosts-indicators">
          <span class="fasthosts-indicator ${fasthostsIndicatorClass(overallLevel)}">Overall: ${escapeHtml(fasthostsIndicatorLabel(overallLevel))}</span>
          <span class="fasthosts-indicator ${fasthostsIndicatorClass(whoisLevel)}">WHOIS: ${escapeHtml(fasthostsIndicatorLabel(whoisLevel))}</span>
          <span class="fasthosts-indicator ${fasthostsIndicatorClass(dnsLevel)}">DNS: ${escapeHtml(fasthostsIndicatorLabel(dnsLevel))}</span>
          <span class="fasthosts-indicator ${fasthostsIndicatorClass(sslLevel)}">SSL: ${escapeHtml(fasthostsIndicatorLabel(sslLevel))}</span>
          <span class="fasthosts-indicator ${fasthostsIndicatorClass(expiryLevel)}">Expiry: ${escapeHtml(fasthostsIndicatorLabel(expiryLevel))}</span>
        </div>
        <div class="fasthosts-meta">
          <div><span>Registrar</span><strong>${escapeHtml(registrar)}</strong></div>
          <div><span>Expiry</span><strong>${escapeHtml(expiryDate)}</strong></div>
          <div><span>Days Left</span><strong>${expiryDays == null ? "Unknown" : escapeHtml(String(expiryDays))}</strong></div>
          <div><span>DNS Records</span><strong>${dnsTotal == null ? "Unknown" : escapeHtml(String(dnsTotal))}</strong></div>
          <div><span>SSL Valid To</span><strong>${escapeHtml(sslValidTo)}</strong></div>
        </div>
        <section class="fasthosts-alerts">
          <div class="fasthosts-alerts-head">
            <strong>Alerts</strong>
            <span>${escapeHtml(String(alertSummary.total))} active | ${escapeHtml(String(alertSummary.critical))} critical | ${escapeHtml(String(alertSummary.warn))} warning</span>
          </div>
          <p class="fasthosts-alert-note">${escapeHtml(notificationState)}</p>
          <div class="fasthosts-alert-toolbar">
            <button type="button" data-fh-alert-notify>Enable desktop alerts</button>
            <button type="button" data-fh-alert-toggle-resolved>${stateObj.showResolved ? "Hide resolved" : "Show resolved"}</button>
          </div>
          <form class="fasthosts-alert-form" data-fh-alert-form>
            <select data-fh-add-type>
              <option value="invoice">Invoice</option>
              <option value="renewal">Renewal</option>
              <option value="payment">Payment</option>
            </select>
            <input type="text" data-fh-add-title maxlength="180" placeholder="Upcoming invoice" required />
            <input type="datetime-local" data-fh-add-due />
            <input type="text" data-fh-add-amount maxlength="20" placeholder="Amount (optional)" />
            <input type="text" data-fh-add-currency maxlength="3" placeholder="GBP" />
            <button type="submit">Add alert</button>
          </form>
          <ul class="fasthosts-alert-list">${activeAlertsHtml}</ul>
          ${stateObj.showResolved ? `<ul class="fasthosts-alert-list is-resolved">${resolvedAlertsHtml}</ul>` : ""}
        </section>
        <div class="fasthosts-status${stateObj.error ? " is-error" : ""}">${escapeHtml(statusText)}</div>
        <pre class="fasthosts-output">${escapeHtml(outputText)}</pre>
      </div>
    `;

    node.querySelector("form[data-fasthosts-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = node.querySelector("input[data-fasthosts-domain]");
      const domain = String(input?.value || "").trim();
      void runFasthostsLookup(node, widgetDef, domain);
    });

    node.querySelector("[data-fh-alert-notify]")?.addEventListener("click", async () => {
      await requestFasthostsNotificationPermission();
      renderFasthostsComponent(node, widgetDef);
    });

    node.querySelector("[data-fh-alert-toggle-resolved]")?.addEventListener("click", () => {
      stateObj.showResolved = !stateObj.showResolved;
      renderFasthostsComponent(node, widgetDef);
    });

    node.querySelector("form[data-fh-alert-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const titleInput = node.querySelector("[data-fh-add-title]");
      const dueInput = node.querySelector("[data-fh-add-due]");
      const typeInput = node.querySelector("[data-fh-add-type]");
      const amountInput = node.querySelector("[data-fh-add-amount]");
      const currencyInput = node.querySelector("[data-fh-add-currency]");
      const title = String(titleInput?.value || "").replace(/\s+/g, " ").trim().slice(0, 180);
      if (!title) return;
      const dueMs = Date.parse(String(dueInput?.value || "").trim());
      const next = [
        {
          id: `fh_alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: normalizeFasthostsAlertType(typeInput?.value || "invoice"),
          title,
          dueAt: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : "",
          amount: parseFasthostsAlertAmount(amountInput?.value || ""),
          currency: normalizeFasthostsAlertCurrency(currencyInput?.value || "GBP"),
          status: "open",
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        ...loadFasthostsBillingAlerts()
      ];
      stateObj.billingAlerts = saveFasthostsBillingAlerts(next, { action: "add" });
      renderFasthostsComponent(node, widgetDef);
    });

    node.querySelectorAll("button[data-fh-alert-action][data-fh-alert-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = String(btn.getAttribute("data-fh-alert-action") || "").trim().toLowerCase();
        const alertId = String(btn.getAttribute("data-fh-alert-id") || "").trim();
        const source = String(btn.getAttribute("data-fh-alert-source") || "").trim().toLowerCase();
        if (!action || !alertId) return;

        if (source === "system") {
          const nextAcks = { ...loadFasthostsSystemAlertAcks() };
          if (action === "ack") {
            nextAcks[alertId] = Date.now();
          } else if (action === "unack") {
            delete nextAcks[alertId];
          }
          stateObj.systemAcks = saveFasthostsSystemAlertAcks(nextAcks);
          renderFasthostsComponent(node, widgetDef);
          return;
        }

        const current = loadFasthostsBillingAlerts();
        const idx = current.findIndex((item) => String(item?.id || "") === alertId);
        if (idx < 0) return;
        const row = { ...current[idx] };
        if (action === "paid") {
          row.status = "paid";
          row.updatedAt = Date.now();
          current[idx] = row;
        } else if (action === "dismiss") {
          row.status = "dismissed";
          row.updatedAt = Date.now();
          current[idx] = row;
        } else if (action === "reopen") {
          row.status = "open";
          row.updatedAt = Date.now();
          current[idx] = row;
        } else if (action === "snooze") {
          const dueMs = Date.parse(String(row.dueAt || "")) || Date.now();
          row.status = "open";
          row.dueAt = new Date(dueMs + 86400000).toISOString();
          row.updatedAt = Date.now();
          current[idx] = row;
        } else if (action === "delete") {
          current.splice(idx, 1);
        }
        stateObj.billingAlerts = saveFasthostsBillingAlerts(current, { action, alertId });
        renderFasthostsComponent(node, widgetDef);
      });
    });

    if (!stateObj.didAutoLookup && stateObj.domain && !stateObj.report && !stateObj.busy) {
      stateObj.didAutoLookup = true;
      void runFasthostsLookup(node, widgetDef, stateObj.domain);
    }
  }

  function ensureFasthostsComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "fasthosts") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "fasthosts-manager";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderFasthostsComponent(node, widgetDef);
    return node;
  }

  function serverMonitorLevelClass(level) {
    const value = String(level || "").trim().toLowerCase();
    if (value === "healthy" || value === "good" || value === "ok") return "is-good";
    if (value === "warning" || value === "warn") return "is-warn";
    if (value === "critical" || value === "error" || value === "bad" || value === "down") return "is-critical";
    return "is-unknown";
  }

  function serverMonitorLevelLabel(level) {
    const value = String(level || "").trim().toLowerCase();
    if (value === "healthy" || value === "good" || value === "ok") return "Healthy";
    if (value === "warning" || value === "warn") return "Warning";
    if (value === "critical" || value === "error" || value === "bad" || value === "down") return "Critical";
    return "Unknown";
  }

  function serverMonitorPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${n.toFixed(1)}%`;
  }

  function serverMonitorGb(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${n.toFixed(1)} GB`;
  }

  function serverMonitorStamp(value) {
    const ms = Date.parse(String(value || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "--";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return new Date(ms).toISOString();
    }
  }

  function serverMonitorUptimeLabel(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return "--";
    const total = Math.floor(n);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function serverMonitorWorkspaceId(stateObj) {
    const direct = normalizeWorkspaceId(stateObj?.workspaceId || "");
    if (direct) return direct;
    const hinted = resolveWorkspaceIdHint();
    if (hinted) return hinted;
    return "ws_core";
  }

  function ensureServerMonitorState(node) {
    if (!node || typeof node !== "object") return null;
    if (!node.__serverMonitorState || typeof node.__serverMonitorState !== "object") {
      node.__serverMonitorState = {
        loadingState: false,
        loadingCheck: false,
        saving: false,
        error: "",
        statePayload: null,
        report: null,
        workspaceId: "",
        didInitialLoad: false,
        autoRefresh: false,
        autoRefreshTimer: null,
        showCredentials: false,
        showInstall: false,
        didSeedDraft: false,
        credentialDraft: {
          monitorAgentUrl: "",
          monitorAgentToken: "",
          primaryDomains: "",
        },
      };
    }
    return node.__serverMonitorState;
  }

  function clearServerMonitorAutoRefresh(stateObj) {
    if (!stateObj?.autoRefreshTimer) return;
    clearInterval(stateObj.autoRefreshTimer);
    stateObj.autoRefreshTimer = null;
  }

  function syncServerMonitorAutoRefresh(node, widgetDef, stateObj, gate) {
    const canAuto = String(gate?.state || "") === "ready";
    if (!stateObj?.autoRefresh || !canAuto) {
      clearServerMonitorAutoRefresh(stateObj);
      return;
    }
    if (stateObj.autoRefreshTimer) return;
    stateObj.autoRefreshTimer = window.setInterval(() => {
      if (!node?.isConnected) {
        clearServerMonitorAutoRefresh(stateObj);
        return;
      }
      void runServerMonitorCheck(node, widgetDef);
    }, SERVER_MONITOR_AUTO_REFRESH_MS);
  }

  async function runServerMonitorStateLookup(node, widgetDef) {
    const stateObj = ensureServerMonitorState(node);
    if (!stateObj || stateObj.loadingState) return;
    stateObj.loadingState = true;
    stateObj.error = "";
    renderServerMonitorComponent(node, widgetDef);

    const workspaceId = serverMonitorWorkspaceId(stateObj);
    const route = `/api/server-monitor/state?workspaceId=${encodeURIComponent(workspaceId)}`;
    const result = await fetchJsonNoThrow(route, { method: "GET" });
    if (result.response?.ok && result.payload?.ok === true) {
      stateObj.statePayload = result.payload;
      stateObj.workspaceId = normalizeWorkspaceId(result.payload?.workspaceId || workspaceId);
      stateObj.error = "";
      const cfg = result.payload?.config && typeof result.payload.config === "object" ? result.payload.config : {};
      if (!stateObj.didSeedDraft) {
        stateObj.credentialDraft.monitorAgentUrl = String(cfg.monitorAgentUrl || "");
        stateObj.credentialDraft.primaryDomains = Array.isArray(cfg.primaryDomains) ? cfg.primaryDomains.join(", ") : "";
        stateObj.didSeedDraft = true;
      }
    } else {
      const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
      if (payload.config || payload.gate) {
        stateObj.statePayload = payload;
        stateObj.workspaceId = normalizeWorkspaceId(payload.workspaceId || workspaceId);
      }
      stateObj.error = parseApiErrorLabel(result, "Could not load server monitor state");
    }

    stateObj.loadingState = false;
    renderServerMonitorComponent(node, widgetDef);
  }

  async function saveServerMonitorConfig(node, widgetDef, options) {
    const stateObj = ensureServerMonitorState(node);
    if (!stateObj || stateObj.saving) return;
    const opts = options && typeof options === "object" ? options : {};
    const workspaceId = serverMonitorWorkspaceId(stateObj);
    const body = {
      workspaceId,
    };

    const action = String(opts.action || "").trim().toLowerCase();
    if (action) body.action = action;

    if (!action || action === "save") {
      const patch = {};
      if (opts.saveCredentials) {
        patch.monitorAgentUrl = String(stateObj.credentialDraft.monitorAgentUrl || "").trim();
        patch.primaryDomains = String(stateObj.credentialDraft.primaryDomains || "").trim();
        if (String(stateObj.credentialDraft.monitorAgentToken || "").trim()) {
          body.monitorAgentToken = String(stateObj.credentialDraft.monitorAgentToken || "").trim();
        }
      }
      if (opts.notifications && typeof opts.notifications === "object") {
        patch.notifications = {
          diskFull: Boolean(opts.notifications.diskFull),
          serverDown: Boolean(opts.notifications.serverDown),
          securityWarning: Boolean(opts.notifications.securityWarning),
        };
      }
      body.config = patch;
    }

    stateObj.saving = true;
    stateObj.error = "";
    renderServerMonitorComponent(node, widgetDef);

    const result = await fetchJsonNoThrow("/api/server-monitor/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (result.response?.ok && result.payload?.ok === true) {
      stateObj.statePayload = result.payload;
      stateObj.workspaceId = normalizeWorkspaceId(result.payload?.workspaceId || workspaceId);
      if (opts.saveCredentials) {
        stateObj.credentialDraft.monitorAgentToken = "";
        stateObj.didSeedDraft = true;
      }
      if (String(stateObj.statePayload?.gate?.state || "") === "monitoring_not_configured") {
        stateObj.showInstall = true;
      }
      stateObj.error = "";
    } else {
      const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
      if (payload.config || payload.gate) {
        stateObj.statePayload = payload;
      }
      stateObj.error = parseApiErrorLabel(result, "Could not save server monitor settings");
    }

    stateObj.saving = false;
    renderServerMonitorComponent(node, widgetDef);
  }

  async function runServerMonitorCheck(node, widgetDef) {
    const stateObj = ensureServerMonitorState(node);
    if (!stateObj || stateObj.loadingCheck) return;
    stateObj.loadingCheck = true;
    stateObj.error = "";
    renderServerMonitorComponent(node, widgetDef);

    const workspaceId = serverMonitorWorkspaceId(stateObj);
    const result = await fetchJsonNoThrow("/api/server-monitor/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });

    if (result.response?.ok && result.payload?.ok === true) {
      if (result.payload?.gate && stateObj.statePayload && typeof stateObj.statePayload === "object") {
        stateObj.statePayload.gate = result.payload.gate;
      }
      stateObj.report = result.payload?.report && typeof result.payload.report === "object" ? result.payload.report : null;
      stateObj.error = "";
    } else {
      const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
      if (payload.gate && stateObj.statePayload && typeof stateObj.statePayload === "object") {
        stateObj.statePayload.gate = payload.gate;
      }
      stateObj.report = payload.report && typeof payload.report === "object" ? payload.report : null;
      stateObj.error = parseApiErrorLabel(result, "Server check failed");
    }

    stateObj.loadingCheck = false;
    renderServerMonitorComponent(node, widgetDef);
  }

  function serverMonitorDefaultNotifications(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      diskFull: typeof source.diskFull === "boolean" ? source.diskFull : true,
      serverDown: typeof source.serverDown === "boolean" ? source.serverDown : true,
      securityWarning: typeof source.securityWarning === "boolean" ? source.securityWarning : true,
    };
  }

  async function copyServerMonitorInstallCommand(text) {
    const value = String(text || "").trim();
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
    } catch {
      // ignore clipboard failures
    }
  }

  function renderServerMonitorComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    const stateObj = ensureServerMonitorState(node);
    if (!stateObj) return;

    const payload = stateObj.statePayload && typeof stateObj.statePayload === "object" ? stateObj.statePayload : {};
    const gate = payload.gate && typeof payload.gate === "object"
      ? payload.gate
      : { state: "loading", level: "unknown", message: "Loading monitor state...", canRunCheck: false };
    const config = payload.config && typeof payload.config === "object" ? payload.config : {};
    const install = payload.install && typeof payload.install === "object" ? payload.install : {};
    const report = stateObj.report && typeof stateObj.report === "object" ? stateObj.report : null;
    const notifications = serverMonitorDefaultNotifications(config.notifications);

    if (!stateObj.didSeedDraft && (config.monitorAgentUrl || config.primaryDomains)) {
      stateObj.credentialDraft.monitorAgentUrl = String(config.monitorAgentUrl || "");
      stateObj.credentialDraft.primaryDomains = Array.isArray(config.primaryDomains) ? config.primaryDomains.join(", ") : "";
      stateObj.didSeedDraft = true;
    }

    const overallLevel = String(report?.status || gate.level || "unknown").toLowerCase();
    const runDisabled = stateObj.loadingCheck || String(gate.state || "") !== "ready" ? "disabled" : "";
    const runLabel = stateObj.loadingCheck ? "Checking..." : "Run Check";
    const refreshLabel = stateObj.loadingState ? "Refreshing..." : "Refresh State";
    const workspaceLabel = String(payload.workspaceId || serverMonitorWorkspaceId(stateObj) || "ws_core");

    const cpuPercent = serverMonitorPct(report?.signals?.cpu?.percent);
    const cpuAvg = serverMonitorPct(report?.signals?.cpu?.avg5mPercent);
    const ramPercent = serverMonitorPct(report?.signals?.ram?.percent);
    const ramAvg = serverMonitorPct(report?.signals?.ram?.avg5mPercent);
    const diskUsed = serverMonitorPct(report?.signals?.disk?.usedPercent);
    const diskFree = serverMonitorGb(report?.signals?.disk?.freeGb);
    const uptimeLabel = serverMonitorUptimeLabel(report?.signals?.uptime?.seconds);
    const rebootLabel = serverMonitorStamp(report?.signals?.uptime?.lastRebootAt);
    const checkedAt = serverMonitorStamp(report?.checkedAt);

    const pendingUpdates = Number(report?.maintenance?.pendingOsUpdates);
    const pendingUpdatesLabel = Number.isFinite(pendingUpdates) ? String(pendingUpdates) : "--";
    const pleskUpdatesValue = report?.maintenance?.pleskUpdatesAvailable;
    const pleskUpdatesLabel = pleskUpdatesValue === true ? "Yes" : (pleskUpdatesValue === false ? "No" : "Unknown");
    const sslRows = Array.isArray(report?.maintenance?.ssl) ? report.maintenance.ssl : [];
    const sslHtml = sslRows.length
      ? sslRows.map((row) => {
        const domain = String(row?.domain || "").trim() || "domain";
        const status = String(row?.status || "unknown").trim().toLowerCase();
        const days = Number(row?.daysRemaining);
        const daysText = Number.isFinite(days) ? `${days}d` : "--";
        return `<li class=\"server-monitor-ssl-item\"><strong>${escapeHtml(domain)}</strong><span class=\"server-monitor-chip ${serverMonitorLevelClass(status === "valid" ? "healthy" : status === "expiring" ? "warning" : status === "expired" ? "critical" : "unknown")}\">${escapeHtml(status)}</span><em>${escapeHtml(daysText)}</em></li>`;
      }).join("")
      : `<li class=\"server-monitor-empty\">No primary domain SSL checks yet.</li>`;

    const alertRows = [
      ...(Array.isArray(report?.alerts) ? report.alerts : []),
      ...(Array.isArray(report?.securityFindings) ? report.securityFindings : []),
    ];
    const alertsHtml = alertRows.length
      ? alertRows.map((row) => (
        `<li class=\"server-monitor-alert ${serverMonitorLevelClass(row?.level)}\"><strong>${escapeHtml(String(row?.title || row?.id || "Alert"))}</strong><span>${escapeHtml(String(row?.detail || ""))}</span></li>`
      )).join("")
      : `<li class=\"server-monitor-empty\">No active alerts.</li>`;

    const suggestedActions = Array.isArray(report?.suggestedActions) ? report.suggestedActions : [];
    const actionsHtml = suggestedActions.length
      ? suggestedActions.map((text) => `<li>${escapeHtml(String(text || ""))}</li>`).join("")
      : `<li>No suggested actions.</li>`;

    const showCredentialForm = stateObj.showCredentials || String(gate.state || "") === "credentials_missing";
    const showInstallPanel = stateObj.showInstall || String(gate.state || "") === "monitoring_not_configured";
    const canAutoRefresh = String(gate.state || "") === "ready";
    if (!canAutoRefresh) stateObj.autoRefresh = false;

    node.className = "blueprint-card server-monitor-widget";
    node.innerHTML = `
      <h3>${escapeHtml(String(widgetDef.name || "Server Monitor (Plesk/WebPros)"))}</h3>
      <div class="server-monitor-grid">
        <div class="server-monitor-toolbar">
          <button type="button" data-server-monitor-refresh>${escapeHtml(refreshLabel)}</button>
          <button type="button" data-server-monitor-check ${runDisabled}>${escapeHtml(runLabel)}</button>
          <label class="server-monitor-auto">
            <input type="checkbox" data-server-monitor-auto ${stateObj.autoRefresh ? "checked" : ""} ${canAutoRefresh ? "" : "disabled"} />
            auto-refresh 60s
          </label>
          <span class="server-monitor-workspace">Workspace: ${escapeHtml(workspaceLabel)}</span>
        </div>

        <section class="server-monitor-gate ${serverMonitorLevelClass(gate.level)}">
          <p>${escapeHtml(String(gate.message || "Monitor state unavailable."))}</p>
          <div class="server-monitor-gate-actions">
            ${String(gate.state || "") === "vault_locked" ? `<button type="button" data-server-monitor-action="unlock">Unlock Vault</button>` : ""}
            ${String(gate.state || "") === "credentials_missing" ? `<button type="button" data-server-monitor-action="toggle-credentials">${showCredentialForm ? "Hide" : "Add credential"}</button>` : ""}
            ${String(gate.state || "") === "monitoring_not_configured" ? `<button type="button" data-server-monitor-action="toggle-install">${showInstallPanel ? "Hide install" : "Install Monitor Agent"}</button>` : ""}
          </div>
        </section>

        ${showCredentialForm ? `
          <form class="server-monitor-credentials" data-server-monitor-credentials>
            <label>Monitor agent URL
              <input type="text" data-server-monitor-url value="${escapeHtml(String(stateObj.credentialDraft.monitorAgentUrl || ""))}" placeholder="http://185.230.219.166:9870/health" />
            </label>
            <label>Monitor token
              <input type="password" data-server-monitor-token value="${escapeHtml(String(stateObj.credentialDraft.monitorAgentToken || ""))}" placeholder="Set/update token" />
            </label>
            <label>Primary domains
              <input type="text" data-server-monitor-domains value="${escapeHtml(String(stateObj.credentialDraft.primaryDomains || ""))}" placeholder="example.com, example.co.uk" />
            </label>
            <button type="submit" ${stateObj.saving ? "disabled" : ""}>${stateObj.saving ? "Saving..." : "Save credentials"}</button>
          </form>
        ` : ""}

        ${showInstallPanel ? `
          <section class="server-monitor-install">
            <p>Run installer on your machine to provision the VPS monitor agent.</p>
            <pre>${escapeHtml(String(install.oneLiner || ""))}</pre>
            <div class="server-monitor-install-actions">
              <button type="button" data-server-monitor-action="copy-install">Copy install command</button>
              ${config.panelUrl ? `<a href="${escapeHtml(String(config.panelUrl || ""))}" target="_blank" rel="noreferrer">Open Plesk panel</a>` : ""}
            </div>
          </section>
        ` : ""}

        <div class="server-monitor-chips">
          <span class="server-monitor-chip ${serverMonitorLevelClass(overallLevel)}">Overall: ${escapeHtml(serverMonitorLevelLabel(overallLevel))}</span>
          <span class="server-monitor-chip ${serverMonitorLevelClass(report?.ok === false ? "critical" : "healthy")}">Monitor: ${escapeHtml(report?.ok === false ? "Unavailable" : "Connected")}</span>
          <span class="server-monitor-chip ${serverMonitorLevelClass(gate.level)}">Gate: ${escapeHtml(String(gate.state || "unknown"))}</span>
          <span class="server-monitor-chip is-unknown">Last check: ${escapeHtml(checkedAt)}</span>
        </div>

        <div class="server-monitor-signals">
          <article><span>CPU</span><strong>${escapeHtml(cpuPercent)}</strong><em>avg5m ${escapeHtml(cpuAvg)}</em></article>
          <article><span>RAM</span><strong>${escapeHtml(ramPercent)}</strong><em>avg5m ${escapeHtml(ramAvg)}</em></article>
          <article><span>Disk</span><strong>${escapeHtml(diskUsed)}</strong><em>free ${escapeHtml(diskFree)}</em></article>
          <article><span>Uptime</span><strong>${escapeHtml(uptimeLabel)}</strong><em>reboot ${escapeHtml(rebootLabel)}</em></article>
        </div>

        <section class="server-monitor-maintenance">
          <div><span>Pending OS updates</span><strong>${escapeHtml(pendingUpdatesLabel)}</strong></div>
          <div><span>Plesk updates available</span><strong>${escapeHtml(pleskUpdatesLabel)}</strong></div>
          <div class="server-monitor-ssl">
            <span>SSL status</span>
            <ul>${sslHtml}</ul>
          </div>
        </section>

        <section class="server-monitor-notifications">
          <strong>Notification settings (admin)</strong>
          <div class="server-monitor-notification-toggles">
            <label><input type="checkbox" data-server-monitor-notify-disk ${notifications.diskFull ? "checked" : ""} /> Email: disk full</label>
            <label><input type="checkbox" data-server-monitor-notify-down ${notifications.serverDown ? "checked" : ""} /> Email: server down</label>
            <label><input type="checkbox" data-server-monitor-notify-security ${notifications.securityWarning ? "checked" : ""} /> Email: security warning</label>
          </div>
          <button type="button" data-server-monitor-save-notifications ${stateObj.saving ? "disabled" : ""}>${stateObj.saving ? "Saving..." : "Save notification settings"}</button>
        </section>

        <section class="server-monitor-alerts">
          <strong>Alerts</strong>
          <ul>${alertsHtml}</ul>
        </section>

        <section class="server-monitor-actions">
          <strong>Suggested actions</strong>
          <ul>${actionsHtml}</ul>
        </section>

        <div class="server-monitor-status${stateObj.error ? " is-error" : ""}">
          ${escapeHtml(stateObj.error || (report ? `Report updated ${checkedAt}.` : "Run Check to fetch live server metrics."))}
        </div>
      </div>
    `;

    node.querySelector("[data-server-monitor-refresh]")?.addEventListener("click", () => {
      void runServerMonitorStateLookup(node, widgetDef);
    });

    node.querySelector("[data-server-monitor-check]")?.addEventListener("click", () => {
      void runServerMonitorCheck(node, widgetDef);
    });

    node.querySelector("[data-server-monitor-auto]")?.addEventListener("change", (event) => {
      stateObj.autoRefresh = Boolean(event?.target?.checked);
      syncServerMonitorAutoRefresh(node, widgetDef, stateObj, gate);
      renderServerMonitorComponent(node, widgetDef);
    });

    node.querySelector("[data-server-monitor-action='unlock']")?.addEventListener("click", () => {
      void saveServerMonitorConfig(node, widgetDef, { action: "unlock_vault" });
    });

    node.querySelector("[data-server-monitor-action='toggle-credentials']")?.addEventListener("click", () => {
      stateObj.showCredentials = !stateObj.showCredentials;
      renderServerMonitorComponent(node, widgetDef);
    });

    node.querySelector("[data-server-monitor-action='toggle-install']")?.addEventListener("click", () => {
      stateObj.showInstall = !stateObj.showInstall;
      renderServerMonitorComponent(node, widgetDef);
    });

    node.querySelector("[data-server-monitor-action='copy-install']")?.addEventListener("click", async () => {
      await copyServerMonitorInstallCommand(install.oneLiner || "");
    });

    node.querySelector("form[data-server-monitor-credentials]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      stateObj.credentialDraft.monitorAgentUrl = String(node.querySelector("[data-server-monitor-url]")?.value || "").trim();
      stateObj.credentialDraft.monitorAgentToken = String(node.querySelector("[data-server-monitor-token]")?.value || "");
      stateObj.credentialDraft.primaryDomains = String(node.querySelector("[data-server-monitor-domains]")?.value || "").trim();
      void saveServerMonitorConfig(node, widgetDef, { saveCredentials: true });
    });

    node.querySelector("[data-server-monitor-save-notifications]")?.addEventListener("click", () => {
      const nextNotifications = {
        diskFull: Boolean(node.querySelector("[data-server-monitor-notify-disk]")?.checked),
        serverDown: Boolean(node.querySelector("[data-server-monitor-notify-down]")?.checked),
        securityWarning: Boolean(node.querySelector("[data-server-monitor-notify-security]")?.checked),
      };
      void saveServerMonitorConfig(node, widgetDef, { notifications: nextNotifications });
    });

    syncServerMonitorAutoRefresh(node, widgetDef, stateObj, gate);

    if (!stateObj.didInitialLoad && node.isConnected) {
      stateObj.didInitialLoad = true;
      void runServerMonitorStateLookup(node, widgetDef);
    }
  }

  function ensureServerMonitorComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "server_monitor_plesk") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "server-monitor-plesk";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderServerMonitorComponent(node, widgetDef);
    return node;
  }

  function normalizeBudgetProvider(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "paypal" ? "paypal" : "stripe";
  }

  function normalizeBudgetCurrency(value) {
    const v = String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return v || "USD";
  }

  function clampMoney(value, min = 0, max = 1000000000) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
  }

  function formatMoney(value, currency) {
    const amount = clampMoney(value, 0, 1000000000);
    const curr = normalizeBudgetCurrency(currency);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: curr, maximumFractionDigits: 2 }).format(amount);
    } catch {
      return `${curr} ${amount.toFixed(2)}`;
    }
  }

  function defaultBudgetState() {
    return {
      provider: "stripe",
      currency: "USD",
      budget: 0,
      reserved: 0,
      spent: 0,
      ledger: [],
      updatedAt: Date.now()
    };
  }

  function normalizeBudgetLedgerEntry(raw, index) {
    const source = raw && typeof raw === "object" ? raw : {};
    const amount = clampMoney(source.amount, 0, 1000000000);
    if (amount <= 0) return null;
    return {
      id: String(source.id || `entry_${Date.now()}_${index}`).slice(0, 80),
      type: ["budget", "reserve", "release", "spend", "reset"].includes(String(source.type || "")) ? String(source.type) : "spend",
      amount,
      label: String(source.label || "").trim().slice(0, 140),
      provider: normalizeBudgetProvider(source.provider || "stripe"),
      mode: ["live", "simulated", "manual"].includes(String(source.mode || "")) ? String(source.mode) : "manual",
      createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now()
    };
  }

  function normalizeBudgetState(raw) {
    const base = defaultBudgetState();
    const source = raw && typeof raw === "object" ? raw : {};
    const ledgerRaw = Array.isArray(source.ledger) ? source.ledger : [];
    const ledger = [];
    for (let i = 0; i < ledgerRaw.length; i += 1) {
      const row = normalizeBudgetLedgerEntry(ledgerRaw[i], i);
      if (row) ledger.push(row);
      if (ledger.length >= 120) break;
    }
    ledger.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return {
      provider: normalizeBudgetProvider(source.provider || base.provider),
      currency: normalizeBudgetCurrency(source.currency || base.currency),
      budget: clampMoney(source.budget, 0, 1000000000),
      reserved: clampMoney(source.reserved, 0, 1000000000),
      spent: clampMoney(source.spent, 0, 1000000000),
      ledger,
      updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now()
    };
  }

  function loadBudgetState() {
    try {
      const raw = String(localStorage.getItem(AGENT_BUDGET_WIDGET_KEY) || "").trim();
      if (!raw) return defaultBudgetState();
      return normalizeBudgetState(safeParseJson(raw));
    } catch {
      return defaultBudgetState();
    }
  }

  function emitBudgetUpdate(detail) {
    try {
      window.dispatchEvent(new CustomEvent(AGENT_BUDGET_WIDGET_EVENT, { detail: detail || {} }));
    } catch {
      // ignore
    }
  }

  function saveBudgetState(next, detail) {
    const normalized = normalizeBudgetState(next);
    normalized.updatedAt = Date.now();
    try {
      localStorage.setItem(AGENT_BUDGET_WIDGET_KEY, JSON.stringify(normalized));
    } catch {
      // ignore
    }
    emitBudgetUpdate({ ...(detail || {}), updatedAt: normalized.updatedAt });
    return normalized;
  }

  function budgetRemaining(snapshot) {
    const stateObj = normalizeBudgetState(snapshot);
    return clampMoney(stateObj.budget - stateObj.spent - stateObj.reserved, -1000000000, 1000000000);
  }

  function appendBudgetLedger(snapshot, entry) {
    const next = normalizeBudgetState(snapshot);
    const row = normalizeBudgetLedgerEntry({ ...entry, id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }, next.ledger.length);
    if (!row) return next;
    next.ledger = [row, ...next.ledger].slice(0, 120);
    return next;
  }

  async function runBudgetProviderCharge(provider, payload) {
    const p = normalizeBudgetProvider(provider);
    const route = p === "paypal" ? "/api/payments/paypal/charge" : "/api/payments/stripe/charge";
    try {
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload || {})
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) {
        return { ok: false, mode: "simulated", error: String(data?.error || `Provider unavailable (${res.status}).`) };
      }
      return { ok: true, mode: "live", data };
    } catch (err) {
      return { ok: false, mode: "simulated", error: String(err?.message || "Provider request failed.") };
    }
  }

  function installBudgetAgentBridge() {
    if (window.__atlasBudgetBridgeInstalled) return;
    window.__atlasBudgetBridgeInstalled = true;
    window.agentcBudgetWallet = {
      snapshot() {
        return normalizeBudgetState(loadBudgetState());
      },
      setBudget(amount, currency, provider) {
        const next = normalizeBudgetState(loadBudgetState());
        next.budget = clampMoney(amount, 0, 1000000000);
        next.currency = normalizeBudgetCurrency(currency || next.currency);
        next.provider = normalizeBudgetProvider(provider || next.provider);
        const saved = appendBudgetLedger(next, {
          type: "budget",
          amount: next.budget,
          label: "Budget updated",
          provider: next.provider,
          mode: "manual",
          createdAt: Date.now()
        });
        return saveBudgetState(saved, { action: "set-budget" });
      }
    };
  }

  function renderAgentBudgetComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    installBudgetAgentBridge();
    const snapshot = loadBudgetState();
    const remaining = budgetRemaining(snapshot);
    const healthClass = remaining < 0 ? "is-critical" : (remaining < snapshot.budget * 0.2 ? "is-warn" : "is-good");
    const updatedLabel = formatLookupStamp(snapshot.updatedAt);

    const ledgerRows = snapshot.ledger.slice(0, 8);
    const ledgerHtml = ledgerRows.length
      ? ledgerRows.map((item) => (
        `<li>
          <strong>${escapeHtml(String(item.type || "entry").toUpperCase())}</strong>
          <span>${escapeHtml(formatMoney(item.amount, snapshot.currency))}</span>
          <span>${escapeHtml(item.label || "No note")}</span>
          <em>${escapeHtml(String(item.mode || "manual"))}</em>
        </li>`
      )).join("")
      : `<li class="agent-budget-empty">No wallet actions yet.</li>`;

    node.className = "blueprint-card agent-budget-widget";
    node.innerHTML = `
      <h3>${escapeHtml(String(widgetDef.name || "Budget Wallet (Stripe/PayPal)"))}</h3>
      <p class="agent-budget-meta">Guardrail wallet for agent spending. Provider execution falls back to simulation when payment APIs are unavailable.</p>
      <div class="agent-budget-summary">
        <div><span>Budget</span><strong>${escapeHtml(formatMoney(snapshot.budget, snapshot.currency))}</strong></div>
        <div><span>Reserved</span><strong>${escapeHtml(formatMoney(snapshot.reserved, snapshot.currency))}</strong></div>
        <div><span>Spent</span><strong>${escapeHtml(formatMoney(snapshot.spent, snapshot.currency))}</strong></div>
        <div class="${healthClass}"><span>Remaining</span><strong>${escapeHtml(formatMoney(remaining, snapshot.currency))}</strong></div>
      </div>
      <div class="agent-budget-grid">
        <label>Provider
          <select data-agent-budget-provider>
            <option value="stripe"${snapshot.provider === "stripe" ? " selected" : ""}>Stripe</option>
            <option value="paypal"${snapshot.provider === "paypal" ? " selected" : ""}>PayPal</option>
          </select>
        </label>
        <label>Currency
          <input type="text" data-agent-budget-currency value="${escapeHtml(snapshot.currency)}" maxlength="3" autocomplete="off" />
        </label>
        <label>Budget
          <input type="number" min="0" step="0.01" data-agent-budget-limit value="${escapeHtml(String(snapshot.budget))}" />
        </label>
        <button type="button" data-agent-budget-set>Set Budget</button>
      </div>
      <div class="agent-budget-actions">
        <input type="number" min="0" step="0.01" data-agent-budget-amount placeholder="Amount" />
        <input type="text" maxlength="140" data-agent-budget-label placeholder="Reason / memo" />
        <button type="button" data-agent-budget-reserve>Reserve</button>
        <button type="button" data-agent-budget-spend>Spend</button>
        <button type="button" data-agent-budget-release>Release</button>
        <button type="button" data-agent-budget-reset>Reset Ledger</button>
      </div>
      <div class="agent-budget-status" data-agent-budget-status>Provider: ${escapeHtml(snapshot.provider)} | updated ${escapeHtml(updatedLabel || "now")}</div>
      <ol class="agent-budget-ledger">${ledgerHtml}</ol>
    `;

    const statusNode = node.querySelector("[data-agent-budget-status]");
    const providerSelect = node.querySelector("[data-agent-budget-provider]");
    const currencyInput = node.querySelector("[data-agent-budget-currency]");
    const budgetInput = node.querySelector("[data-agent-budget-limit]");
    const amountInput = node.querySelector("[data-agent-budget-amount]");
    const labelInput = node.querySelector("[data-agent-budget-label]");

    const readProvider = () => normalizeBudgetProvider(providerSelect?.value || snapshot.provider);
    const readCurrency = () => normalizeBudgetCurrency(currencyInput?.value || snapshot.currency);
    const readAmount = () => clampMoney(amountInput?.value || 0, 0, 1000000000);
    const readLabel = () => String(labelInput?.value || "").trim().slice(0, 140);

    const setStatus = (text, isError) => {
      if (!statusNode) return;
      statusNode.textContent = String(text || "");
      statusNode.classList.toggle("is-error", Boolean(isError));
    };

    node.querySelector("[data-agent-budget-set]")?.addEventListener("click", () => {
      const next = normalizeBudgetState(loadBudgetState());
      next.provider = readProvider();
      next.currency = readCurrency();
      next.budget = clampMoney(budgetInput?.value || 0, 0, 1000000000);
      const saved = appendBudgetLedger(next, {
        type: "budget",
        amount: next.budget,
        label: "Budget updated",
        provider: next.provider,
        mode: "manual",
        createdAt: Date.now()
      });
      saveBudgetState(saved, { action: "set-budget" });
      renderAgentBudgetComponent(node, widgetDef);
    });

    node.querySelector("[data-agent-budget-reserve]")?.addEventListener("click", () => {
      const amount = readAmount();
      if (amount <= 0) {
        setStatus("Enter a valid positive amount.", true);
        return;
      }
      const next = normalizeBudgetState(loadBudgetState());
      const remainingNow = budgetRemaining(next);
      if (amount > remainingNow) {
        setStatus(`Reserve exceeds remaining budget (${formatMoney(remainingNow, next.currency)}).`, true);
        return;
      }
      next.provider = readProvider();
      next.currency = readCurrency();
      next.reserved = clampMoney(next.reserved + amount, 0, 1000000000);
      const saved = appendBudgetLedger(next, {
        type: "reserve",
        amount,
        label: readLabel() || "Reserved for agent action",
        provider: next.provider,
        mode: "manual",
        createdAt: Date.now()
      });
      saveBudgetState(saved, { action: "reserve" });
      renderAgentBudgetComponent(node, widgetDef);
    });

    node.querySelector("[data-agent-budget-release]")?.addEventListener("click", () => {
      const amount = readAmount();
      if (amount <= 0) {
        setStatus("Enter a valid positive amount.", true);
        return;
      }
      const next = normalizeBudgetState(loadBudgetState());
      const released = clampMoney(Math.min(next.reserved, amount), 0, 1000000000);
      if (released <= 0) {
        setStatus("No reserved funds available to release.", true);
        return;
      }
      next.provider = readProvider();
      next.currency = readCurrency();
      next.reserved = clampMoney(next.reserved - released, 0, 1000000000);
      const saved = appendBudgetLedger(next, {
        type: "release",
        amount: released,
        label: readLabel() || "Released unused reserve",
        provider: next.provider,
        mode: "manual",
        createdAt: Date.now()
      });
      saveBudgetState(saved, { action: "release" });
      renderAgentBudgetComponent(node, widgetDef);
    });

    node.querySelector("[data-agent-budget-spend]")?.addEventListener("click", async () => {
      const amount = readAmount();
      if (amount <= 0) {
        setStatus("Enter a valid positive amount.", true);
        return;
      }
      const next = normalizeBudgetState(loadBudgetState());
      next.provider = readProvider();
      next.currency = readCurrency();

      const availableWithReserve = clampMoney(next.budget - next.spent, -1000000000, 1000000000);
      if (amount > availableWithReserve) {
        setStatus(`Spend exceeds available budget (${formatMoney(Math.max(0, availableWithReserve), next.currency)}).`, true);
        return;
      }

      const reservedUse = clampMoney(Math.min(next.reserved, amount), 0, 1000000000);
      next.reserved = clampMoney(next.reserved - reservedUse, 0, 1000000000);
      next.spent = clampMoney(next.spent + amount, 0, 1000000000);
      setStatus(`Charging via ${next.provider}...`, false);
      const chargeResult = await runBudgetProviderCharge(next.provider, {
        amount,
        currency: next.currency,
        label: readLabel() || "Agent spend"
      });
      const saved = appendBudgetLedger(next, {
        type: "spend",
        amount,
        label: readLabel() || "Agent spend",
        provider: next.provider,
        mode: chargeResult.ok ? "live" : "simulated",
        createdAt: Date.now()
      });
      saveBudgetState(saved, { action: "spend", mode: chargeResult.ok ? "live" : "simulated" });
      renderAgentBudgetComponent(node, widgetDef);
    });

    node.querySelector("[data-agent-budget-reset]")?.addEventListener("click", () => {
      if (!window.confirm("Reset spend/reserve and clear wallet ledger?")) return;
      const next = normalizeBudgetState(loadBudgetState());
      next.spent = 0;
      next.reserved = 0;
      next.ledger = [];
      saveBudgetState(next, { action: "reset" });
      renderAgentBudgetComponent(node, widgetDef);
    });
  }

  function ensureAgentBudgetComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "agent_budget") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "agent-budget-wallet";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderAgentBudgetComponent(node, widgetDef);
    return node;
  }

  function normalizeFollowupStatus(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "done" ? "done" : "todo";
  }

  function normalizeFollowupPriority(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "high") return "high";
    if (v === "low") return "low";
    return "normal";
  }

  function normalizeFollowupTask(raw, index) {
    const source = raw && typeof raw === "object" ? raw : {};
    const title = String(source.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!title) return null;
    const dueAtRaw = String(source.dueAt || "").trim();
    const dueMs = Date.parse(dueAtRaw);
    const createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now();
    const updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : createdAt;
    return {
      id: String(source.id || `task_${createdAt}_${index}`).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 90),
      title,
      dueAt: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : "",
      status: normalizeFollowupStatus(source.status),
      priority: normalizeFollowupPriority(source.priority),
      notes: String(source.notes || "").replace(/\s+/g, " ").trim().slice(0, 260),
      source: String(source.source || "manual").trim().slice(0, 80) || "manual",
      createdAt,
      updatedAt
    };
  }

  function followupRuntimeHub() {
    try {
      if (typeof window.__atlasEnsureRuntimeMemoryHub === "function") {
        const ensured = window.__atlasEnsureRuntimeMemoryHub();
        if (ensured && typeof ensured === "object") return ensured;
      }
    } catch {
      // ignore
    }
    const hub = window.__atlasRuntimeMemoryHub;
    return hub && typeof hub === "object" ? hub : null;
  }

  function migrateLegacyFollowupsToRuntimeHubOnce() {
    const hub = followupRuntimeHub();
    if (!hub) return;
    if (window.__atlasFollowupLegacyMigrated) return;
    window.__atlasFollowupLegacyMigrated = true;

    let alreadyMigrated = false;
    try {
      alreadyMigrated = String(localStorage.getItem(FOLLOWUP_CALENDAR_MIGRATION_KEY) || "") === "1";
    } catch {
      alreadyMigrated = false;
    }
    if (alreadyMigrated) return;

    const hubList = Array.isArray(hub?.followups?.tasks) ? hub.followups.tasks : [];
    if (hubList.length > 0) {
      try {
        localStorage.setItem(FOLLOWUP_CALENDAR_MIGRATION_KEY, "1");
      } catch {
        // ignore
      }
      return;
    }

    let legacyList = [];
    try {
      const raw = String(localStorage.getItem(FOLLOWUP_CALENDAR_WIDGET_KEY) || "").trim();
      const parsed = safeParseJson(raw);
      legacyList = Array.isArray(parsed) ? parsed : [];
    } catch {
      legacyList = [];
    }
    if (legacyList.length) {
      if (!hub.followups || typeof hub.followups !== "object") hub.followups = { tasks: [] };
      hub.followups.tasks = legacyList;
    }
    try {
      localStorage.setItem(FOLLOWUP_CALENDAR_MIGRATION_KEY, "1");
    } catch {
      // ignore
    }
  }

  function loadFollowupTasks() {
    migrateLegacyFollowupsToRuntimeHubOnce();
    try {
      const hub = followupRuntimeHub();
      const list = hub && Array.isArray(hub?.followups?.tasks)
        ? hub.followups.tasks
        : FOLLOWUP_FALLBACK_STATE.tasks;
      const out = [];
      for (let i = 0; i < list.length; i += 1) {
        const row = normalizeFollowupTask(list[i], i);
        if (!row) continue;
        out.push(row);
        if (out.length >= 300) break;
      }
      out.sort((a, b) => {
        if (a.status !== b.status) return a.status === "done" ? 1 : -1;
        const ad = Date.parse(String(a.dueAt || "")) || Number.MAX_SAFE_INTEGER;
        const bd = Date.parse(String(b.dueAt || "")) || Number.MAX_SAFE_INTEGER;
        return ad - bd;
      });
      return out;
    } catch {
      return [];
    }
  }

  function emitFollowupUpdate(detail) {
    try {
      window.dispatchEvent(new CustomEvent(FOLLOWUP_CALENDAR_WIDGET_EVENT, { detail: detail || {} }));
    } catch {
      // ignore
    }
  }

  function saveFollowupTasks(list, detail) {
    const source = Array.isArray(list) ? list : [];
    const out = [];
    for (let i = 0; i < source.length; i += 1) {
      const row = normalizeFollowupTask(source[i], i);
      if (!row) continue;
      out.push(row);
      if (out.length >= 300) break;
    }
    const hub = followupRuntimeHub();
    if (hub) {
      if (!hub.followups || typeof hub.followups !== "object") hub.followups = { tasks: [] };
      hub.followups.tasks = out.slice();
      if (typeof hub.notify === "function") {
        try {
          hub.notify("followups", { action: String(detail?.action || "update"), count: out.length });
        } catch {
          // ignore
        }
      }
    } else {
      FOLLOWUP_FALLBACK_STATE.tasks = out.slice();
    }
    emitFollowupUpdate({ ...(detail || {}), count: out.length });
    return out;
  }

  function formatFollowupDue(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "No due date";
    try {
      return new Date(ms).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function dueInputValue(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function followupBucket(task, nowMs) {
    if (!task || task.status === "done") return "done";
    const due = Date.parse(String(task.dueAt || ""));
    if (!Number.isFinite(due) || due <= 0) return "upcoming";
    const now = Number(nowMs || Date.now());
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    if (due < startOfDay.getTime()) return "overdue";
    if (due <= endOfDay.getTime()) return "today";
    return "upcoming";
  }

  function followupMonthKey(inputDate) {
    const date = inputDate instanceof Date ? new Date(inputDate.getTime()) : new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function followupShiftMonth(monthKey, delta) {
    const parts = String(monthKey || "").split("-");
    const year = Number.parseInt(parts[0] || "", 10);
    const month = Number.parseInt(parts[1] || "", 10);
    const base = Number.isFinite(year) && Number.isFinite(month)
      ? new Date(year, Math.max(0, month - 1), 1)
      : new Date();
    base.setMonth(base.getMonth() + Number(delta || 0));
    return followupMonthKey(base);
  }

  function followupDayKey(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const date = new Date(ms);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function followupMonthLabel(monthKey) {
    const parts = String(monthKey || "").split("-");
    const year = Number.parseInt(parts[0] || "", 10);
    const month = Number.parseInt(parts[1] || "", 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return "Calendar";
    try {
      return new Date(year, Math.max(0, month - 1), 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric"
      });
    } catch {
      return `${parts[0]}-${parts[1]}`;
    }
  }

  function buildFollowupCalendarCells(monthKey, tasks) {
    const parts = String(monthKey || "").split("-");
    const year = Number.parseInt(parts[0] || "", 10);
    const month = Number.parseInt(parts[1] || "", 10);
    const anchor = Number.isFinite(year) && Number.isFinite(month)
      ? new Date(year, Math.max(0, month - 1), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const start = new Date(anchor.getTime());
    const day = start.getDay();
    start.setDate(start.getDate() - day);

    const counts = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const key = followupDayKey(task?.dueAt || "");
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start.getTime());
      date.setDate(start.getDate() + i);
      const key = followupDayKey(date.toISOString());
      const inMonth = date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear();
      cells.push({
        key,
        dayNumber: date.getDate(),
        inMonth,
        count: counts.get(key) || 0
      });
    }
    return cells;
  }

  function strategicTaskCandidates() {
    const root = document.getElementById("strategic-workbench");
    if (!root) return [];
    const lines = Array.from(root.querySelectorAll("li"))
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((text, idx, arr) => arr.indexOf(text) === idx)
      .slice(0, 80);
    return lines;
  }

  function installFollowupAgentBridge() {
    if (window.__atlasFollowupBridgeInstalled) return;
    window.__atlasFollowupBridgeInstalled = true;
    window.agentcFollowups = {
      list() {
        return loadFollowupTasks();
      },
      add(task) {
        const next = loadFollowupTasks();
        const row = normalizeFollowupTask(task, next.length);
        if (!row) return next;
        const saved = saveFollowupTasks([row, ...next], { action: "bridge-add" });
        return saved;
      },
      complete(taskId) {
        const id = String(taskId || "").trim();
        if (!id) return loadFollowupTasks();
        const next = loadFollowupTasks().map((item) => (
          item.id === id ? { ...item, status: "done", updatedAt: Date.now() } : item
        ));
        return saveFollowupTasks(next, { action: "bridge-complete", taskId: id });
      }
    };
  }

  function renderFollowupCalendarComponent(node, widgetDef) {
    if (!node || !widgetDef) return;
    installFollowupAgentBridge();
    const tasks = loadFollowupTasks();
    const now = Date.now();
    if (!FOLLOWUP_CALENDAR_UI_STATE.monthKey) {
      FOLLOWUP_CALENDAR_UI_STATE.monthKey = followupMonthKey(new Date(now));
    }
    const selectedDay = String(FOLLOWUP_CALENDAR_UI_STATE.selectedDay || "").trim();
    const monthKey = String(FOLLOWUP_CALENDAR_UI_STATE.monthKey || followupMonthKey(new Date(now)));
    const weekLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayCells = buildFollowupCalendarCells(monthKey, tasks);
    const buckets = { overdue: [], today: [], upcoming: [], done: [] };
    for (const task of tasks) {
      const key = followupBucket(task, now);
      if (!buckets[key]) continue;
      buckets[key].push(task);
    }

    const selectedLabel = (() => {
      if (!selectedDay) return "";
      const ms = Date.parse(`${selectedDay}T00:00:00`);
      if (!Number.isFinite(ms)) return selectedDay;
      try {
        return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit", year: "numeric" });
      } catch {
        return selectedDay;
      }
    })();

    const selectedCount = selectedDay
      ? tasks.filter((task) => followupDayKey(task?.dueAt || "") === selectedDay).length
      : 0;

    const renderTaskList = (list, bucketName) => {
      const filtered = selectedDay
        ? list.filter((task) => followupDayKey(task?.dueAt || "") === selectedDay)
        : list;
      if (!filtered.length) {
        return `<li class="followup-empty">${selectedDay ? "No tasks for selected day." : "No tasks."}</li>`;
      }
      return filtered.map((task) => {
        const priorityClass = `is-${task.priority}`;
        const doneAction = task.status === "done" ? "undo" : "done";
        const doneLabel = task.status === "done" ? "Reopen" : "Done";
        return `
          <li class="followup-task ${priorityClass}">
            <div class="followup-task-head">
              <strong>${escapeHtml(task.title)}</strong>
              <span>${escapeHtml(task.priority)}</span>
            </div>
            <p>${escapeHtml(formatFollowupDue(task.dueAt))}</p>
            <div class="followup-task-actions">
              <button type="button" data-followup-action="${doneAction}" data-followup-id="${escapeHtml(task.id)}">${doneLabel}</button>
              <button type="button" data-followup-action="snooze" data-followup-id="${escapeHtml(task.id)}">+1 day</button>
              <button type="button" data-followup-action="delete" data-followup-id="${escapeHtml(task.id)}">Delete</button>
            </div>
          </li>
        `;
      }).join("");
    };

    const calendarHtml = `
      <div class="followup-calendar-panel${FOLLOWUP_CALENDAR_UI_STATE.expanded ? "" : " is-collapsed"}">
        <div class="followup-calendar-head">
          <strong>${escapeHtml(followupMonthLabel(monthKey))}</strong>
          <div class="followup-calendar-nav">
            <button type="button" data-followup-month-prev aria-label="Previous month">◀</button>
            <button type="button" data-followup-month-today>Today</button>
            <button type="button" data-followup-month-next aria-label="Next month">▶</button>
          </div>
        </div>
        <div class="followup-calendar-grid" role="grid" aria-label="Task calendar">
          ${weekLabels.map((label) => `<span class="followup-calendar-weekday">${escapeHtml(label)}</span>`).join("")}
          ${dayCells.map((cell) => {
            const classes = [
              "followup-calendar-day",
              cell.inMonth ? "is-current-month" : "is-adjacent-month",
              cell.count > 0 ? "has-tasks" : "",
              selectedDay && selectedDay === cell.key ? "is-selected" : ""
            ].filter(Boolean).join(" ");
            const badge = cell.count > 0
              ? `<span class="followup-calendar-count">${escapeHtml(String(cell.count))}</span>`
              : "";
            return `<button type="button" class="${classes}" data-followup-day-key="${escapeHtml(cell.key)}" title="${escapeHtml(cell.key)}">
              <span>${escapeHtml(String(cell.dayNumber))}</span>${badge}
            </button>`;
          }).join("")}
        </div>
      </div>
    `;

    node.className = "blueprint-card followup-calendar-widget";
    node.innerHTML = `
      <h3>${escapeHtml(String(widgetDef.name || "Follow-up Calendar"))}</h3>
      <p class="followup-meta">Track organized tasks and follow-ups so the agent can execute in sequence.</p>
      <form class="followup-form" data-followup-form>
        <input type="text" maxlength="180" data-followup-title placeholder="Task title" required />
        <input type="datetime-local" data-followup-due />
        <select data-followup-priority>
          <option value="high">High</option>
          <option value="normal" selected>Normal</option>
          <option value="low">Low</option>
        </select>
        <button type="submit">Add Task</button>
      </form>
      <div class="followup-toolbar">
        <button type="button" data-followup-calendar-toggle>${FOLLOWUP_CALENDAR_UI_STATE.expanded ? "Collapse Calendar" : "Expand Calendar"}</button>
        <button type="button" data-followup-import>Import Strategic Tasks</button>
        <button type="button" data-followup-clear-done>Clear Completed</button>
        <button type="button" data-followup-clear-filter ${selectedDay ? "" : "disabled"}>Clear Day Filter</button>
      </div>
      <div class="followup-selected-note">${selectedDay ? `Filtered date: ${escapeHtml(selectedLabel)} (${escapeHtml(String(selectedCount))} task${selectedCount === 1 ? "" : "s"})` : "No day filter active. Select a date in calendar to focus tasks."}</div>
      ${calendarHtml}
      <div class="followup-columns">
        <section><h4>Overdue</h4><ul>${renderTaskList(buckets.overdue, "overdue")}</ul></section>
        <section><h4>Today</h4><ul>${renderTaskList(buckets.today, "today")}</ul></section>
        <section><h4>Upcoming</h4><ul>${renderTaskList(buckets.upcoming, "upcoming")}</ul></section>
        <section><h4>Done</h4><ul>${renderTaskList(buckets.done, "done")}</ul></section>
      </div>
    `;

    node.querySelector("[data-followup-calendar-toggle]")?.addEventListener("click", () => {
      FOLLOWUP_CALENDAR_UI_STATE.expanded = !FOLLOWUP_CALENDAR_UI_STATE.expanded;
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("[data-followup-month-prev]")?.addEventListener("click", () => {
      FOLLOWUP_CALENDAR_UI_STATE.monthKey = followupShiftMonth(monthKey, -1);
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("[data-followup-month-next]")?.addEventListener("click", () => {
      FOLLOWUP_CALENDAR_UI_STATE.monthKey = followupShiftMonth(monthKey, 1);
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("[data-followup-month-today]")?.addEventListener("click", () => {
      const nowKey = followupMonthKey(new Date());
      FOLLOWUP_CALENDAR_UI_STATE.monthKey = nowKey;
      FOLLOWUP_CALENDAR_UI_STATE.selectedDay = followupDayKey(new Date().toISOString());
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelectorAll("button[data-followup-day-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = String(btn.getAttribute("data-followup-day-key") || "").trim();
        if (!key) return;
        FOLLOWUP_CALENDAR_UI_STATE.selectedDay = FOLLOWUP_CALENDAR_UI_STATE.selectedDay === key ? "" : key;
        renderFollowupCalendarComponent(node, widgetDef);
      });
    });

    node.querySelector("[data-followup-clear-filter]")?.addEventListener("click", () => {
      FOLLOWUP_CALENDAR_UI_STATE.selectedDay = "";
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("form[data-followup-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const titleInput = node.querySelector("[data-followup-title]");
      const dueInput = node.querySelector("[data-followup-due]");
      const priorityInput = node.querySelector("[data-followup-priority]");
      const title = String(titleInput?.value || "").replace(/\s+/g, " ").trim().slice(0, 180);
      if (!title) return;
      const dueMs = Date.parse(String(dueInput?.value || "").trim());
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        dueAt: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : "",
        status: "todo",
        priority: normalizeFollowupPriority(priorityInput?.value || "normal"),
        source: "manual",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      saveFollowupTasks([task, ...loadFollowupTasks()], { action: "add" });
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("[data-followup-import]")?.addEventListener("click", () => {
      const existing = loadFollowupTasks();
      const existingTitles = new Set(existing.map((item) => item.title.toLowerCase()));
      const dueFallback = new Date(Date.now() + 86400000).toISOString();
      const imports = strategicTaskCandidates()
        .filter((title) => !existingTitles.has(title.toLowerCase()))
        .slice(0, 40)
        .map((title, idx) => ({
          id: `task_import_${Date.now()}_${idx}`,
          title,
          dueAt: dueFallback,
          status: "todo",
          priority: "normal",
          source: "strategic_workbench",
          createdAt: Date.now(),
          updatedAt: Date.now()
        }));
      if (!imports.length) return;
      saveFollowupTasks([...imports, ...existing], { action: "import", count: imports.length });
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelector("[data-followup-clear-done]")?.addEventListener("click", () => {
      const next = loadFollowupTasks().filter((item) => item.status !== "done");
      saveFollowupTasks(next, { action: "clear-done" });
      renderFollowupCalendarComponent(node, widgetDef);
    });

    node.querySelectorAll("button[data-followup-action][data-followup-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = String(btn.getAttribute("data-followup-action") || "").trim().toLowerCase();
        const taskId = String(btn.getAttribute("data-followup-id") || "").trim();
        if (!action || !taskId) return;
        const next = loadFollowupTasks();
        const idx = next.findIndex((item) => item.id === taskId);
        if (idx < 0) return;
        const task = { ...next[idx] };
        if (action === "delete") {
          next.splice(idx, 1);
        } else if (action === "done" || action === "undo") {
          task.status = action === "done" ? "done" : "todo";
          task.updatedAt = Date.now();
          next[idx] = task;
        } else if (action === "snooze") {
          const dueMs = Date.parse(String(task.dueAt || "")) || Date.now();
          task.dueAt = new Date(dueMs + 86400000).toISOString();
          task.updatedAt = Date.now();
          if (task.status === "done") task.status = "todo";
          next[idx] = task;
        }
        saveFollowupTasks(next, { action, taskId });
        renderFollowupCalendarComponent(node, widgetDef);
      });
    });
  }

  function ensureFollowupCalendarComponentNode(root, widgetDef) {
    if (!root || !widgetDef || String(widgetDef.source || "") !== "followup_calendar") return null;
    const componentId = String(widgetDef.componentId || "").trim() || "agent-followup-calendar";
    let node = document.getElementById(componentId);
    if (!node) {
      node = document.createElement("section");
      node.id = componentId;
      root.appendChild(node);
    }
    renderFollowupCalendarComponent(node, widgetDef);
    return node;
  }

  function handleEngineToolRegistryUpdate(event) {
    applyEngineToolRegistry();
    if (!ensureGrid()) {
      bootstrapGridWithRetry(() => { handleEngineToolRegistryUpdate(event); }, "engine-registry");
      return;
    }
    if (!state.layout) {
      renderAddWidgetList();
      return;
    }
    const snapshot = cloneLayout(state.layout) || state.layout;
    state.layout = migrateLayout(snapshot, state.role);
    renderLayout();

    const detail = event && typeof event === "object" ? event.detail || {} : {};
    const widgetId = normalizeEngineToolId(detail?.widgetId || "");
    const autoEnable = Boolean(detail?.autoEnable);
    if (widgetId && autoEnable) {
      setWidgetEnabled(widgetId, true);
      return;
    }
    queuePersistLayout(true);
  }

  function isRoleAllowed(widgetDef, role) {
    const list = Array.isArray(widgetDef?.allowedRoles) ? widgetDef.allowedRoles : [];
    return list.includes(normalizeRole(role));
  }

  function loadStoredRole() {
    try {
      return normalizeRole(localStorage.getItem(DASHBOARD_ROLE_KEY) || "user");
    } catch {
      return "user";
    }
  }

  function storeRole(role) {
    try {
      localStorage.setItem(DASHBOARD_ROLE_KEY, normalizeRole(role));
    } catch {
      // ignore
    }
  }

  function loadStoredUserId() {
    try {
      return normalizeUserId(localStorage.getItem(DASHBOARD_USER_ID_KEY) || "");
    } catch {
      return "";
    }
  }

  function storeUserId(userId) {
    try {
      localStorage.setItem(DASHBOARD_USER_ID_KEY, normalizeUserId(userId));
    } catch {
      // ignore
    }
  }

  function inferUserId() {
    const direct = loadStoredUserId();
    if (direct) return direct;
    try {
      const fromStorage = normalizeUserId(
        localStorage.getItem("agentc_user_email") ||
          localStorage.getItem("mk_user_email") ||
          localStorage.getItem("agentc_user_id") ||
          ""
      );
      if (fromStorage) return fromStorage;
    } catch {
      // ignore
    }
    const signalInput = document.getElementById("signal_user_email");
    if (signalInput && String(signalInput.value || "").trim()) {
      return normalizeUserId(signalInput.value);
    }
    return "";
  }

  function isMobileLayout() {
    try {
      return window.matchMedia(MOBILE_QUERY).matches;
    } catch {
      return window.innerWidth <= 700;
    }
  }

  function currentColumnCount() {
    if (isMobileLayout()) return 1;
    try {
      return window.matchMedia(TABLET_QUERY).matches ? 8 : 12;
    } catch {
      return window.innerWidth <= 1100 ? 8 : 12;
    }
  }

  function presetWidthForSize(size, cols) {
    const key = String(size || "").trim().toLowerCase();
    if (key === "small") return Math.max(1, Math.round(cols * 0.34));
    if (key === "medium") return Math.max(1, Math.round(cols * 0.5));
    return cols;
  }

  function isStarterWidgetId(widgetId) {
    const target = String(widgetId || "").trim();
    return STARTER_WIDGET_IDS.includes(target);
  }

  function starterLayoutKey(role, userId) {
    const r = normalizeRole(role);
    const uid = normalizeUserId(userId) || "anon";
    return `${STARTER_LAYOUT_APPLIED_KEY_PREFIX}:${r}:${uid}`;
  }

  function shouldApplyStarterLayout(role, userId) {
    if (!STARTER_WIDGET_MODE) return false;
    try {
      return String(localStorage.getItem(starterLayoutKey(role, userId)) || "") !== "1";
    } catch {
      return false;
    }
  }

  function markStarterLayoutApplied(role, userId) {
    if (!STARTER_WIDGET_MODE) return;
    try {
      localStorage.setItem(starterLayoutKey(role, userId), "1");
    } catch {
      // ignore storage failures
    }
  }

  function defaultWidgetRecord(widgetDef, index, role) {
    const cols = 12;
    const width = Math.min(cols, presetWidthForSize(widgetDef.defaultSize, cols));
    const height = Math.max(1, Number(widgetDef?.defaultProps?.defaultH || 12));
    const roleAllowed = isRoleAllowed(widgetDef, role);
    const defaultEnabled = typeof widgetDef?.defaultEnabled === "boolean" ? widgetDef.defaultEnabled : roleAllowed;
    const forcedEnabled = STARTER_WIDGET_MODE
      ? (isStarterWidgetId(widgetDef.id) && roleAllowed)
      : (roleAllowed && defaultEnabled);
    return {
      id: widgetDef.id,
      x: 0,
      y: index * Math.max(2, height),
      w: width,
      h: height,
      enabled: forcedEnabled,
      settings: {
        title: String(widgetDef?.defaultProps?.title || ""),
        refreshSec: Number(widgetDef?.defaultProps?.refreshSec || 0),
        visible: true,
        size: String(widgetDef.defaultSize || "large").toLowerCase()
      }
    };
  }

  function enforceStarterWidgetDefaults(widgets, role) {
    if (!STARTER_WIDGET_MODE || !Array.isArray(widgets)) return widgets;
    const r = normalizeRole(role);
    const map = new Map();
    for (const item of widgets) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id || "").trim();
      if (!id || map.has(id)) continue;
      map.set(id, item);
    }
    const ordered = [];
    let cursor = 0;
    for (let i = 0; i < STARTER_WIDGET_IDS.length; i += 1) {
      const id = STARTER_WIDGET_IDS[i];
      const def = REGISTRY_BY_ID.get(id);
      if (!def || !isRoleAllowed(def, r)) continue;
      let record = map.get(id);
      if (!record) {
        record = defaultWidgetRecord(def, i, r);
      }
      record.enabled = true;
      record.settings = {
        ...(record.settings || {}),
        visible: true
      };
      record.x = 0;
      record.y = cursor;
      cursor += Math.max(1, Number(record.h || 1));
      ordered.push(record);
      map.delete(id);
    }
    for (const item of widgets) {
      if (!item || typeof item !== "object") continue;
      if (isStarterWidgetId(item.id)) continue;
      item.enabled = false;
      ordered.push(item);
    }
    widgets.length = 0;
    widgets.push(...ordered);
    return widgets;
  }

  function applyStarterLayoutSnapshot(layout, role) {
    if (!STARTER_WIDGET_MODE || !layout || !Array.isArray(layout.widgets)) return false;
    const before = JSON.stringify(layout.widgets);
    const widgets = layout.widgets.map((item) => (
      item && typeof item === "object"
        ? { ...item, settings: { ...(item.settings || {}) } }
        : item
    ));
    enforceStarterWidgetDefaults(widgets, role);
    layout.widgets = normalizeWidgetOrder(widgets);
    const after = JSON.stringify(layout.widgets);
    if (before === after) return false;
    touchLayout(layout);
    return true;
  }

  function buildDefaultLayout(role) {
    const r = normalizeRole(role);
    const widgets = [];
    let index = 0;
    for (const def of WIDGET_REGISTRY) {
      if (!isRoleAllowed(def, r)) continue;
      widgets.push(defaultWidgetRecord(def, index, r));
      index += 1;
    }
    enforceStarterWidgetDefaults(widgets, r);
    normalizeWidgetOrder(widgets);
    return {
      version: DASHBOARD_LAYOUT_VERSION,
      role: r,
      updatedAt: 0,
      widgets
    };
  }

  function normalizeWidgetRecord(rawRecord, widgetDef, fallbackIndex) {
    const fallback = defaultWidgetRecord(widgetDef, fallbackIndex, state.role);
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

  function migrateLayout(rawLayout, role) {
    const r = normalizeRole(role);
    const fallback = buildDefaultLayout(r);
    if (!rawLayout || typeof rawLayout !== "object") return fallback;
    const incoming = Array.isArray(rawLayout.widgets) ? rawLayout.widgets : [];
    const incomingById = new Map(
      incoming
        .filter((item) => item && typeof item === "object" && String(item.id || "").trim())
        .map((item) => [String(item.id).trim(), item])
    );

    const widgets = [];
    let idx = 0;
    for (const def of WIDGET_REGISTRY) {
      if (!isRoleAllowed(def, r)) continue;
      const incomingRecord = def.id === STOVE_WIDGET_ID
        ? (incomingById.get(STOVE_WIDGET_ID) || incomingById.get("engine"))
        : incomingById.get(def.id);
      const next = normalizeWidgetRecord(incomingRecord, def, idx);
      widgets.push(next);
      idx += 1;
    }

    widgets.sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
    normalizeWidgetOrder(widgets);
    return {
      version: DASHBOARD_LAYOUT_VERSION,
      role: r,
      updatedAt: Math.max(0, Number(rawLayout?.updatedAt || 0)),
      widgets
    };
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

  function recoverEmptyLayout(layout, role, userId) {
    if (!layout || !Array.isArray(layout.widgets)) return layout;
    if (layout.widgets.some((item) => item && item.enabled)) return layout;
    const fallback = buildDefaultLayout(role);
    if (!fallback || !Array.isArray(fallback.widgets) || !fallback.widgets.length) return layout;
    layout.widgets = normalizeWidgetOrder(fallback.widgets.map((item) => ({
      ...item,
      settings: { ...(item.settings || {}) }
    })));
    touchLayout(layout);
    saveLocalLayout(layout, role, userId);
    void saveServerLayout(layout, role, userId);
    debugLog("layout-empty-recovered", { role: normalizeRole(role), count: layout.widgets.length });
    setStatus("Recovered dashboard from an empty layout state.", true);
    return layout;
  }

  function touchLayout(layout) {
    if (!layout || typeof layout !== "object") return;
    layout.updatedAt = Date.now();
  }

  function layoutStorageKey(role, userId) {
    const r = normalizeRole(role);
    const uid = normalizeUserId(userId) || "anon";
    return `${DASHBOARD_LAYOUT_KEY_PREFIX}:${r}:${uid}`;
  }

  function loadLocalLayout(role, userId) {
    const key = layoutStorageKey(role, userId);
    try {
      const raw = String(localStorage.getItem(key) || "").trim();
      if (!raw) return null;
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== "object") {
        localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function saveLocalLayout(layout, role, userId) {
    const key = layoutStorageKey(role, userId);
    try {
      localStorage.setItem(key, JSON.stringify(layout));
      return true;
    } catch {
      return false;
    }
  }

  function queryValue(reqUrl, name) {
    try {
      const url = new URL(reqUrl, window.location.origin);
      return String(url.searchParams.get(name) || "").trim();
    } catch {
      return "";
    }
  }

  async function fetchServerLayout(role, userId) {
    const params = new URLSearchParams();
    params.set("role", normalizeRole(role));
    if (normalizeUserId(userId)) params.set("user_id", normalizeUserId(userId));
    const route = `${DASHBOARD_API_PATH}?${params.toString()}`;
    try {
      const res = await fetch(route, { method: "GET", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true || !data.layout || typeof data.layout !== "object") return null;
      return data.layout;
    } catch {
      return null;
    }
  }

  async function saveServerLayout(layout, role, userId) {
    const params = new URLSearchParams();
    params.set("role", normalizeRole(role));
    if (normalizeUserId(userId)) params.set("user_id", normalizeUserId(userId));
    const route = `${DASHBOARD_API_PATH}?${params.toString()}`;
    const payload = {
      role: normalizeRole(role),
      user_id: normalizeUserId(userId),
      layout
    };
    try {
      const res = await fetch(route, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      return Boolean(res.ok && data && data.ok === true);
    } catch {
      return false;
    }
  }

  function setStatus(message, isWarn) {
    const node = state.ui.status;
    if (!node) return;
    node.textContent = String(message || "");
    node.style.color = isWarn ? "#ffd88b" : "var(--text-dim)";
  }

  function injectStyles() {
    if (document.getElementById("dashboard_widget_styles")) return;
    const style = document.createElement("style");
    style.id = "dashboard_widget_styles";
    style.textContent = `
      .dashboard-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0 8px;
      }

      .dashboard-controls-left,
      .dashboard-controls-right {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .dashboard-controls label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .dashboard-controls button,
      .dashboard-controls select,
      .dashboard-controls input[type="text"] {
        border: 1px solid rgba(120, 199, 244, 0.33);
        background: rgba(7, 30, 55, 0.72);
        color: var(--text-main);
        border-radius: 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        padding: 7px 10px;
      }

      .dashboard-controls input[type="checkbox"] {
        accent-color: var(--accent);
      }

      .dashboard-controls button {
        cursor: pointer;
      }

      .dashboard-status-note {
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        color: var(--text-dim);
      }

      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 0;
        align-items: start;
      }

      .dashboard-widget {
        position: relative;
        min-height: var(--widget-min-height, 0px);
        grid-column: 1 / -1;
      }

      .dashboard-widget-toolbar {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 20;
        display: none;
        align-items: center;
        gap: 6px;
      }

      .dashboard-widget-toolbar button {
        border: 1px solid rgba(120, 199, 244, 0.35);
        background: rgba(5, 23, 43, 0.86);
        color: var(--text-main);
        border-radius: 7px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 5px 8px;
        cursor: pointer;
      }

      .dashboard-widget-drag {
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .dashboard-widget-title {
        display: none;
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 20;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-dim);
        background: rgba(6, 24, 44, 0.78);
        border: 1px solid rgba(120, 199, 244, 0.24);
        border-radius: 999px;
        padding: 4px 8px;
      }

      .dashboard-widget-hidden-note {
        display: none;
        border: 1px dashed rgba(133, 205, 245, 0.44);
        border-radius: 10px;
        padding: 12px;
        margin: 6px 0;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.7rem;
        color: var(--text-dim);
        background: rgba(8, 28, 49, 0.55);
      }

      .dashboard-widget-error {
        display: none;
        border: 1px solid rgba(255, 130, 130, 0.45);
        border-radius: 10px;
        padding: 12px;
        margin: 6px 0;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        color: #ffd7d7;
        background: rgba(58, 18, 18, 0.72);
      }

      .dashboard-widget.has-error .dashboard-widget-error {
        display: block;
      }

      .dashboard-widget-content {
        position: relative;
      }

      .dashboard-widget-resize {
        position: absolute;
        right: 10px;
        bottom: 10px;
        width: 18px;
        height: 18px;
        border: 1px solid rgba(120, 199, 244, 0.38);
        border-radius: 4px;
        background:
          linear-gradient(135deg, transparent 56%, rgba(112, 204, 248, 0.94) 56%, rgba(112, 204, 248, 0.94) 64%, transparent 64%),
          rgba(6, 24, 44, 0.82);
        cursor: nwse-resize;
        display: none;
        z-index: 21;
      }

      body.dashboard-edit-mode .dashboard-grid {
        gap: 12px;
      }

      body.dashboard-edit-mode .dashboard-widget {
        padding: 4px;
        border-radius: 12px;
        outline: 1px dashed rgba(118, 196, 240, 0.5);
        outline-offset: -1px;
      }

      body.dashboard-edit-mode .dashboard-widget-toolbar,
      body.dashboard-edit-mode .dashboard-widget-title,
      body.dashboard-edit-mode .dashboard-widget-resize {
        display: inline-flex;
      }

      body.dashboard-edit-mode .dashboard-widget.is-hidden .dashboard-widget-content {
        display: none;
      }

      body.dashboard-edit-mode .dashboard-widget.is-hidden .dashboard-widget-hidden-note {
        display: block;
      }

      .dashboard-widget.is-dragging {
        opacity: 0.5;
      }

      .dashboard-widget.drop-before::before,
      .dashboard-widget.drop-after::after {
        content: "";
        position: absolute;
        left: 4px;
        right: 4px;
        height: 3px;
        border-radius: 999px;
        background: var(--accent);
        z-index: 40;
      }

      .dashboard-widget.drop-before::before {
        top: 0;
      }

      .dashboard-widget.drop-after::after {
        bottom: 0;
      }

      body.dashboard-resizing {
        cursor: nwse-resize;
        user-select: none;
      }

      body.dashboard-dragging {
        cursor: grabbing;
        user-select: none;
      }

      .dashboard-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 12, 24, 0.62);
        backdrop-filter: blur(2px);
        z-index: 80;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }

      .dashboard-modal-backdrop.open {
        display: flex;
      }

      .dashboard-modal {
        width: min(640px, 100%);
        max-height: min(86vh, 760px);
        overflow: auto;
        border: 1px solid rgba(120, 199, 244, 0.38);
        border-radius: 12px;
        background: rgba(6, 24, 44, 0.95);
        padding: 14px;
      }

      .dashboard-modal h3 {
        margin: 0 0 10px;
        font-size: 1rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .dashboard-modal-grid {
        display: grid;
        gap: 10px;
      }

      .dashboard-modal-grid label {
        display: grid;
        gap: 6px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .dashboard-modal input,
      .dashboard-modal select,
      .dashboard-modal button {
        border: 1px solid rgba(120, 199, 244, 0.33);
        background: rgba(8, 31, 56, 0.82);
        color: var(--text-main);
        border-radius: 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.75rem;
        padding: 8px 10px;
      }

      .dashboard-modal button {
        cursor: pointer;
      }

      .dashboard-modal button:disabled {
        opacity: 0.52;
        cursor: not-allowed;
      }

      .dashboard-modal-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .dashboard-modal-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }

      .dashboard-widget-picker-list {
        display: grid;
        gap: 8px;
      }

      .dashboard-widget-picker-item {
        border: 1px solid rgba(120, 199, 244, 0.24);
        border-radius: 10px;
        background: rgba(8, 30, 53, 0.7);
        padding: 9px;
        display: grid;
        gap: 8px;
      }

      .dashboard-widget-picker-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .dashboard-widget-picker-head strong {
        font-size: 0.9rem;
        letter-spacing: 0.04em;
      }

      .dashboard-widget-picker-meta {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .engine-tool-widget {
        margin: 0;
      }

      .engine-tool-grid {
        display: grid;
        gap: 10px;
      }

      .engine-tool-intent {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.73rem;
        line-height: 1.45;
      }

      .engine-tool-inputs {
        display: grid;
        gap: 8px;
      }

      .engine-tool-inputs label {
        display: grid;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.75rem;
      }

      .engine-tool-inputs input,
      .engine-tool-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 9px 10px;
        font-family: "IBM Plex Mono", monospace;
      }

      .engine-tool-actions button {
        cursor: pointer;
      }

      .engine-tool-status {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.75rem;
      }

      .engine-tool-output {
        margin: 0;
        border: 1px solid rgba(126, 207, 255, 0.22);
        border-radius: 8px;
        background: rgba(4, 22, 40, 0.64);
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        line-height: 1.45;
        padding: 8px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .api-usage-widget {
        margin: 0;
      }

      .api-usage-meta {
        margin: 2px 0 8px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .api-usage-actions {
        display: inline-flex;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .api-usage-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 7px 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        cursor: pointer;
      }

      .api-access-install-link {
        display: inline-flex;
        align-items: center;
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 7px 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        text-decoration: none;
      }

      .api-usage-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
      }

      .api-usage-list li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: baseline;
        gap: 10px;
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
      }

      .api-usage-route {
        color: var(--text-dim);
        overflow-wrap: anywhere;
      }

      .api-usage-empty {
        display: block;
        color: var(--text-dim);
      }

      .api-access-panel {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 10px;
        background: rgba(4, 19, 36, 0.62);
        padding: 8px;
        display: grid;
        gap: 8px;
      }

      .api-access-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .api-access-badge {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 999px;
        padding: 2px 8px;
        font-weight: 700;
        color: var(--text-main);
      }

      .api-access-badge.is-ok {
        border-color: rgba(126, 255, 194, 0.62);
        color: #8ff2cb;
      }

      .api-access-badge.is-warn {
        border-color: rgba(255, 210, 125, 0.5);
        color: #ffd79d;
      }

      .api-access-badge.is-error {
        border-color: rgba(255, 167, 167, 0.6);
        color: #ffb0b0;
      }

      .api-access-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }

      .api-access-item {
        border: 1px solid rgba(126, 207, 255, 0.16);
        border-radius: 8px;
        background: rgba(5, 22, 41, 0.62);
        padding: 7px 8px;
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }

      .api-access-item-main {
        display: grid;
        gap: 4px;
      }

      .api-access-item-main strong {
        color: var(--text-main);
        font-size: 0.74rem;
      }

      .api-access-item-main span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
      }

      .api-access-item-side {
        display: grid;
        justify-items: end;
        align-content: start;
        gap: 4px;
      }

      .api-access-links {
        display: inline-flex;
        gap: 8px;
      }

      .api-access-links a {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
        text-decoration: none;
      }

      .api-access-links a:hover {
        text-decoration: underline;
      }

      .api-access-empty {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .api-access-error {
        color: #ffb0b0;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .welcome-board-widget {
        margin: 0;
        border-color: rgba(122, 214, 255, 0.24);
        background:
          radial-gradient(130% 120% at 100% 0%, rgba(56, 133, 255, 0.2) 0%, rgba(5, 18, 36, 0.6) 56%, rgba(5, 18, 36, 0.9) 100%),
          linear-gradient(180deg, rgba(7, 25, 46, 0.95) 0%, rgba(4, 18, 34, 0.95) 100%);
      }

      .widget-board-shell {
        display: grid;
        gap: 12px;
      }

      .widget-board-header {
        border: 1px solid rgba(122, 214, 255, 0.22);
        border-radius: 12px;
        padding: 12px;
        background: linear-gradient(140deg, rgba(8, 31, 56, 0.88) 0%, rgba(10, 37, 68, 0.66) 100%);
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .widget-board-kicker {
        display: inline-block;
        color: #89d7ff;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .widget-board-header h2 {
        margin: 6px 0 6px;
        color: #f4fbff;
        font-size: clamp(1.1rem, 2.2vw, 1.5rem);
        line-height: 1.2;
      }

      .widget-board-header p {
        margin: 0;
        color: rgba(228, 246, 255, 0.85);
        font-size: 0.75rem;
        line-height: 1.5;
      }

      .widget-board-meta {
        display: grid;
        gap: 7px;
        align-content: start;
      }

      .widget-board-meta span {
        border: 1px solid rgba(122, 214, 255, 0.16);
        border-radius: 8px;
        background: rgba(4, 20, 38, 0.7);
        color: rgba(219, 241, 255, 0.9);
        padding: 6px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
      }

      .widget-board-meta strong {
        color: #ecf8ff;
      }

      .widget-board-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .widget-board-tabs button {
        border: 1px solid rgba(122, 214, 255, 0.24);
        border-radius: 999px;
        background: rgba(6, 32, 60, 0.75);
        color: #d8f1ff;
        padding: 6px 11px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
        cursor: pointer;
      }

      .widget-board-tabs button.is-active {
        border-color: rgba(126, 228, 255, 0.55);
        background: rgba(14, 72, 115, 0.86);
        color: #f1fbff;
      }

      .widget-board-cards {
        border: 1px solid rgba(122, 214, 255, 0.2);
        border-radius: 12px;
        background: rgba(5, 22, 41, 0.58);
        padding: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 9px;
        min-height: 130px;
      }

      .widget-board-card {
        border: 1px solid rgba(122, 214, 255, 0.19);
        border-radius: 10px;
        background: rgba(6, 24, 44, 0.78);
        padding: 9px;
        display: grid;
        gap: 8px;
        cursor: grab;
      }

      .widget-board-card.is-dragging {
        opacity: 0.55;
      }

      .widget-board-card-head {
        display: grid;
        gap: 4px;
      }

      .widget-board-card-head strong {
        color: #ecf8ff;
        font-size: 0.78rem;
        line-height: 1.35;
      }

      .widget-board-card-head span {
        color: rgba(175, 216, 236, 0.9);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .widget-board-card-actions {
        display: flex;
        gap: 7px;
      }

      .widget-board-card-actions button,
      .widget-board-add button {
        border: 1px solid rgba(122, 214, 255, 0.24);
        border-radius: 8px;
        background: rgba(7, 34, 61, 0.85);
        color: #e3f5ff;
        padding: 6px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
        cursor: pointer;
      }

      .widget-board-empty {
        margin: 0;
        align-self: center;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.7rem;
      }

      .widget-board-add {
        border: 1px solid rgba(122, 214, 255, 0.2);
        border-radius: 12px;
        background: rgba(5, 22, 41, 0.55);
        padding: 10px;
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) auto;
        gap: 8px;
      }

      .widget-board-add select,
      .widget-board-add input {
        border: 1px solid rgba(122, 214, 255, 0.22);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 8px 9px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
        min-width: 0;
      }

      .widget-board-modal {
        position: fixed;
        inset: 0;
        z-index: 90;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 12, 24, 0.72);
        backdrop-filter: blur(2px);
        padding: 16px;
      }

      .widget-board-modal-dialog {
        width: min(620px, 100%);
        max-height: 82vh;
        overflow: auto;
        border: 1px solid rgba(122, 214, 255, 0.28);
        border-radius: 12px;
        background: rgba(6, 24, 44, 0.97);
        padding: 12px;
        display: grid;
        gap: 10px;
      }

      .widget-board-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .widget-board-modal-head strong {
        color: #f1fbff;
        font-size: 0.88rem;
        letter-spacing: 0.03em;
      }

      .widget-board-modal-head button {
        border: 1px solid rgba(122, 214, 255, 0.24);
        border-radius: 8px;
        background: rgba(7, 34, 61, 0.85);
        color: #e3f5ff;
        padding: 6px 9px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
        cursor: pointer;
      }

      .widget-board-modal-body {
        border: 1px solid rgba(122, 214, 255, 0.18);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.68);
        padding: 10px;
        color: #dff4ff;
        font-size: 0.74rem;
        line-height: 1.5;
      }

      .widget-board-modal-body ul {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
      }

      .widget-board-modal-body a {
        color: #8bdfff;
      }

      .widget-board-metric-view {
        display: grid;
        gap: 4px;
      }

      .widget-board-metric-view strong {
        color: #f2fbff;
        font-size: 1.12rem;
      }

      .widget-board-metric-view span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
        text-transform: uppercase;
      }

      .fasthosts-widget {
        margin: 0;
      }

      .fasthosts-grid {
        display: grid;
        gap: 10px;
      }

      .fasthosts-form label {
        display: grid;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
      }

      .fasthosts-input-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }

      .fasthosts-input-row input,
      .fasthosts-input-row button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 8px 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.73rem;
      }

      .fasthosts-input-row button {
        cursor: pointer;
      }

      .fasthosts-input-row button:disabled {
        opacity: 0.65;
        cursor: progress;
      }

      .fasthosts-indicators {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .fasthosts-indicator {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 999px;
        padding: 4px 9px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: rgba(5, 22, 40, 0.78);
        color: var(--text-dim);
      }

      .fasthosts-indicator.is-good {
        border-color: rgba(102, 219, 163, 0.42);
        color: #86e5b8;
      }

      .fasthosts-indicator.is-warn {
        border-color: rgba(255, 207, 121, 0.42);
        color: #ffd88b;
      }

      .fasthosts-indicator.is-critical {
        border-color: rgba(255, 138, 138, 0.45);
        color: #ffb2b2;
      }

      .fasthosts-indicator.is-unknown {
        border-color: rgba(126, 207, 255, 0.2);
        color: var(--text-dim);
      }

      .fasthosts-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
      }

      .fasthosts-meta div {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 8px;
        background: rgba(5, 22, 41, 0.64);
        padding: 7px 8px;
        display: grid;
        gap: 4px;
      }

      .fasthosts-meta span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .fasthosts-meta strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
        line-height: 1.35;
      }

      .fasthosts-alerts {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.55);
        padding: 9px;
        display: grid;
        gap: 8px;
      }

      .fasthosts-alerts-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 6px;
      }

      .fasthosts-alerts-head strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.76rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      .fasthosts-alerts-head span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
      }

      .fasthosts-alert-note {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
      }

      .fasthosts-alert-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .fasthosts-alert-toolbar button,
      .fasthosts-alert-form button,
      .fasthosts-alert-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 6px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
        cursor: pointer;
      }

      .fasthosts-alert-form {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 7px;
      }

      .fasthosts-alert-form input,
      .fasthosts-alert-form select {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.7);
        color: var(--text-main);
        padding: 6px 7px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        min-width: 0;
      }

      .fasthosts-alert-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 7px;
      }

      .fasthosts-alert-item {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 8px;
        background: rgba(5, 22, 41, 0.58);
        padding: 7px 8px;
        display: grid;
        gap: 6px;
      }

      .fasthosts-alert-item.is-critical {
        border-color: rgba(255, 138, 138, 0.48);
      }

      .fasthosts-alert-item.is-warn {
        border-color: rgba(255, 207, 121, 0.52);
      }

      .fasthosts-alert-item.is-info {
        border-color: rgba(126, 207, 255, 0.4);
      }

      .fasthosts-alert-item.is-resolved {
        opacity: 0.82;
      }

      .fasthosts-alert-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 6px;
      }

      .fasthosts-alert-head strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.71rem;
      }

      .fasthosts-alert-head span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
      }

      .fasthosts-alert-item p {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
        line-height: 1.4;
      }

      .fasthosts-alert-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }

      .fasthosts-alert-empty {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
      }

      .fasthosts-status {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.73rem;
      }

      .fasthosts-status.is-error {
        color: #ffb7b7;
      }

      .fasthosts-output {
        margin: 0;
        border: 1px solid rgba(126, 207, 255, 0.22);
        border-radius: 8px;
        background: rgba(4, 22, 40, 0.64);
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.71rem;
        line-height: 1.45;
        padding: 8px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 320px;
        overflow: auto;
      }

      .server-monitor-widget {
        margin: 0;
      }

      .server-monitor-grid {
        display: grid;
        gap: 10px;
      }

      .server-monitor-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .server-monitor-toolbar button,
      .server-monitor-notifications button,
      .server-monitor-credentials button,
      .server-monitor-gate-actions button,
      .server-monitor-install-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 6px 9px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
        cursor: pointer;
      }

      .server-monitor-toolbar button:disabled,
      .server-monitor-credentials button:disabled,
      .server-monitor-notifications button:disabled {
        opacity: 0.7;
        cursor: progress;
      }

      .server-monitor-auto {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        text-transform: uppercase;
      }

      .server-monitor-workspace {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
      }

      .server-monitor-gate {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.62);
        padding: 9px;
        display: grid;
        gap: 8px;
      }

      .server-monitor-gate p {
        margin: 0;
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.69rem;
      }

      .server-monitor-gate-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .server-monitor-gate.is-critical {
        border-color: rgba(255, 138, 138, 0.5);
      }

      .server-monitor-gate.is-warn {
        border-color: rgba(255, 207, 121, 0.5);
      }

      .server-monitor-gate.is-good {
        border-color: rgba(102, 219, 163, 0.45);
      }

      .server-monitor-credentials {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.55);
        padding: 9px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .server-monitor-credentials label {
        display: grid;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .server-monitor-credentials input {
        border: 1px solid rgba(126, 207, 255, 0.22);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 7px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
        min-width: 0;
      }

      .server-monitor-install {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.55);
        padding: 9px;
        display: grid;
        gap: 7px;
      }

      .server-monitor-install p {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.67rem;
      }

      .server-monitor-install pre {
        margin: 0;
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.68);
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
        line-height: 1.45;
        padding: 8px;
        overflow: auto;
      }

      .server-monitor-install-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .server-monitor-install-actions a {
        color: var(--accent);
        text-decoration: none;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        align-self: center;
      }

      .server-monitor-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .server-monitor-chip {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 999px;
        padding: 4px 9px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: rgba(5, 22, 40, 0.78);
        color: var(--text-dim);
      }

      .server-monitor-chip.is-good {
        border-color: rgba(102, 219, 163, 0.42);
        color: #86e5b8;
      }

      .server-monitor-chip.is-warn {
        border-color: rgba(255, 207, 121, 0.42);
        color: #ffd88b;
      }

      .server-monitor-chip.is-critical {
        border-color: rgba(255, 138, 138, 0.45);
        color: #ffb2b2;
      }

      .server-monitor-chip.is-unknown {
        border-color: rgba(126, 207, 255, 0.2);
        color: var(--text-dim);
      }

      .server-monitor-signals {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
      }

      .server-monitor-signals article {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 8px;
        background: rgba(5, 22, 41, 0.64);
        padding: 7px 8px;
        display: grid;
        gap: 4px;
      }

      .server-monitor-signals span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
      }

      .server-monitor-signals strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
      }

      .server-monitor-signals em {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        font-style: normal;
      }

      .server-monitor-maintenance {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.55);
        padding: 9px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
      }

      .server-monitor-maintenance div {
        border: 1px solid rgba(126, 207, 255, 0.16);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.58);
        padding: 7px 8px;
        display: grid;
        gap: 4px;
      }

      .server-monitor-maintenance span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
      }

      .server-monitor-maintenance strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .server-monitor-ssl ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 5px;
      }

      .server-monitor-ssl-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 6px;
        align-items: center;
      }

      .server-monitor-ssl-item strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .server-monitor-ssl-item em {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        font-style: normal;
      }

      .server-monitor-notifications,
      .server-monitor-alerts,
      .server-monitor-actions {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 10px;
        background: rgba(5, 22, 41, 0.55);
        padding: 9px;
        display: grid;
        gap: 8px;
      }

      .server-monitor-notifications strong,
      .server-monitor-alerts strong,
      .server-monitor-actions strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .server-monitor-notification-toggles {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .server-monitor-notification-toggles label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
      }

      .server-monitor-alerts ul,
      .server-monitor-actions ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }

      .server-monitor-alert {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.58);
        padding: 7px 8px;
        display: grid;
        gap: 4px;
      }

      .server-monitor-alert strong {
        font-size: 0.68rem;
      }

      .server-monitor-alert span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
        line-height: 1.35;
      }

      .server-monitor-alert.is-critical {
        border-color: rgba(255, 138, 138, 0.48);
      }

      .server-monitor-alert.is-warn {
        border-color: rgba(255, 207, 121, 0.52);
      }

      .server-monitor-empty {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.65rem;
      }

      .server-monitor-status {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.71rem;
      }

      .server-monitor-status.is-error {
        color: #ffb7b7;
      }

      .agent-budget-widget {
        margin: 0;
      }

      .agent-budget-meta {
        margin: 0 0 10px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .agent-budget-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }

      .agent-budget-summary div {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 8px;
        background: rgba(5, 22, 41, 0.64);
        padding: 7px 8px;
        display: grid;
        gap: 4px;
      }

      .agent-budget-summary span {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .agent-budget-summary strong {
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
      }

      .agent-budget-summary .is-good strong {
        color: #86e5b8;
      }

      .agent-budget-summary .is-warn strong {
        color: #ffd88b;
      }

      .agent-budget-summary .is-critical strong {
        color: #ffb2b2;
      }

      .agent-budget-grid,
      .agent-budget-actions {
        display: grid;
        gap: 8px;
        margin-bottom: 10px;
      }

      .agent-budget-grid {
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      }

      .agent-budget-actions {
        grid-template-columns: 120px minmax(0, 1fr) repeat(4, auto);
      }

      .agent-budget-grid label {
        display: grid;
        gap: 6px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .agent-budget-grid input,
      .agent-budget-grid select,
      .agent-budget-grid button,
      .agent-budget-actions input,
      .agent-budget-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 8px 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .agent-budget-grid button,
      .agent-budget-actions button {
        cursor: pointer;
      }

      .agent-budget-status {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        margin-bottom: 8px;
      }

      .agent-budget-status.is-error {
        color: #ffb7b7;
      }

      .agent-budget-ledger {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
      }

      .agent-budget-ledger li {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        color: var(--text-main);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.7rem;
      }

      .agent-budget-ledger li span {
        color: var(--accent);
      }

      .agent-budget-ledger li em {
        color: var(--text-dim);
        font-style: normal;
        text-transform: uppercase;
        font-size: 0.66rem;
      }

      .agent-budget-empty {
        color: var(--text-dim);
      }

      .followup-calendar-widget {
        margin: 0;
      }

      .followup-meta {
        margin: 0 0 10px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .followup-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto auto;
        gap: 8px;
        margin-bottom: 10px;
      }

      .followup-form input,
      .followup-form select,
      .followup-form button,
      .followup-toolbar button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 10px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 8px 10px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
      }

      .followup-form button,
      .followup-toolbar button {
        cursor: pointer;
      }

      .followup-toolbar {
        display: inline-flex;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .followup-selected-note {
        margin: 0 0 10px;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.7rem;
      }

      .followup-calendar-panel {
        border: 1px solid rgba(126, 207, 255, 0.22);
        border-radius: 12px;
        background: linear-gradient(160deg, rgba(4, 19, 36, 0.86), rgba(6, 26, 48, 0.76));
        padding: 10px;
        margin: 0 0 10px;
        display: grid;
        gap: 8px;
      }

      .followup-calendar-panel.is-collapsed {
        display: none;
      }

      .followup-calendar-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }

      .followup-calendar-head strong {
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.74rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .followup-calendar-nav {
        display: inline-flex;
        gap: 6px;
      }

      .followup-calendar-nav button {
        border: 1px solid rgba(126, 207, 255, 0.25);
        border-radius: 8px;
        background: rgba(5, 27, 51, 0.75);
        color: var(--text-main);
        padding: 4px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        cursor: pointer;
      }

      .followup-calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 6px;
      }

      .followup-calendar-weekday {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
        text-align: center;
      }

      .followup-calendar-day {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 9px;
        background: rgba(7, 30, 55, 0.72);
        color: var(--text-main);
        min-height: 38px;
        padding: 6px 4px;
        display: grid;
        align-content: start;
        justify-items: center;
        gap: 4px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        cursor: pointer;
      }

      .followup-calendar-day.is-adjacent-month {
        opacity: 0.52;
      }

      .followup-calendar-day.has-tasks {
        border-color: rgba(126, 207, 255, 0.4);
      }

      .followup-calendar-day.is-selected {
        border-color: rgba(133, 220, 255, 0.86);
        box-shadow: inset 0 0 0 1px rgba(133, 220, 255, 0.65), 0 0 0 1px rgba(133, 220, 255, 0.2);
      }

      .followup-calendar-day:focus-visible {
        outline: 2px solid rgba(133, 220, 255, 0.86);
        outline-offset: 1px;
      }

      .followup-calendar-count {
        min-width: 16px;
        height: 16px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        color: #031323;
        background: rgba(126, 207, 255, 0.86);
        font-weight: 700;
        font-size: 0.58rem;
      }

      .followup-columns {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .followup-columns section {
        border: 1px solid rgba(126, 207, 255, 0.18);
        border-radius: 9px;
        background: rgba(5, 22, 41, 0.64);
        padding: 8px;
        display: grid;
        gap: 8px;
      }

      .followup-columns h4 {
        margin: 0;
        color: var(--accent);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .followup-columns ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }

      .followup-task {
        border: 1px solid rgba(126, 207, 255, 0.2);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.6);
        padding: 7px;
        display: grid;
        gap: 6px;
      }

      .followup-task-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .followup-task-head strong {
        font-size: 0.78rem;
      }

      .followup-task-head span {
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.64rem;
        text-transform: uppercase;
        color: var(--text-dim);
      }

      .followup-task.is-high {
        border-color: rgba(255, 165, 165, 0.46);
      }

      .followup-task.is-low {
        border-color: rgba(120, 199, 244, 0.2);
      }

      .followup-task p {
        margin: 0;
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      .followup-task-actions {
        display: inline-flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .followup-task-actions button {
        border: 1px solid rgba(126, 207, 255, 0.28);
        border-radius: 8px;
        background: rgba(4, 21, 40, 0.72);
        color: var(--text-main);
        padding: 5px 8px;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.66rem;
        cursor: pointer;
      }

      .followup-empty {
        color: var(--text-dim);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.68rem;
      }

      @media (max-width: 1100px) {
        .dashboard-grid {
          grid-template-columns: repeat(8, minmax(0, 1fr));
        }

        .widget-board-header {
          flex-direction: column;
        }

        .widget-board-cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 700px) {
        .dashboard-controls {
          flex-direction: column;
          align-items: stretch;
        }

        .dashboard-controls-left,
        .dashboard-controls-right {
          width: 100%;
        }

        .dashboard-grid {
          grid-template-columns: 1fr;
        }

        body.dashboard-edit-mode .dashboard-widget {
          padding: 3px;
        }

        body.dashboard-edit-mode .dashboard-widget-resize {
          display: none;
        }

        .dashboard-modal-row {
          grid-template-columns: 1fr;
        }

        .widget-board-cards {
          grid-template-columns: 1fr;
        }

        .widget-board-add {
          grid-template-columns: 1fr;
        }

        .widget-board-meta {
          grid-template-columns: 1fr;
        }

        .agent-budget-actions {
          grid-template-columns: 1fr;
        }

        .followup-form {
          grid-template-columns: 1fr;
        }

        .api-access-summary {
          grid-template-columns: 1fr;
        }

        .api-access-item {
          flex-direction: column;
        }

        .api-access-item-side {
          justify-items: start;
        }

        .fasthosts-alert-form {
          grid-template-columns: 1fr;
        }

        .server-monitor-toolbar {
          flex-direction: column;
          align-items: stretch;
        }

        .server-monitor-credentials {
          grid-template-columns: 1fr;
        }

        .server-monitor-maintenance {
          grid-template-columns: 1fr;
        }

        .server-monitor-notification-toggles {
          flex-direction: column;
          align-items: flex-start;
        }

        .server-monitor-ssl-item {
          grid-template-columns: 1fr;
        }

        .followup-calendar-head {
          flex-direction: column;
          align-items: stretch;
        }

        .followup-calendar-nav {
          width: 100%;
          justify-content: space-between;
        }

        .followup-columns {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureControls() {
    if (state.ui.controls) return;
    const topbar = document.querySelector("header.topbar");
    if (!topbar) return;

    const controls = document.createElement("div");
    controls.id = "dashboard_controls";
    controls.className = "shell dashboard-controls";
    controls.innerHTML = `
      <div class="dashboard-controls-left">
        <button id="dashboard_edit_toggle" type="button">Edit Dashboard</button>
        <button id="dashboard_add_widgets_btn" type="button" hidden>Add Widgets</button>
        <button id="dashboard_reset_layout_btn" type="button" hidden>Reset Layout</button>
      </div>
      <div class="dashboard-controls-right">
        <label>Role
          <select id="dashboard_role_select">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>User ID
          <input id="dashboard_user_id_input" type="text" placeholder="optional" autocomplete="off" />
        </label>
        <label>
          <input id="dashboard_mobile_drag_toggle" type="checkbox" />
          mobile drag
        </label>
        <span id="dashboard_save_status" class="dashboard-status-note">Layout ready.</span>
      </div>
    `;
    topbar.insertAdjacentElement("afterend", controls);

    state.ui.controls = controls;
    state.ui.editToggle = controls.querySelector("#dashboard_edit_toggle");
    state.ui.addBtn = controls.querySelector("#dashboard_add_widgets_btn");
    state.ui.resetBtn = controls.querySelector("#dashboard_reset_layout_btn");
    state.ui.roleSelect = controls.querySelector("#dashboard_role_select");
    state.ui.userIdInput = controls.querySelector("#dashboard_user_id_input");
    state.ui.mobileDragToggle = controls.querySelector("#dashboard_mobile_drag_toggle");
    state.ui.status = controls.querySelector("#dashboard_save_status");

    state.ui.editToggle?.addEventListener("click", () => {
      setEditMode(!state.editMode);
    });

    state.ui.addBtn?.addEventListener("click", () => {
      openAddWidgetsModal();
    });

    state.ui.resetBtn?.addEventListener("click", () => {
      if (window.confirm("Reset dashboard layout to defaults for this role?")) {
        state.layout = buildDefaultLayout(state.role);
        renderLayout();
        queuePersistLayout(true);
      }
    });

    state.ui.roleSelect?.addEventListener("change", () => {
      const nextRole = normalizeRole(state.ui.roleSelect.value);
      if (nextRole === state.role) return;
      state.role = nextRole;
      storeRole(nextRole);
      void loadLayoutForContext();
    });

    const applyUserId = () => {
      const next = normalizeUserId(state.ui.userIdInput?.value || "");
      if (next === state.userId) return;
      state.userId = next;
      if (state.ui.userIdInput) state.ui.userIdInput.value = next;
      storeUserId(next);
      void loadLayoutForContext();
    };
    state.ui.userIdInput?.addEventListener("change", applyUserId);
    state.ui.userIdInput?.addEventListener("blur", applyUserId);
    state.ui.userIdInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyUserId();
    });

    state.ui.mobileDragToggle?.addEventListener("change", () => {
      state.mobileDragEnabled = Boolean(state.ui.mobileDragToggle?.checked);
      renderLayout();
    });
  }

  function ensureModals() {
    if (state.ui.settingsModal && state.ui.addModal) return;

    const settingsBackdrop = document.createElement("div");
    settingsBackdrop.id = "dashboard_settings_modal";
    settingsBackdrop.className = "dashboard-modal-backdrop";
    settingsBackdrop.innerHTML = `
      <div class="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard_settings_title">
        <h3 id="dashboard_settings_title">Widget Settings</h3>
        <div class="dashboard-modal-grid">
          <p id="dashboard_settings_name" class="dashboard-widget-picker-meta"></p>
          <label>Title Override
            <input id="dashboard_settings_title_input" type="text" maxlength="140" placeholder="Optional title override" autocomplete="off" />
          </label>
          <div class="dashboard-modal-row">
            <label>Size
              <select id="dashboard_settings_size_select">
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>Refresh (sec)
              <input id="dashboard_settings_refresh_input" type="number" min="0" max="86400" step="1" />
            </label>
          </div>
          <div class="dashboard-modal-row">
            <label>Width (grid cols)
              <input id="dashboard_settings_width_input" type="number" min="1" max="12" step="1" />
            </label>
            <label>Height (grid rows)
              <input id="dashboard_settings_height_input" type="number" min="1" max="120" step="1" />
            </label>
          </div>
          <label>
            <input id="dashboard_settings_visible_input" type="checkbox" />
            Visible in view mode
          </label>
          <div class="dashboard-modal-actions">
            <button id="dashboard_settings_save_btn" type="button">Save</button>
            <button id="dashboard_settings_reset_widget_btn" type="button">Reset Widget</button>
            <button id="dashboard_settings_remove_btn" type="button">Remove Widget</button>
            <button id="dashboard_settings_reset_layout_btn" type="button">Reset Dashboard</button>
            <button id="dashboard_settings_close_btn" type="button">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(settingsBackdrop);

    const addBackdrop = document.createElement("div");
    addBackdrop.id = "dashboard_add_modal";
    addBackdrop.className = "dashboard-modal-backdrop";
    addBackdrop.innerHTML = `
      <div class="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard_add_title">
        <h3 id="dashboard_add_title">Add Widgets</h3>
        <div class="dashboard-modal-grid">
          <label>Search
            <input id="dashboard_add_search_input" type="text" placeholder="Search widgets..." autocomplete="off" />
          </label>
          <div id="dashboard_add_widget_list" class="dashboard-widget-picker-list"></div>
          <div class="dashboard-modal-actions">
            <button id="dashboard_add_close_btn" type="button">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(addBackdrop);

    state.ui.settingsModal = settingsBackdrop;
    state.ui.addModal = addBackdrop;
    state.ui.settingsName = settingsBackdrop.querySelector("#dashboard_settings_name");
    state.ui.settingsTitle = settingsBackdrop.querySelector("#dashboard_settings_title_input");
    state.ui.settingsVisible = settingsBackdrop.querySelector("#dashboard_settings_visible_input");
    state.ui.settingsSize = settingsBackdrop.querySelector("#dashboard_settings_size_select");
    state.ui.settingsWidth = settingsBackdrop.querySelector("#dashboard_settings_width_input");
    state.ui.settingsHeight = settingsBackdrop.querySelector("#dashboard_settings_height_input");
    state.ui.settingsRefresh = settingsBackdrop.querySelector("#dashboard_settings_refresh_input");
    state.ui.addSearch = addBackdrop.querySelector("#dashboard_add_search_input");
    state.ui.addList = addBackdrop.querySelector("#dashboard_add_widget_list");

    settingsBackdrop.addEventListener("click", (event) => {
      if (event.target === settingsBackdrop) closeSettingsModal({ applyDraft: true });
    });
    addBackdrop.addEventListener("click", (event) => {
      if (event.target === addBackdrop) closeAddWidgetsModal();
    });

    settingsBackdrop.querySelector("#dashboard_settings_close_btn")?.addEventListener("click", () => {
      closeSettingsModal({ applyDraft: true });
    });
    addBackdrop.querySelector("#dashboard_add_close_btn")?.addEventListener("click", closeAddWidgetsModal);

    settingsBackdrop.querySelector("#dashboard_settings_save_btn")?.addEventListener("click", () => {
      saveSettingsFromModal();
    });

    settingsBackdrop.querySelector("#dashboard_settings_reset_widget_btn")?.addEventListener("click", () => {
      if (!state.activeWidgetId) return;
      if (!window.confirm("Reset this widget to defaults?")) return;
      resetWidgetToDefault(state.activeWidgetId);
      closeSettingsModal();
    });

    settingsBackdrop.querySelector("#dashboard_settings_remove_btn")?.addEventListener("click", () => {
      if (!state.activeWidgetId) return;
      setWidgetEnabled(state.activeWidgetId, false);
      closeSettingsModal();
    });

    settingsBackdrop.querySelector("#dashboard_settings_reset_layout_btn")?.addEventListener("click", () => {
      if (!window.confirm("Reset dashboard layout to default for this role?")) return;
      state.layout = buildDefaultLayout(state.role);
      renderLayout();
      queuePersistLayout(true);
      closeSettingsModal({ applyDraft: false });
    });

    const liveSettingsApply = () => {
      void applySettingsDraft({ immediate: false, source: "live-input" });
    };
    state.ui.settingsTitle?.addEventListener("input", liveSettingsApply);
    state.ui.settingsVisible?.addEventListener("change", liveSettingsApply);
    state.ui.settingsSize?.addEventListener("change", liveSettingsApply);
    state.ui.settingsWidth?.addEventListener("input", liveSettingsApply);
    state.ui.settingsHeight?.addEventListener("input", liveSettingsApply);
    state.ui.settingsRefresh?.addEventListener("input", liveSettingsApply);

    state.ui.addSearch?.addEventListener("input", renderAddWidgetList);
  }

  function closeSettingsModal(options = {}) {
    if (options.applyDraft) {
      void applySettingsDraft({ immediate: true, source: "close-modal" });
    }
    state.activeWidgetId = "";
    state.ui.settingsModal?.classList.remove("open");
  }

  function closeAddWidgetsModal() {
    state.ui.addModal?.classList.remove("open");
  }

  function openAddWidgetsModal() {
    renderAddWidgetList();
    state.ui.addModal?.classList.add("open");
    try {
      state.ui.addSearch?.focus();
    } catch {
      // ignore
    }
  }

  function widgetRecordById(widgetId) {
    if (!state.layout || !Array.isArray(state.layout.widgets)) return null;
    return state.layout.widgets.find((item) => item.id === widgetId) || null;
  }

  function ensureWidgetRecord(widgetId) {
    if (!state.layout) return null;
    let existing = widgetRecordById(widgetId);
    if (existing) return existing;
    const def = REGISTRY_BY_ID.get(widgetId);
    if (!def) return null;
    const next = defaultWidgetRecord(def, state.layout.widgets.length, state.role);
    next.enabled = false;
    state.layout.widgets.push(next);
    return next;
  }

  function isWidgetRenderable(widgetId) {
    return state.shells.has(widgetId);
  }

  function setWidgetEnabled(widgetId, enabled) {
    const record = ensureWidgetRecord(widgetId);
    if (!record) return;
    const nextEnabled = Boolean(enabled);
    if (nextEnabled && !isWidgetRenderable(widgetId)) {
      ensureGrid();
    }
    if (nextEnabled && !isWidgetRenderable(widgetId)) {
      record.enabled = false;
      debugLog("widget-enable-blocked", { widgetId, reason: "component-missing" });
      setStatus(`Widget unavailable in this view: ${widgetId}.`, true);
      renderAddWidgetList();
      return;
    }
    record.enabled = nextEnabled;
    if (record.enabled) {
      record.settings = record.settings || {};
      record.settings.visible = true;
      state.layout.widgets = [
        ...state.layout.widgets.filter((item) => item.id !== widgetId),
        record
      ];
    }
    state.layout.widgets = normalizeWidgetOrder(state.layout.widgets);
    touchLayout(state.layout);
    renderLayout();
    queuePersistLayout(true);
    debugLog("widget-enabled", { widgetId, enabled: record.enabled });
    renderAddWidgetList();
  }

  function resetWidgetToDefault(widgetId) {
    if (!state.layout) return;
    const idx = state.layout.widgets.findIndex((item) => item.id === widgetId);
    const def = REGISTRY_BY_ID.get(widgetId);
    if (!def || idx < 0) return;
    const current = state.layout.widgets[idx];
    const next = defaultWidgetRecord(def, idx, state.role);
    next.enabled = Boolean(current.enabled);
    state.layout.widgets[idx] = next;
    state.layout.widgets = normalizeWidgetOrder(state.layout.widgets);
    touchLayout(state.layout);
    renderLayout();
    queuePersistLayout(true);
    debugLog("widget-reset", { widgetId });
  }

  function updateControlState() {
    if (!state.ui.editToggle) return;
    state.ui.editToggle.textContent = state.editMode ? "Exit Edit" : "Edit Dashboard";
    if (state.ui.addBtn) state.ui.addBtn.hidden = !state.editMode;
    if (state.ui.resetBtn) state.ui.resetBtn.hidden = !state.editMode;
    if (state.ui.roleSelect) state.ui.roleSelect.value = state.role;
    if (state.ui.userIdInput) state.ui.userIdInput.value = state.userId;
    if (state.ui.mobileDragToggle) state.ui.mobileDragToggle.checked = state.mobileDragEnabled;
  }

  function setEditMode(next) {
    state.editMode = Boolean(next);
    if (!state.editMode) {
      stopPointerDrag();
      stopResize();
    }
    document.body.classList.toggle("dashboard-edit-mode", state.editMode);
    updateControlState();
    renderLayout();
  }

  function shellHeadingNode(componentNode) {
    if (!componentNode || typeof componentNode.querySelector !== "function") return null;
    return componentNode.querySelector("h3, h2, h1");
  }

  function createWidgetShell(widgetDef, componentNode) {
    const shell = document.createElement("section");
    shell.className = "dashboard-widget";
    shell.dataset.widgetId = widgetDef.id;
    shell.innerHTML = `
      <div class="dashboard-widget-toolbar">
        <button type="button" class="dashboard-widget-drag" title="Drag widget">Drag</button>
        <button type="button" class="dashboard-widget-settings" title="Widget settings">⚙ Settings</button>
        <button type="button" class="dashboard-widget-remove" title="Remove widget">✖ Remove</button>
      </div>
      <div class="dashboard-widget-title"></div>
      <div class="dashboard-widget-error"></div>
      <div class="dashboard-widget-hidden-note">Hidden in view mode.</div>
      <div class="dashboard-widget-content"></div>
      <button type="button" class="dashboard-widget-resize" title="Resize widget" aria-label="Resize widget"></button>
    `;
    const contentWrap = shell.querySelector(".dashboard-widget-content");

    const shellObj = {
      id: widgetDef.id,
      def: widgetDef,
      shell,
      component: componentNode,
      content: contentWrap,
      toolbar: shell.querySelector(".dashboard-widget-toolbar"),
      title: shell.querySelector(".dashboard-widget-title"),
      error: shell.querySelector(".dashboard-widget-error"),
      resize: shell.querySelector(".dashboard-widget-resize"),
      settingsBtn: shell.querySelector(".dashboard-widget-settings"),
      removeBtn: shell.querySelector(".dashboard-widget-remove"),
      dragBtn: shell.querySelector(".dashboard-widget-drag"),
      heading: shellHeadingNode(componentNode),
      headingOriginal: ""
    };

    if (shellObj.heading) {
      shellObj.headingOriginal = String(shellObj.heading.textContent || "");
    }

    wireShellEvents(shellObj);
    return shellObj;
  }

  function clearDropMarkers() {
    for (const shellObj of state.shells.values()) {
      shellObj.shell.classList.remove("drop-before", "drop-after");
    }
  }

  function reorderEnabledWidgets(dragId, targetId, before) {
    if (!state.layout) return false;
    const drag = String(dragId || "").trim();
    const target = String(targetId || "").trim();
    if (!drag || !target || drag === target) return false;

    const enabled = state.layout.widgets.filter((item) => item.enabled);
    const disabled = state.layout.widgets.filter((item) => !item.enabled);
    const fromIdx = enabled.findIndex((item) => item.id === drag);
    const toIdx = enabled.findIndex((item) => item.id === target);
    if (fromIdx < 0 || toIdx < 0) return false;

    const [dragged] = enabled.splice(fromIdx, 1);
    let insertAt = enabled.findIndex((item) => item.id === target);
    if (insertAt < 0) return false;
    if (!before) insertAt += 1;
    enabled.splice(insertAt, 0, dragged);

    state.layout.widgets = normalizeWidgetOrder([...enabled, ...disabled]);
    touchLayout(state.layout);
    debugLog("widget-reordered", { dragId: drag, targetId: target, before: Boolean(before) });
    return true;
  }

  function dragPointerClient(event) {
    if (event?.touches?.[0]) {
      return { x: Number(event.touches[0].clientX || 0), y: Number(event.touches[0].clientY || 0) };
    }
    if (event?.changedTouches?.[0]) {
      return { x: Number(event.changedTouches[0].clientX || 0), y: Number(event.changedTouches[0].clientY || 0) };
    }
    return { x: Number(event?.clientX || 0), y: Number(event?.clientY || 0) };
  }

  function nearestDropTarget(x, y) {
    if (!state.grid) return null;
    const gridRect = state.grid.getBoundingClientRect();
    if (
      x < gridRect.left - 48 ||
      x > gridRect.right + 48 ||
      y < gridRect.top - 80 ||
      y > gridRect.bottom + 80
    ) {
      return null;
    }

    let best = null;
    for (const shellObj of state.shells.values()) {
      const shell = shellObj?.shell;
      if (!shell || shell.hidden || shell.parentNode !== state.grid) continue;
      const widgetId = String(shell.dataset.widgetId || "").trim();
      if (!widgetId || widgetId === state.pointerDrag?.widgetId) continue;
      const rect = shell.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const distance = Math.abs(y - midY);
      if (!best || distance < best.distance) {
        best = { widgetId, shell, rect, distance };
      }
    }
    if (!best) return null;
    return {
      widgetId: best.widgetId,
      shell: best.shell,
      before: y < best.rect.top + best.rect.height / 2
    };
  }

  function dragTargetFromPoint(x, y) {
    if (!state.grid) return null;
    const el = document.elementFromPoint(x, y);
    const shell = el && typeof el.closest === "function" ? el.closest(".dashboard-widget[data-widget-id]") : null;
    if (shell && shell.parentNode === state.grid) {
      const widgetId = String(shell.dataset.widgetId || "").trim();
      if (widgetId && widgetId !== state.pointerDrag?.widgetId) {
        const rect = shell.getBoundingClientRect();
        const before = y < rect.top + rect.height / 2;
        return { widgetId, before, shell };
      }
    }
    return nearestDropTarget(x, y);
  }

  function onPointerDragMove(event) {
    if (!state.pointerDrag) return;
    if (event?.cancelable) event.preventDefault();
    const point = dragPointerClient(event);
    const target = dragTargetFromPoint(point.x, point.y);
    clearDropMarkers();
    if (!target) {
      state.pointerDrag.targetId = "";
      return;
    }
    state.pointerDrag.targetId = target.widgetId;
    state.pointerDrag.before = target.before;
    target.shell.classList.toggle("drop-before", target.before);
    target.shell.classList.toggle("drop-after", !target.before);
  }

  function stopPointerDrag() {
    const session = state.pointerDrag;
    if (!session) return;
    state.pointerDrag = null;
    window.removeEventListener("pointermove", onPointerDragMove);
    window.removeEventListener("pointerup", stopPointerDrag);
    window.removeEventListener("pointercancel", stopPointerDrag);
    window.removeEventListener("mousemove", onPointerDragMove);
    window.removeEventListener("mouseup", stopPointerDrag);
    window.removeEventListener("touchmove", onPointerDragMove);
    window.removeEventListener("touchend", stopPointerDrag);
    window.removeEventListener("touchcancel", stopPointerDrag);
    document.body.classList.remove("dashboard-dragging");

    const sourceShell = state.shells.get(session.widgetId);
    sourceShell?.shell?.classList.remove("is-dragging");
    clearDropMarkers();
    if (!session.targetId) return;

    const changed = reorderEnabledWidgets(session.widgetId, session.targetId, session.before);
    if (!changed) return;
    renderLayout();
    queuePersistLayout(true);
  }

  function startPointerDrag(event, widgetId) {
    if (state.pointerDrag) return;
    if (!state.editMode) return;
    if (isMobileLayout()) {
      const uiToggleValue = Boolean(state.ui.mobileDragToggle?.checked);
      if (uiToggleValue !== state.mobileDragEnabled) state.mobileDragEnabled = uiToggleValue;
      if (!state.mobileDragEnabled) return;
    }
    if (event?.type === "mousedown" && typeof event.button === "number" && event.button !== 0) return;
    const shellObj = state.shells.get(widgetId);
    if (!shellObj) return;
    // Root-cause note: HTML5 drag/drop was unreliable here due nested content/overlays.
    // Use pointer-tracked drag from the explicit handle so drop targeting stays deterministic.
    event.preventDefault();
    event.stopPropagation();

    state.pointerDrag = {
      widgetId,
      targetId: "",
      before: true
    };
    shellObj.shell.classList.add("is-dragging");
    document.body.classList.add("dashboard-dragging");
    window.addEventListener("pointermove", onPointerDragMove);
    window.addEventListener("pointerup", stopPointerDrag);
    window.addEventListener("pointercancel", stopPointerDrag);
    window.addEventListener("mousemove", onPointerDragMove);
    window.addEventListener("mouseup", stopPointerDrag);
    window.addEventListener("touchmove", onPointerDragMove, { passive: false });
    window.addEventListener("touchend", stopPointerDrag);
    window.addEventListener("touchcancel", stopPointerDrag);
  }

  function wireShellEvents(shellObj) {
    shellObj.settingsBtn?.addEventListener("click", () => openSettingsModal(shellObj.id));
    shellObj.removeBtn?.addEventListener("click", () => {
      setWidgetEnabled(shellObj.id, false);
    });

    shellObj.resize?.addEventListener("pointerdown", (event) => {
      startResize(event, shellObj.id);
    });
    shellObj.resize?.addEventListener("mousedown", (event) => {
      startResize(event, shellObj.id);
    });
    shellObj.resize?.addEventListener("touchstart", (event) => {
      startResize(event, shellObj.id);
    }, { passive: false });

    shellObj.dragBtn?.addEventListener("pointerdown", (event) => {
      startPointerDrag(event, shellObj.id);
    });
    shellObj.dragBtn?.addEventListener("mousedown", (event) => {
      startPointerDrag(event, shellObj.id);
    });
    shellObj.dragBtn?.addEventListener("touchstart", (event) => {
      startPointerDrag(event, shellObj.id);
    }, { passive: false });
  }

  function ensureGrid() {
    const root = selectDashboardRoot();
    if (!root) return false;
    state.root = root;

    const nodes = [];
    for (const def of WIDGET_REGISTRY) {
      const existingShell = state.shells.get(def.id);
      let node = existingShell?.component || null;
      if (!node) {
        node = safeQuery(root, def.componentSelector) || safeQuery(document, def.componentSelector);
      }
      if (!node && String(def?.source || "") === "engine_tool") {
        node = ensureEngineToolComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "welcome_board") {
        node = ensureWelcomeBoardComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "api_usage") {
        node = ensureApiUsageComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "fasthosts") {
        node = ensureFasthostsComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "server_monitor_plesk") {
        node = ensureServerMonitorComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "agent_budget") {
        node = ensureAgentBudgetComponentNode(root, def);
      }
      if (!node && String(def?.source || "") === "followup_calendar") {
        node = ensureFollowupCalendarComponentNode(root, def);
      }
      if (node && String(def?.source || "") === "engine_tool") {
        renderEngineToolComponent(node, def);
      }
      if (node && String(def?.source || "") === "welcome_board") {
        renderWelcomeBoardComponent(node, def);
      }
      if (node && String(def?.source || "") === "api_usage") {
        renderApiUsageComponent(node, def);
      }
      if (node && String(def?.source || "") === "fasthosts") {
        renderFasthostsComponent(node, def);
      }
      if (node && String(def?.source || "") === "server_monitor_plesk") {
        renderServerMonitorComponent(node, def);
      }
      if (node && String(def?.source || "") === "agent_budget") {
        renderAgentBudgetComponent(node, def);
      }
      if (node && String(def?.source || "") === "followup_calendar") {
        renderFollowupCalendarComponent(node, def);
      }
      if (!node) continue;
      nodes.push({ def, node });
    }
    if (!nodes.length && state.grid && state.shells.size) return true;
    if (!nodes.length) return false;

    let grid = state.grid || document.getElementById("dashboard_grid");
    if (!grid) {
      grid = document.createElement("div");
      grid.id = "dashboard_grid";
      grid.className = "dashboard-grid";
      const anchor = nodes[0].node;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(grid, anchor);
      else root.appendChild(grid);
    }
    state.grid = grid;

    for (const item of nodes) {
      const existing = state.shells.get(item.def.id);
      if (existing) {
        existing.def = item.def;
        existing.component = item.node;
        existing.heading = shellHeadingNode(item.node);
        if (
          existing.heading &&
          (
            !existing.headingOriginal ||
            ["engine_tool", "agent_budget", "followup_calendar"].includes(String(item.def?.source || ""))
          )
        ) {
          existing.headingOriginal = String(existing.heading.textContent || "");
        }
        continue;
      }
      const shellObj = createWidgetShell(item.def, item.node);
      state.shells.set(item.def.id, shellObj);
    }
    if ((!state.layout || !Array.isArray(state.layout.widgets)) && state.shells.size > 0 && state.grid) {
      state.layout = buildDefaultLayout(state.role);
      const enabledIds = new Set(
        (state.layout.widgets || [])
          .filter((item) => item && item.enabled)
          .map((item) => item.id)
      );
      for (const def of WIDGET_REGISTRY) {
        const shellObj = state.shells.get(def.id);
        if (!shellObj) continue;
        const shouldShow = enabledIds.has(def.id);
        shellObj.shell.hidden = !shouldShow;
        if (shouldShow && shellObj.shell.parentNode !== state.grid) {
          state.grid.appendChild(shellObj.shell);
        }
      }
    }
    return true;
  }

  function stopGridBootstrap() {
    if (!state.gridBootstrapTimer) return;
    clearTimeout(state.gridBootstrapTimer);
    state.gridBootstrapTimer = null;
  }

  function bootstrapGridWithRetry(onReady, source) {
    if (ensureGrid()) {
      stopGridBootstrap();
      state.gridBootstrapAttempts = 0;
      if (typeof onReady === "function") onReady();
      return true;
    }
    stopGridBootstrap();
    state.gridBootstrapAttempts += 1;
    const attempt = state.gridBootstrapAttempts;
    const maxAttempts = 40;
    debugLog("grid-bootstrap-wait", { source: String(source || "unknown"), attempt, maxAttempts });
    setStatus("Waiting for dashboard widget targets...", true);
    if (attempt >= maxAttempts) {
      setStatus("Dashboard widgets unavailable on this view.", true);
      return false;
    }
    state.gridBootstrapTimer = window.setTimeout(() => {
      state.gridBootstrapTimer = null;
      bootstrapGridWithRetry(onReady, "retry");
    }, 150);
    return false;
  }

  function initializeContextIfNeeded() {
    if (state.didInitContext) return;
    state.didInitContext = true;
    state.role = loadStoredRole();
    state.userId = inferUserId();
    if (state.ui.roleSelect) state.ui.roleSelect.value = state.role;
    if (state.ui.userIdInput) state.ui.userIdInput.value = state.userId;
    updateControlState();

    const connectedWidgetComponent = (widgetId, def) => {
      const shellObj = state.shells.get(widgetId);
      if (shellObj?.component?.isConnected) return shellObj.component;
      const node = safeQuery(document, def.componentSelector);
      return node?.isConnected ? node : null;
    };

    window.addEventListener("resize", onWindowResize);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeSettingsModal({ applyDraft: true });
      closeAddWidgetsModal();
    });
    window.addEventListener(ENGINE_TOOL_WIDGET_EVENT, handleEngineToolRegistryUpdate);
    window.addEventListener(API_USAGE_WIDGET_EVENT, () => {
      const def = REGISTRY_BY_ID.get(API_USAGE_WIDGET_ID);
      if (!def) return;
      const node = connectedWidgetComponent(API_USAGE_WIDGET_ID, def);
      if (!node) return;
      renderApiUsageComponent(node, def);
    });
    window.addEventListener(VAULT_STATUS_EVENT, () => {
      const def = REGISTRY_BY_ID.get(API_USAGE_WIDGET_ID);
      if (!def) return;
      const node = connectedWidgetComponent(API_USAGE_WIDGET_ID, def);
      if (!node) return;
      renderApiUsageComponent(node, def);
    });
    window.addEventListener(AGENT_BUDGET_WIDGET_EVENT, () => {
      const def = REGISTRY_BY_ID.get(AGENT_BUDGET_WIDGET_ID);
      if (!def) return;
      const node = connectedWidgetComponent(AGENT_BUDGET_WIDGET_ID, def);
      if (!node) return;
      renderAgentBudgetComponent(node, def);
    });
    window.addEventListener(FOLLOWUP_CALENDAR_WIDGET_EVENT, () => {
      const def = REGISTRY_BY_ID.get(FOLLOWUP_CALENDAR_WIDGET_ID);
      if (!def) return;
      const node = connectedWidgetComponent(FOLLOWUP_CALENDAR_WIDGET_ID, def);
      if (!node) return;
      renderFollowupCalendarComponent(node, def);
    });
    window.addEventListener("storage", (event) => {
      if (!event) return;
      if (event.key === ENGINE_TOOL_WIDGET_KEY) {
        handleEngineToolRegistryUpdate({ detail: { autoEnable: false } });
        return;
      }
      if (event.key === API_USAGE_WIDGET_KEY) {
        const def = REGISTRY_BY_ID.get(API_USAGE_WIDGET_ID);
        if (!def) return;
        const node = connectedWidgetComponent(API_USAGE_WIDGET_ID, def);
        if (!node) return;
        renderApiUsageComponent(node, def);
        return;
      }
      if (event.key === API_MARKETPLACE_LAST_OPEN_KEY) {
        const def = REGISTRY_BY_ID.get(API_USAGE_WIDGET_ID);
        if (!def) return;
        const node = connectedWidgetComponent(API_USAGE_WIDGET_ID, def);
        if (!node) return;
        renderApiUsageComponent(node, def);
        return;
      }
      if (event.key === AGENT_BUDGET_WIDGET_KEY) {
        const def = REGISTRY_BY_ID.get(AGENT_BUDGET_WIDGET_ID);
        if (!def) return;
        const node = connectedWidgetComponent(AGENT_BUDGET_WIDGET_ID, def);
        if (!node) return;
        renderAgentBudgetComponent(node, def);
        return;
      }
      if (event.key === FOLLOWUP_CALENDAR_WIDGET_KEY) {
        const def = REGISTRY_BY_ID.get(FOLLOWUP_CALENDAR_WIDGET_ID);
        if (!def) return;
        const node = connectedWidgetComponent(FOLLOWUP_CALENDAR_WIDGET_ID, def);
        if (!node) return;
        renderFollowupCalendarComponent(node, def);
      }
    });

    void loadLayoutForContext();
  }

  function getWidgetDisplayTitle(shellObj, record) {
    const override = String(record?.settings?.title || "").trim();
    if (override) return override;
    if (shellObj?.headingOriginal) return shellObj.headingOriginal;
    return shellObj?.def?.name || shellObj?.id || "Widget";
  }

  function applyTitleOverride(shellObj, record) {
    if (!shellObj?.heading) return;
    const override = String(record?.settings?.title || "").trim();
    const nextText = override || shellObj.headingOriginal;
    shellObj.heading.textContent = nextText;
  }

  function applyWidgetGeometry(shellObj, record) {
    const cols = currentColumnCount();
    const mobile = cols === 1;
    const minW = mobile ? 1 : Math.max(1, Number(shellObj?.def?.constraints?.minW || 1));
    const maxW = mobile
      ? 1
      : Math.max(minW, Math.min(cols, Number(shellObj?.def?.constraints?.maxW || cols)));
    const minH = Math.max(1, Number(shellObj?.def?.constraints?.minH || 1));
    const maxH = Math.max(minH, Number(shellObj?.def?.constraints?.maxH || 96));
    record.w = clampInt(record.w, minW, maxW);
    record.h = clampInt(record.h, minH, maxH);
    shellObj.shell.style.gridColumn = mobile ? "1 / -1" : `span ${record.w}`;
    shellObj.shell.style.setProperty("--widget-min-height", state.editMode ? `${record.h * 20}px` : "0px");
  }

  function renderWidgetError(shellObj, err) {
    shellObj.shell.classList.add("has-error");
    if (shellObj.error) {
      shellObj.error.textContent = `Widget error: ${String(err?.message || err || "Unknown error")}`;
    }
  }

  function clearWidgetError(shellObj) {
    shellObj.shell.classList.remove("has-error");
    if (shellObj.error) shellObj.error.textContent = "";
  }

  function renderLayout() {
    if (!state.layout || !state.grid) return;
    const byId = new Map(state.layout.widgets.map((item) => [item.id, item]));
    const enabled = [];
    const disabledIds = new Set();
    let availabilityChanged = false;
    const hasRenderableShells = state.shells.size > 0;

    for (const item of state.layout.widgets) {
      const def = REGISTRY_BY_ID.get(item.id);
      if (!def || !isRoleAllowed(def, state.role)) continue;
      if (item.enabled) {
        if (!isWidgetRenderable(item.id)) {
          if (!hasRenderableShells) {
            enabled.push(item);
            continue;
          }
          item.enabled = false;
          availabilityChanged = true;
          disabledIds.add(item.id);
          continue;
        }
        enabled.push(item);
        continue;
      }
      disabledIds.add(item.id);
    }

    enabled.sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
    state.layout.widgets = normalizeWidgetOrder([
      ...enabled,
      ...state.layout.widgets.filter((item) => disabledIds.has(item.id))
    ]);

    const enabledSet = new Set(enabled.map((item) => item.id));
    for (const item of enabled) {
      const shellObj = state.shells.get(item.id);
      if (!shellObj) continue;
      try {
        if (shellObj.content && shellObj.component && shellObj.component.parentNode !== shellObj.content) {
          shellObj.content.appendChild(shellObj.component);
        }
        clearWidgetError(shellObj);
        applyWidgetGeometry(shellObj, item);
        applyTitleOverride(shellObj, item);
        const title = getWidgetDisplayTitle(shellObj, item);
        if (shellObj.title) shellObj.title.textContent = title;
        shellObj.shell.classList.toggle("is-hidden", item.settings?.visible === false);
        const shouldShow = item.settings?.visible !== false || state.editMode;
        shellObj.shell.hidden = !shouldShow;
        shellObj.shell.draggable = false;
        state.grid.appendChild(shellObj.shell);
      } catch (err) {
        renderWidgetError(shellObj, err);
      }
    }

    for (const [id, shellObj] of state.shells.entries()) {
      if (enabledSet.has(id)) continue;
      shellObj.shell.hidden = true;
      if (shellObj.shell.parentNode === state.grid) shellObj.shell.remove();
    }

    if (availabilityChanged) {
      touchLayout(state.layout);
      queuePersistLayout();
      setStatus("Unavailable widgets were disabled for this page.", true);
    } else if (!hasRenderableShells) {
      bootstrapGridWithRetry(() => { renderLayout(); }, "render-layout");
      setStatus("Waiting for dashboard widget targets...", true);
    }

    updateControlState();
    renderAddWidgetList();
  }

  function queuePersistLayout(immediate) {
    if (!state.layout) return;
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    if (immediate) {
      void persistLayout();
      return;
    }
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      void persistLayout();
    }, 220);
  }

  async function persistLayout() {
    if (!state.layout) return;
    touchLayout(state.layout);
    const snapshot = cloneLayout({
      ...state.layout,
      version: DASHBOARD_LAYOUT_VERSION,
      role: state.role
    });
    if (!snapshot) return;

    const stamp = Date.now();
    state.saveStamp = stamp;
    saveLocalLayout(snapshot, state.role, state.userId);
    setStatus("Saving layout...", false);
    const remoteOk = await saveServerLayout(snapshot, state.role, state.userId);
    if (state.saveStamp !== stamp) return;
    debugLog("layout-save", {
      role: state.role,
      userId: state.userId,
      updatedAt: snapshot.updatedAt,
      remoteOk
    });
    setStatus(remoteOk ? "Layout saved (local + server)." : "Layout saved locally.", !remoteOk);
  }

  async function loadLayoutForContext() {
    if (!ensureGrid()) {
      bootstrapGridWithRetry(() => { void loadLayoutForContext(); }, "load-layout");
      return;
    }
    const token = ++state.layoutLoadToken;
    const role = state.role;
    const userId = state.userId;
    const starterPending = shouldApplyStarterLayout(role, userId);

    setStatus("Loading layout...", false);
    const localRaw = loadLocalLayout(role, userId);
    const localLayout = recoverEmptyLayout(migrateLayout(localRaw, role), role, userId);
    if (starterPending && applyStarterLayoutSnapshot(localLayout, role)) {
      saveLocalLayout(localLayout, role, userId);
      void saveServerLayout(localLayout, role, userId);
    }
    state.layout = localLayout;
    renderLayout();

    const remote = await fetchServerLayout(role, userId);
    if (token !== state.layoutLoadToken) return;
    if (remote && typeof remote === "object") {
      const remoteLayout = recoverEmptyLayout(migrateLayout(remote, role), role, userId);
      if (starterPending) applyStarterLayoutSnapshot(remoteLayout, role);
      const localStamp = Math.max(0, Number(localLayout?.updatedAt || 0));
      const remoteStamp = Math.max(0, Number(remoteLayout?.updatedAt || 0));
      if (remoteStamp > localStamp) {
        state.layout = remoteLayout;
        saveLocalLayout(state.layout, role, userId);
        if (starterPending) markStarterLayoutApplied(role, userId);
        renderLayout();
        debugLog("layout-load", { source: "server", role, userId, updatedAt: remoteStamp });
        setStatus("Layout loaded (server sync).", false);
        return;
      }
      // Root-cause note: prefer newer local layout when remote data is stale,
      // otherwise server defaults can overwrite recently changed widget settings.
      debugLog("layout-load", {
        source: "local-preferred",
        role,
        userId,
        localUpdatedAt: localStamp,
        remoteUpdatedAt: remoteStamp
      });
      if (localStamp > remoteStamp && state.layout) {
        void saveServerLayout(state.layout, role, userId);
      }
      if (starterPending) markStarterLayoutApplied(role, userId);
      setStatus("Layout loaded (local, newer than server).", false);
      return;
    }
    if (starterPending) markStarterLayoutApplied(role, userId);
    setStatus("Layout loaded (local).", false);
  }

  function openSettingsModal(widgetId) {
    const record = widgetRecordById(widgetId);
    const shellObj = state.shells.get(widgetId);
    if (!record || !shellObj || !state.ui.settingsModal) return;
    state.activeWidgetId = widgetId;

    const titleValue = String(record?.settings?.title || "");
    const sizeValue = String(record?.settings?.size || "custom").toLowerCase();
    const visibleValue = record?.settings?.visible !== false;
    const refreshValue = Math.max(0, clampInt(record?.settings?.refreshSec, 0, 86400));
    const displayName = `${shellObj.def.name} (${widgetId})`;

    if (state.ui.settingsName) state.ui.settingsName.textContent = displayName;
    if (state.ui.settingsTitle) state.ui.settingsTitle.value = titleValue;
    if (state.ui.settingsVisible) state.ui.settingsVisible.checked = visibleValue;
    if (state.ui.settingsSize) state.ui.settingsSize.value = ["small", "medium", "large", "custom"].includes(sizeValue) ? sizeValue : "custom";
    if (state.ui.settingsWidth) state.ui.settingsWidth.value = String(record.w);
    if (state.ui.settingsHeight) state.ui.settingsHeight.value = String(record.h);
    if (state.ui.settingsRefresh) state.ui.settingsRefresh.value = String(refreshValue);

    state.ui.settingsModal.classList.add("open");
  }

  function applySettingsDraft(options = {}) {
    if (!state.activeWidgetId) return false;
    const record = widgetRecordById(state.activeWidgetId);
    const def = REGISTRY_BY_ID.get(state.activeWidgetId);
    if (!record || !def) {
      console.warn("[dashboard] settings draft target missing", { widgetId: state.activeWidgetId });
      return false;
    }
    console.assert(record.id === state.activeWidgetId, "[dashboard] settings target mismatch", {
      expected: state.activeWidgetId,
      actual: record.id
    });

    const before = JSON.stringify({
      w: record.w,
      h: record.h,
      settings: record.settings || {}
    });

    const size = String(state.ui.settingsSize?.value || "custom").toLowerCase();
    const colsForPreset = 12;
    const nextTitle = String(state.ui.settingsTitle?.value || "").trim().slice(0, 140);
    const nextVisible = Boolean(state.ui.settingsVisible?.checked);
    const nextRefresh = Math.max(0, clampInt(state.ui.settingsRefresh?.value, 0, 86400));
    const nextWidthRaw = clampInt(state.ui.settingsWidth?.value, 1, 12);
    const nextHeightRaw = clampInt(
      state.ui.settingsHeight?.value,
      Math.max(1, Number(def?.constraints?.minH || 1)),
      Math.max(1, Number(def?.constraints?.maxH || 96))
    );

    record.settings = record.settings || {};
    record.settings.title = nextTitle;
    record.settings.visible = nextVisible;
    record.settings.refreshSec = nextRefresh;
    record.settings.size = ["small", "medium", "large", "custom"].includes(size) ? size : "custom";

    if (record.settings.size === "small" || record.settings.size === "medium" || record.settings.size === "large") {
      record.w = presetWidthForSize(record.settings.size, colsForPreset);
      const defaultH = Math.max(1, Number(def?.defaultProps?.defaultH || 10));
      if (record.settings.size === "small") record.h = Math.max(1, Math.round(defaultH * 0.8));
      else if (record.settings.size === "medium") record.h = Math.max(1, Math.round(defaultH * 0.92));
      else record.h = defaultH;
    } else {
      record.w = nextWidthRaw;
      record.h = nextHeightRaw;
    }

    const minW = Math.max(1, Number(def?.constraints?.minW || 1));
    const maxW = Math.max(minW, Number(def?.constraints?.maxW || 12));
    record.w = Math.max(minW, Math.min(maxW, record.w));
    const minH = Math.max(1, Number(def?.constraints?.minH || 1));
    const maxH = Math.max(minH, Number(def?.constraints?.maxH || 96));
    record.h = Math.max(minH, Math.min(maxH, record.h));

    const after = JSON.stringify({
      w: record.w,
      h: record.h,
      settings: record.settings || {}
    });
    const changed = before !== after;
    if (!changed) return false;

    // Root-cause note: persist settings directly from modal controls into layout model,
    // then persist layout; avoids stale defaults overriding unsaved widget settings.
    touchLayout(state.layout);
    renderLayout();
    queuePersistLayout(Boolean(options.immediate));
    debugLog("settings-updated", {
      source: String(options.source || "unknown"),
      widgetId: state.activeWidgetId,
      settings: record.settings,
      w: record.w,
      h: record.h
    });
    return true;
  }

  function saveSettingsFromModal() {
    void applySettingsDraft({ immediate: true, source: "save-button" });
    closeSettingsModal({ applyDraft: false });
  }

  function renderAddWidgetList() {
    if (!state.ui.addList) return;
    if (!state.shells.size) ensureGrid();
    const query = String(state.ui.addSearch?.value || "").trim().toLowerCase();
    const role = state.role;

    const rows = WIDGET_REGISTRY
      .filter((item) => isRoleAllowed(item, role))
      .filter((item) => {
        if (!query) return true;
        const hay = `${item.name} ${item.description} ${item.id}`.toLowerCase();
        return hay.includes(query);
      });

    if (!rows.length) {
      state.ui.addList.innerHTML = `<p class="dashboard-widget-picker-meta">No widgets match this filter.</p>`;
      return;
    }

    state.ui.addList.innerHTML = rows
      .map((item) => {
        const record = widgetRecordById(item.id);
        const enabled = Boolean(record?.enabled);
        const renderable = isWidgetRenderable(item.id);
        const blocked = !enabled && !renderable;
        const actionLabel = enabled ? "Remove" : "Add";
        const actionTitle = blocked
          ? `Unavailable in this view (${String(item.componentSelector || "selector")})`
          : `${actionLabel} widget`;
        const availabilityTag = blocked ? " | unavailable in this view" : "";
        return `
          <article class="dashboard-widget-picker-item">
            <div class="dashboard-widget-picker-head">
              <strong>${escapeHtml(item.name)}</strong>
              <button type="button" data-dashboard-widget-toggle="${escapeHtml(item.id)}" title="${escapeHtml(actionTitle)}" ${blocked ? "disabled" : ""}>${actionLabel}</button>
            </div>
            <p class="dashboard-widget-picker-meta">${escapeHtml(item.description)}</p>
            <p class="dashboard-widget-picker-meta">id: ${escapeHtml(item.id)} | default: ${escapeHtml(String(item.defaultSize || "large"))}${escapeHtml(availabilityTag)}</p>
          </article>
        `;
      })
      .join("");

    state.ui.addList.querySelectorAll("button[data-dashboard-widget-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const widgetId = String(btn.getAttribute("data-dashboard-widget-toggle") || "").trim();
        if (!widgetId) return;
        const record = widgetRecordById(widgetId);
        const enabled = Boolean(record?.enabled);
        setWidgetEnabled(widgetId, !enabled);
      });
    });
  }

  function startResize(event, widgetId) {
    if (state.resizeSession) return;
    if (!state.editMode) return;
    if (isMobileLayout()) {
      const uiToggleValue = Boolean(state.ui.mobileDragToggle?.checked);
      if (uiToggleValue !== state.mobileDragEnabled) state.mobileDragEnabled = uiToggleValue;
      if (!state.mobileDragEnabled) return;
    }
    if (event?.type === "mousedown" && typeof event.button === "number" && event.button !== 0) return;
    const record = widgetRecordById(widgetId);
    const shellObj = state.shells.get(widgetId);
    if (!record || !shellObj || !state.grid) return;
    event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();

    const point = dragPointerClient(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    const def = shellObj.def;
    const minW = Math.max(1, Number(def?.constraints?.minW || 1));
    const maxW = Math.max(minW, Number(def?.constraints?.maxW || 12));
    const minH = Math.max(1, Number(def?.constraints?.minH || 1));
    const maxH = Math.max(minH, Number(def?.constraints?.maxH || 96));

    const cols = Math.max(1, currentColumnCount());
    const style = window.getComputedStyle(state.grid);
    const gap = Number.parseFloat(String(style.columnGap || "0")) || 0;
    const rowHeight = 20;
    const usableWidth = Math.max(1, state.grid.clientWidth - gap * (cols - 1));
    const colWidth = usableWidth / cols;

    state.resizeSession = {
      widgetId,
      startX: point.x,
      startY: point.y,
      startW: record.w,
      startH: record.h,
      colWidth,
      gap,
      rowHeight,
      minW,
      maxW,
      minH,
      maxH,
      cols
    };

    document.body.classList.add("dashboard-resizing");
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("touchmove", onResizeMove, { passive: false });
    window.addEventListener("touchend", stopResize);
    window.addEventListener("touchcancel", stopResize);
  }

  function onResizeMove(event) {
    const session = state.resizeSession;
    if (!session) return;
    if (event?.cancelable) event.preventDefault();
    const record = widgetRecordById(session.widgetId);
    const shellObj = state.shells.get(session.widgetId);
    if (!record || !shellObj) return;

    const point = dragPointerClient(event);
    const dx = point.x - session.startX;
    const dy = point.y - session.startY;
    const cellWidth = session.colWidth + session.gap;
    const rawW = session.startW + Math.round(dx / Math.max(1, cellWidth));
    const rawH = session.startH + Math.round(dy / Math.max(1, session.rowHeight));
    record.w = Math.max(session.minW, Math.min(session.maxW, rawW));
    record.h = Math.max(session.minH, Math.min(session.maxH, rawH));
    record.settings = record.settings || {};
    record.settings.size = "custom";

    applyWidgetGeometry(shellObj, record);
    const widthInput = state.ui.settingsWidth;
    const heightInput = state.ui.settingsHeight;
    if (state.activeWidgetId === session.widgetId) {
      if (widthInput) widthInput.value = String(record.w);
      if (heightInput) heightInput.value = String(record.h);
      if (state.ui.settingsSize) state.ui.settingsSize.value = "custom";
    }
  }

  function stopResize() {
    if (!state.resizeSession) return;
    state.resizeSession = null;
    document.body.classList.remove("dashboard-resizing");
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", stopResize);
    window.removeEventListener("touchmove", onResizeMove);
    window.removeEventListener("touchend", stopResize);
    window.removeEventListener("touchcancel", stopResize);
    queuePersistLayout();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]
    ));
  }

  function onWindowResize() {
    renderLayout();
  }

  function init() {
    installFollowupAgentBridge();
    injectStyles();
    installApiUsageTracker();
    publishApiUsageBridge();
    ensureControls();
    ensureModals();
    applyEngineToolRegistry();
    bootstrapGridWithRetry(initializeContextIfNeeded, "init");
    // Failsafe: if bootstrap callback is missed, render defaults and force context init.
    window.setTimeout(() => {
      if ((!state.layout || !Array.isArray(state.layout.widgets)) && state.shells.size > 0) {
        state.layout = buildDefaultLayout(state.role);
      }
      if (state.didInitContext) return;
      initializeContextIfNeeded();
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
