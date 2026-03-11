"use strict";

const { nextId } = require("../db");
const { BlueprintError } = require("../errors");
const { checkConnectorRequirement } = require("./connector_service");
const { readWidgetManifest } = require("./manifest_service");
const { assessExecutionRequest, buildExecutionGate } = require("./reviewer_service");
const { assertWorkspaceAccess } = require("./workspace_service");

const ROLE_RANK = Object.freeze({
  member: 1,
  admin: 2,
  owner: 3,
});

const WIDGET_ROLE_POLICY = Object.freeze({
  server_control: "admin",
});

const WIDGET_TYPE_OVERRIDES = Object.freeze({
  agent_browser: "browser",
  reviewer_agent: "reviewer",
  server_control: "server_control",
  vault_tool: "vault",
  auto_shoot_evaluator: "lane_evaluator",
  quotation_valuation_engine: "quote_engine",
});

const BUILTIN_TEMPLATES = Object.freeze({
  default: {
    id: "operations-default",
    title: "Operations Default",
    slots: {
      primary: [
        { x: 0, y: 0, w: 8, h: 6 },
        { x: 0, y: 6, w: 6, h: 3 },
      ],
      secondary: [
        { x: 6, y: 6, w: 6, h: 3 },
        { x: 0, y: 9, w: 6, h: 3 },
      ],
      monitor: [
        { x: 8, y: 0, w: 4, h: 3 },
        { x: 8, y: 3, w: 4, h: 3 },
      ],
      support: [
        { x: 6, y: 9, w: 6, h: 3 },
        { x: 0, y: 12, w: 12, h: 3 },
      ],
    },
  },
  browser: {
    id: "browser-operations",
    title: "Browser Operations",
    slots: {
      primary: [{ x: 0, y: 0, w: 8, h: 8 }],
      secondary: [{ x: 8, y: 0, w: 4, h: 4 }],
      monitor: [{ x: 8, y: 4, w: 4, h: 4 }],
      support: [{ x: 0, y: 8, w: 12, h: 3 }],
    },
  },
  valuation: {
    id: "valuation-desk",
    title: "Valuation Desk",
    slots: {
      primary: [{ x: 0, y: 0, w: 8, h: 7 }],
      secondary: [{ x: 8, y: 0, w: 4, h: 4 }],
      monitor: [{ x: 8, y: 4, w: 4, h: 3 }],
      support: [{ x: 0, y: 7, w: 12, h: 3 }],
    },
  },
  server: {
    id: "server-operations",
    title: "Server Operations",
    slots: {
      primary: [{ x: 0, y: 0, w: 8, h: 7 }],
      secondary: [{ x: 8, y: 0, w: 4, h: 4 }],
      monitor: [{ x: 8, y: 4, w: 4, h: 3 }],
      support: [{ x: 0, y: 7, w: 12, h: 3 }],
    },
  },
  multiAgent: {
    id: "multi-agent-review",
    title: "Multi-Agent Review",
    slots: {
      primary: [
        { x: 0, y: 0, w: 6, h: 6 },
        { x: 6, y: 0, w: 6, h: 6 },
      ],
      secondary: [{ x: 0, y: 6, w: 8, h: 3 }],
      monitor: [{ x: 8, y: 6, w: 4, h: 3 }],
      support: [{ x: 0, y: 9, w: 12, h: 3 }],
    },
  },
});

const toText = (value, maxLen = 400) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
};

const normalizeList = (value, maxLen = 40) =>
  Array.isArray(value)
    ? value.map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return toText(item.id || item.name || item.label || item.value, 120);
        }
        return toText(item, 120);
      }).filter(Boolean).slice(0, maxLen)
    : [];

const normalizeAgents = (value, fallbackRole) => {
  const raw = Array.isArray(value) ? value : [];
  const rows = raw
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        const role = toText(item, 120);
        return role ? { id: `agent_${index + 1}`, role, title: role } : null;
      }
      const id = toText(item.id || `agent_${index + 1}`, 120) || `agent_${index + 1}`;
      const role = toText(item.role || item.name || item.title, 120);
      if (!role) return null;
      return {
        id,
        role,
        title: toText(item.title || item.name || role, 140) || role,
      };
    })
    .filter(Boolean);

  if (rows.length) return rows;
  const fallback = toText(fallbackRole, 120);
  return fallback ? [{ id: "agent_primary", role: fallback, title: fallback }] : [];
};

const roleRank = (role) => ROLE_RANK[String(role || "").trim().toLowerCase()] || 0;

const widgetTypeFromManifest = (manifest) => {
  if (WIDGET_TYPE_OVERRIDES[manifest.widgetId]) return WIDGET_TYPE_OVERRIDES[manifest.widgetId];
  const category = toText(manifest?.category || manifest?.ui?.category || "operations", 40).toLowerCase();
  return `${category.replace(/[^a-z0-9]+/g, "_")}_tool`;
};

const pickTemplatePreset = (candidateMap) => {
  if (candidateMap.has("auto_shoot_evaluator")) return BUILTIN_TEMPLATES.multiAgent;
  if (candidateMap.has("server_control")) return BUILTIN_TEMPLATES.server;
  if (candidateMap.has("widget_domain_valuator")
    || candidateMap.has("widget_car_valuator")
    || candidateMap.has("widget_property_evaluator")
    || candidateMap.has("widget_trip_finder")
    || candidateMap.has("quotation_valuation_engine")) {
    return BUILTIN_TEMPLATES.valuation;
  }
  if (candidateMap.has("agent_browser")) return BUILTIN_TEMPLATES.browser;
  return BUILTIN_TEMPLATES.default;
};

const normalizeSavedTemplate = (template) => {
  if (!template || typeof template !== "object" || Array.isArray(template)) return null;
  const id = toText(template.id || template.templateId || template.name, 120);
  if (!id) return null;
  const rows = Array.isArray(template.widgets) ? template.widgets : [];
  const layoutByWidgetId = new Map();
  const preferredOrder = [];
  for (const row of rows) {
    if (typeof row === "string") {
      const widgetId = toText(row, 120);
      if (!widgetId) continue;
      preferredOrder.push(widgetId);
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const widgetId = toText(row.widgetId || row.id, 120);
    if (!widgetId) continue;
    preferredOrder.push(widgetId);
    const position = row.position && typeof row.position === "object" ? row.position : row;
    layoutByWidgetId.set(widgetId, {
      x: Math.max(0, Number(position.x || 0) || 0),
      y: Math.max(0, Number(position.y || 0) || 0),
      w: Math.max(2, Number(position.w || position.width || 4) || 4),
      h: Math.max(2, Number(position.h || position.height || 3) || 3),
    });
  }
  return {
    id,
    title: toText(template.title || template.name || id, 140) || id,
    taskType: toText(template.taskType, 120),
    preferredOrder,
    layoutByWidgetId,
  };
};

const resolveTemplate = ({ templateId, savedWorkspaceTemplates, taskType, candidateMap }) => {
  const templates = Array.isArray(savedWorkspaceTemplates)
    ? savedWorkspaceTemplates.map(normalizeSavedTemplate).filter(Boolean)
    : [];
  const explicitId = toText(templateId, 120).toLowerCase();
  if (explicitId) {
    const direct = templates.find((item) => item.id.toLowerCase() === explicitId);
    if (direct) return { ...direct, source: "saved" };
  }

  const normalizedTaskType = toText(taskType, 120).toLowerCase();
  if (normalizedTaskType) {
    const byType = templates.find((item) => item.taskType.toLowerCase() === normalizedTaskType);
    if (byType) return { ...byType, source: "saved" };
  }

  const byWidget = templates.find((item) => item.preferredOrder.some((widgetId) => candidateMap.has(widgetId)));
  if (byWidget) return { ...byWidget, source: "saved" };

  const builtin = pickTemplatePreset(candidateMap);
  return {
    id: builtin.id,
    title: builtin.title,
    source: "builtin",
    layoutByWidgetId: new Map(),
    preferredOrder: [],
    slots: builtin.slots,
  };
};

const buildIntentText = (payload, agents) => {
  const availableApis = normalizeList(payload.availableApis, 30).join(" ");
  const roleText = agents.map((item) => item.role).join(" ");
  return [
    toText(payload.taskType, 120),
    toText(payload.taskGoal, 2000),
    toText(payload.agentRole, 120),
    roleText,
    availableApis,
    toText(payload.currentDesktopState?.activeUrl, 500),
  ]
    .filter(Boolean)
    .join("\n");
};

const extractUrlHost = (text) => {
  const match = String(text || "").match(/\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[/?#]|$)/i);
  return toText(match?.[1], 160);
};

const extractDomainHint = (text) => {
  const host = extractUrlHost(text);
  if (host) return host;
  const match = String(text || "").match(/\b([a-z0-9-]+\.[a-z]{2,})\b/i);
  return toText(match?.[1], 160);
};

const extractPropertyHint = (text) => {
  const match = String(text || "").match(/\b\d{1,5}\s+[a-z0-9'., -]{4,80}\b/i);
  return toText(match?.[0], 180);
};

const extractVehicleHint = (text) => {
  const match = String(text || "").match(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i);
  return toText(match?.[0], 40);
};

const buildTaskProfile = (payload, agents) => {
  const raw = buildIntentText(payload, agents);
  const text = raw.toLowerCase();
  const multiAgent = agents.length > 1 || /\bmulti[- ]agent\b|\bcompare lanes\b|\bparallel agents\b|\breviewer\b/i.test(raw);
  const browserIntent = /\bbrowser\b|\bnavigate\b|\bopen\b|\bdashboard\b|\blogin\b|\bcaptcha\b|\botp\b|\btab\b/i.test(text)
    || Boolean(toText(payload.currentDesktopState?.activeUrl, 500));
  const serverIntent = /\bserver\b|\bssh\b|\bfirewall\b|\bdeploy\b|\bdns\b|\bwhitelist\b|\bemergency close\b|\bopen access\b/i.test(text);
  const domainIntent = /\bdomain\b|\bregistrar\b|\bdns\b|\bnamecheap\b|\bfasthosts\b/i.test(text);
  const carIntent = /\bcar\b|\bvehicle\b|\bdealer\b|\bautotrader\b|\bregistration\b/i.test(text);
  const tripIntent = /\btrip\b|\btravel\b|\bflight\b|\bhotel\b|\bbooking\b|\bskyscanner\b/i.test(text);
  const adIntent = /\bad\b|\bcampaign\b|\bcreative\b|\bmeta ads\b|\bmarketing\b/i.test(text);
  const propertyIntent = /\bproperty\b|\breal estate\b|\bhouse\b|\bhome\b|\bzillow\b|\brightmove\b/i.test(text);
  const quoteIntent = /\bquote\b|\bquotation\b|\bproposal\b|\bestimate\b|\bvaluation\b/i.test(text);
  const vaultIntent = /\bvault\b|\bsecret\b|\bcredential\b|\btoken\b|\bapi key\b/i.test(text);
  return {
    text: raw,
    multiAgent,
    browserIntent,
    serverIntent,
    domainIntent,
    carIntent,
    tripIntent,
    adIntent,
    propertyIntent,
    quoteIntent,
    vaultIntent,
    domainHint: extractDomainHint(raw),
    propertyHint: extractPropertyHint(raw),
    vehicleHint: extractVehicleHint(raw),
  };
};

const priorityWeight = (priority) => {
  if (priority === "primary") return 30;
  if (priority === "monitor") return 20;
  if (priority === "secondary") return 15;
  return 10;
};

const addCandidate = (candidateMap, widgetId, patch) => {
  const id = toText(widgetId, 120);
  if (!id) return;
  const current = candidateMap.get(id) || {
    widgetId: id,
    priority: "support",
    reasons: [],
    initialProps: {},
    primary: false,
  };
  const nextPriority = priorityWeight(patch.priority) > priorityWeight(current.priority) ? patch.priority : current.priority;
  const reasons = new Set(current.reasons);
  if (patch.reason) reasons.add(toText(patch.reason, 240));
  candidateMap.set(id, {
    ...current,
    priority: nextPriority,
    reasons: Array.from(reasons),
    primary: current.primary || patch.priority === "primary",
    initialProps: {
      ...current.initialProps,
      ...(patch.initialProps && typeof patch.initialProps === "object" ? patch.initialProps : {}),
    },
  });
};

const roleSatisfiesWidget = (role, widgetId) => {
  const minRole = WIDGET_ROLE_POLICY[widgetId];
  if (!minRole) return true;
  return roleRank(role) >= roleRank(minRole);
};

const normalizeSessionPermissions = (value) => {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: toText(raw.mode || "", 40).toLowerCase(),
    allowExecution: raw.allowExecution !== false,
    allowedWidgetIds: new Set(normalizeList(raw.allowedWidgetIds, 40)),
    blockedWidgetIds: new Set(normalizeList(raw.blockedWidgetIds, 40)),
  };
};

const dependencyAllowedByApis = (availableApis, connectorId) => {
  if (!availableApis.size || !connectorId) return true;
  return availableApis.has(connectorId.toLowerCase());
};

const buildWidgetInitialProps = ({ widgetId, workspaceId, payload, profile, agents, reviewer, gate, baseProps }) => {
  const props = {
    ...(baseProps && typeof baseProps === "object" ? baseProps : {}),
  };
  if (widgetId === "agent_browser") {
    return {
      ...props,
      url: toText(payload.currentDesktopState?.activeUrl || "", 500),
      mode: profile.browserIntent ? "external" : "assist",
      session_snapshot: payload.currentDesktopState && typeof payload.currentDesktopState === "object"
        ? {
            activeUrl: toText(payload.currentDesktopState.activeUrl, 500),
            tabCount: Math.max(0, Number(payload.currentDesktopState.tabCount || 0) || 0),
          }
        : {},
      task_goal: toText(payload.taskGoal, 500),
    };
  }
  if (widgetId === "reviewer_agent") {
    return {
      ...props,
      prompt: toText(payload.taskGoal, 1200),
      task_context: {
        task: toText(payload.taskType, 160),
        goal: toText(payload.taskGoal, 400),
        agentRole: toText(payload.agentRole, 120),
        agents: agents.map((item) => ({ id: item.id, role: item.role })),
      },
      recent_actions: normalizeList(payload.currentSessionState?.recentActions, 20),
      reviewer_status: reviewer.status,
      execution_gate: gate.state,
    };
  }
  if (widgetId === "auto_shoot_evaluator") {
    return {
      ...props,
      lane_a: agents[0] || null,
      lane_b: agents[1] || null,
      task_context: {
        task: toText(payload.taskType, 160),
        goal: toText(payload.taskGoal, 400),
      },
    };
  }
  if (widgetId === "server_control") {
    return {
      ...props,
      server_action: toText(payload.taskType || "review_server_change", 160),
      network_scope: toText(payload.currentDesktopState?.networkScope, 160),
      approval_code: "",
    };
  }
  if (widgetId === "vault_tool") {
    return {
      ...props,
      record_filters: {
        workspaceId,
        tags: normalizeList(payload.currentSessionState?.recordTags, 10),
      },
    };
  }
  if (widgetId === "quotation_valuation_engine") {
    return {
      ...props,
      quote_brief: toText(payload.taskGoal, 1200),
      valuation_type: profile.propertyIntent ? "property" : profile.domainIntent ? "domain" : profile.carIntent ? "vehicle" : "general",
      pricing_context: payload.currentDesktopState?.pricingContext && typeof payload.currentDesktopState.pricingContext === "object"
        ? payload.currentDesktopState.pricingContext
        : {},
    };
  }
  if (widgetId === "widget_domain_valuator") {
    return {
      ...props,
      domain: profile.domainHint || "",
      workspaceId,
    };
  }
  if (widgetId === "widget_car_valuator") {
    return {
      ...props,
      vehicle_registration: profile.vehicleHint || "",
      inventory_context: payload.currentDesktopState?.inventoryContext && typeof payload.currentDesktopState.inventoryContext === "object"
        ? payload.currentDesktopState.inventoryContext
        : {},
    };
  }
  if (widgetId === "widget_trip_finder") {
    return {
      ...props,
      origin: toText(payload.currentDesktopState?.origin, 120),
      destination: toText(payload.currentDesktopState?.destination, 120),
      travel_dates: payload.currentDesktopState?.travelDates && typeof payload.currentDesktopState.travelDates === "object"
        ? payload.currentDesktopState.travelDates
        : {},
    };
  }
  if (widgetId === "widget_ad_generator") {
    return {
      ...props,
      campaign_brief: toText(payload.taskGoal, 1200),
      target_audience: payload.currentDesktopState?.audience && typeof payload.currentDesktopState.audience === "object"
        ? payload.currentDesktopState.audience
        : {},
      creative_constraints: normalizeList(payload.currentDesktopState?.constraints, 20),
    };
  }
  if (widgetId === "widget_property_evaluator") {
    return {
      ...props,
      property_address: profile.propertyHint || "",
      market_context: payload.currentDesktopState?.marketContext && typeof payload.currentDesktopState.marketContext === "object"
        ? payload.currentDesktopState.marketContext
        : {},
    };
  }
  return props;
};

const buildCandidateWidgets = ({ payload, profile, reviewer, gate, agents }) => {
  const candidateMap = new Map();
  if (profile.serverIntent) {
    addCandidate(candidateMap, "server_control", {
      priority: "primary",
      reason: "Task intent requires server operations controls.",
    });
  }
  if (profile.domainIntent) {
    addCandidate(candidateMap, "widget_domain_valuator", {
      priority: "primary",
      reason: "Task intent targets domain valuation or registrar analysis.",
    });
  }
  if (profile.carIntent) {
    addCandidate(candidateMap, "widget_car_valuator", {
      priority: "primary",
      reason: "Task intent targets vehicle valuation or dealer inventory.",
    });
  }
  if (profile.tripIntent) {
    addCandidate(candidateMap, "widget_trip_finder", {
      priority: "primary",
      reason: "Task intent targets travel planning.",
    });
  }
  if (profile.adIntent) {
    addCandidate(candidateMap, "widget_ad_generator", {
      priority: "primary",
      reason: "Task intent targets campaign or ad generation.",
    });
  }
  if (profile.propertyIntent) {
    addCandidate(candidateMap, "widget_property_evaluator", {
      priority: "primary",
      reason: "Task intent targets property valuation.",
    });
  }
  if (profile.quoteIntent && !profile.tripIntent) {
    addCandidate(candidateMap, "quotation_valuation_engine", {
      priority: profile.domainIntent || profile.carIntent || profile.propertyIntent ? "secondary" : "primary",
      reason: "Task intent requires quotation or valuation synthesis.",
    });
  }
  if (profile.browserIntent) {
    addCandidate(candidateMap, "agent_browser", {
      priority: candidateMap.size ? "secondary" : "primary",
      reason: "Task intent requires browser or dashboard context.",
    });
  }
  if (profile.vaultIntent) {
    addCandidate(candidateMap, "vault_tool", {
      priority: "support",
      reason: "Task references credentials or vault records.",
    });
  }
  if (profile.multiAgent) {
    addCandidate(candidateMap, "auto_shoot_evaluator", {
      priority: candidateMap.size ? "secondary" : "primary",
      reason: "Multiple agents require lane comparison or coordination.",
    });
  }

  const duplicateRisk = Array.isArray(payload.currentDesktopState?.widgets)
    && payload.currentDesktopState.widgets.some((item) => {
      const widgetId = toText(item?.widgetId || item?.id, 120);
      return widgetId && candidateMap.has(widgetId);
    });

  const needsReviewer = profile.multiAgent
    || reviewer.status !== "clear"
    || gate.state === "awaiting_confirmation"
    || gate.state === "blocked"
    || duplicateRisk;
  if (needsReviewer) {
    addCandidate(candidateMap, "reviewer_agent", {
      priority: "monitor",
      reason: "Reviewer is required to guard execution or duplicate risk.",
    });
  }

  return candidateMap;
};

const manifestForWidget = (widgetId) => {
  try {
    return readWidgetManifest(widgetId);
  } catch (err) {
    if (err instanceof BlueprintError && err.code === "manifest_not_found") return null;
    throw err;
  }
};

const chooseSlot = (slots, index, fallbackY) => {
  const list = Array.isArray(slots) ? slots : [];
  if (list[index]) return list[index];
  const last = list[list.length - 1];
  if (last) {
    return {
      x: last.x,
      y: last.y + Math.max(1, last.h) * Math.max(1, index - list.length + 1),
      w: last.w,
      h: last.h,
    };
  }
  return { x: 0, y: fallbackY, w: 6, h: 3 };
};

const compileWorkspaceSession = ({
  actorUserId,
  workspaceId,
  taskType,
  taskGoal,
  agentRole,
  sessionPermissions,
  availableApis,
  currentDesktopState,
  currentSessionState,
  savedWorkspaceTemplates,
  templateId,
  allowAutomation = false,
  agents,
} = {}) => {
  const resolvedActorUserId = toText(actorUserId, 120);
  const resolvedWorkspaceId = toText(workspaceId, 120);
  if (!resolvedActorUserId) {
    throw new BlueprintError(400, "invalid_actor", "actorUserId is required");
  }
  if (!resolvedWorkspaceId) {
    throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
  }

  const access = assertWorkspaceAccess(resolvedActorUserId, resolvedWorkspaceId);
  const safePayload = {
    taskType: toText(taskType, 160),
    taskGoal: toText(taskGoal, 4000),
    agentRole: toText(agentRole, 120),
    currentDesktopState: currentDesktopState && typeof currentDesktopState === "object" ? currentDesktopState : {},
    currentSessionState: currentSessionState && typeof currentSessionState === "object" ? currentSessionState : {},
    availableApis: normalizeList(availableApis, 40),
  };
  const normalizedAgents = normalizeAgents(agents, safePayload.agentRole);
  const reviewer = assessExecutionRequest({
    workspaceId: resolvedWorkspaceId,
    prompt: safePayload.taskGoal || safePayload.taskType,
    taskContext: {
      task: safePayload.taskType,
      goal: safePayload.taskGoal,
      agentRole: safePayload.agentRole,
      agents: normalizedAgents.map((item) => item.role),
    },
  });
  const gate = buildExecutionGate({
    allowAutomation: Boolean(allowAutomation),
    reviewer,
    taskContext: {
      task: safePayload.taskType,
      goal: safePayload.taskGoal,
      agentRole: safePayload.agentRole,
    },
    prompt: safePayload.taskGoal || safePayload.taskType,
  });

  const profile = buildTaskProfile(safePayload, normalizedAgents);
  const candidateMap = buildCandidateWidgets({
    payload: safePayload,
    profile,
    reviewer,
    gate,
    agents: normalizedAgents,
  });
  const template = resolveTemplate({
    templateId,
    savedWorkspaceTemplates,
    taskType: safePayload.taskType,
    candidateMap,
  });

  const permissions = normalizeSessionPermissions(sessionPermissions);
  const availableApiSet = new Set(safePayload.availableApis.map((item) => item.toLowerCase()));
  const desktopWidgets = Array.isArray(safePayload.currentDesktopState.widgets) ? safePayload.currentDesktopState.widgets : [];

  const approved = [];
  const rejected = [];
  const aggregateDependencies = [];
  const dependencyKeys = new Set();

  const candidates = Array.from(candidateMap.values()).sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority));
  for (const candidate of candidates) {
    const manifest = manifestForWidget(candidate.widgetId);
    if (!manifest) {
      rejected.push({
        widgetId: candidate.widgetId,
        widgetType: "unavailable",
        reason: "Widget is not registered in the controlled registry.",
        status: "unavailable",
      });
      continue;
    }

    if (permissions.allowedWidgetIds.size && !permissions.allowedWidgetIds.has(manifest.widgetId)) {
      rejected.push({
        widgetId: manifest.widgetId,
        widgetType: widgetTypeFromManifest(manifest),
        reason: "Session-scoped permissions do not include this widget.",
        status: "permission_denied",
      });
      continue;
    }
    if (permissions.blockedWidgetIds.has(manifest.widgetId)) {
      rejected.push({
        widgetId: manifest.widgetId,
        widgetType: widgetTypeFromManifest(manifest),
        reason: "Session-scoped permissions explicitly block this widget.",
        status: "permission_denied",
      });
      continue;
    }
    if (!roleSatisfiesWidget(access.role, manifest.widgetId)) {
      rejected.push({
        widgetId: manifest.widgetId,
        widgetType: widgetTypeFromManifest(manifest),
        reason: `Workspace role '${access.role}' cannot open this widget.`,
        status: "permission_denied",
      });
      continue;
    }

    const requiredDependencies = [];
    let dependencyRejected = null;
    for (const requirement of manifest.requiredConnectors || []) {
      if (!dependencyAllowedByApis(availableApiSet, requirement.connectorId)) {
        dependencyRejected = {
          widgetId: manifest.widgetId,
          widgetType: widgetTypeFromManifest(manifest),
          reason: `Required API '${requirement.connectorId}' is unavailable in this session.`,
          status: "missing_dependency",
          dependency: {
            kind: "connector",
            id: requirement.connectorId,
            status: "unavailable",
          },
        };
        break;
      }
      const check = checkConnectorRequirement({
        workspaceId: resolvedWorkspaceId,
        requirement,
      });
      if (check.status !== "ok") {
        dependencyRejected = {
          widgetId: manifest.widgetId,
          widgetType: widgetTypeFromManifest(manifest),
          reason: check.message || "Widget dependencies are incomplete.",
          status: "missing_dependency",
          dependency: {
            kind: "connector",
            id: check.connectorId,
            status: check.status,
            requiredScopes: check.requiredScopes || [],
            requiredFields: check.requiredFields || [],
          },
        };
        break;
      }
      requiredDependencies.push({
        kind: "connector",
        id: check.connectorId,
        connectionId: check.connectionId,
        status: "ready",
        requiredScopes: check.requiredScopes || [],
      });
    }
    if (dependencyRejected) {
      rejected.push(dependencyRejected);
      continue;
    }

    const existing = desktopWidgets.find((row) => {
      const widgetId = toText(row?.widgetId || row?.id, 120);
      return widgetId === manifest.widgetId;
    });
    const widgetId = toText(existing?.instanceId || existing?.sessionWidgetId, 120) || nextId("stove_widget");
    const widget = {
      id: widgetId,
      widgetId: manifest.widgetId,
      widgetType: widgetTypeFromManifest(manifest),
      title: toText(manifest.title || manifest.name || manifest.widgetId, 160) || manifest.widgetId,
      priority: candidate.priority,
      reason: candidate.reasons.slice(0, 3),
      position: null,
      initialProps: buildWidgetInitialProps({
        widgetId: manifest.widgetId,
        workspaceId: resolvedWorkspaceId,
        payload: safePayload,
        profile,
        agents: normalizedAgents,
        reviewer,
        gate,
        baseProps: candidate.initialProps,
      }),
      permissions: {
        workspaceRole: access.role,
        renderAllowed: true,
        executeAllowed: permissions.allowExecution && gate.state !== "blocked",
      },
      dataDependencies: requiredDependencies,
      executionFlags: {
        autoRun: false,
        requiresReview: manifest.widgetId === "reviewer_agent" || gate.state === "awaiting_confirmation" || reviewer.status !== "clear",
        haltUntilConfirmed: gate.state === "awaiting_confirmation" || reviewer.status === "blocked_conflict",
        reuseExisting: Boolean(existing),
      },
    };
    approved.push(widget);
    for (const dependency of requiredDependencies) {
      const key = `${dependency.kind}:${dependency.id}:${dependency.connectionId || ""}`;
      if (dependencyKeys.has(key)) continue;
      dependencyKeys.add(key);
      aggregateDependencies.push(dependency);
    }
  }

  const placementTemplate = template.slots || pickTemplatePreset(candidateMap).slots;
  const orderedByTemplate = approved.slice().sort((left, right) => {
    const leftIndex = template.preferredOrder ? template.preferredOrder.indexOf(left.widgetId) : -1;
    const rightIndex = template.preferredOrder ? template.preferredOrder.indexOf(right.widgetId) : -1;
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return priorityWeight(right.priority) - priorityWeight(left.priority);
  });

  const placed = {
    primary: 0,
    secondary: 0,
    monitor: 0,
    support: 0,
  };
  for (const widget of orderedByTemplate) {
    const savedPosition = template.layoutByWidgetId instanceof Map ? template.layoutByWidgetId.get(widget.widgetId) : null;
    if (savedPosition) {
      widget.position = savedPosition;
      continue;
    }
    const bucket = widget.priority === "primary"
      ? "primary"
      : widget.priority === "monitor"
        ? "monitor"
        : widget.priority === "secondary"
          ? "secondary"
          : "support";
    widget.position = chooseSlot(placementTemplate[bucket], placed[bucket], 9 + placed.support * 3);
    placed[bucket] += 1;
  }

  const rejectedPrimary = rejected.find((item) => {
    const candidate = candidateMap.get(item.widgetId);
    return Boolean(candidate?.primary);
  });
  const blockedPrimary = rejected.some((item) => item.status === "missing_dependency" || item.status === "permission_denied")
    && !orderedByTemplate.some((item) => item.priority === "primary");
  const sessionMode = gate.state === "blocked" || blockedPrimary
    ? "blocked"
    : profile.multiAgent
      ? "multi_agent"
      : gate.state === "awaiting_confirmation" || reviewer.status !== "clear"
        ? "review"
        : "compose";

  const widgetList = orderedByTemplate.map((item) => item.id);
  const manifest = {
    sessionId: nextId("stove_session"),
    workspaceId: resolvedWorkspaceId,
    sessionMode,
    template: {
      id: template.id,
      title: template.title,
      source: template.source,
    },
    widgetList,
    widgets: orderedByTemplate,
    rejectedWidgets: rejected,
    permissions: {
      workspaceRole: access.role,
      allowExecution: permissions.allowExecution,
      sessionPermissionMode: permissions.mode || "standard",
    },
    dataDependencies: aggregateDependencies,
    executionFlags: {
      autoExecuteAllowed: gate.autoExecute,
      requiresHumanConfirmation: gate.state === "awaiting_confirmation",
      halted: sessionMode === "blocked" || gate.state === "blocked",
      haltReason: blockedPrimary
        ? toText(rejectedPrimary?.reason || "Primary widget dependencies are unavailable.", 240)
        : gate.reason,
    },
    layout: {
      gridColumns: 12,
      rowHeight: 120,
      templateId: template.id,
    },
    review: {
      status: reviewer.status,
      riskLevel: reviewer.riskLevel,
      summary: reviewer.summary,
      intents: reviewer.intents,
    },
    handoff: {
      target: "frontend_renderer",
      schemaVersion: "blueprint.widget_session.v1",
      emittedAt: new Date().toISOString(),
    },
  };

  if (!manifest.widgets.length && !manifest.rejectedWidgets.length) {
    manifest.rejectedWidgets.push({
      widgetId: "",
      widgetType: "unsupported_intent",
      reason: "No registered widget matches the supplied task intent.",
      status: "unavailable",
    });
    manifest.sessionMode = "blocked";
    manifest.executionFlags.halted = true;
    manifest.executionFlags.haltReason = "No registered widget matches the supplied task intent.";
  }

  return {
    ok: true,
    manifest,
  };
};

module.exports = {
  compileWorkspaceSession,
};
