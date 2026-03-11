"use strict";

const { createServerActionPlan, listServerActionPlans } = require("../db");
const { assessExecutionRequest, recordReviewerOutcome } = require("./reviewer_service");
const { createSystemVaultRecord } = require("./vault_record_service");

const SERVER_PANEL_SECTIONS = Object.freeze([
  "Status",
  "Access",
  "Security",
  "Services",
  "Network",
  "Logs",
  "Approval",
  "Execute",
]);

const SERVER_QUICK_ACTIONS = Object.freeze([
  { id: "lock_server", label: "Lock server", section: "security", indicator: "green" },
  { id: "open_access_5m", label: "Open access 5 minutes", section: "access", indicator: "amber" },
  { id: "open_access_15m", label: "Open access 15 minutes", section: "access", indicator: "amber" },
  { id: "whitelist_current_ip", label: "Whitelist current IP", section: "access", indicator: "amber" },
  { id: "restart_ssh", label: "Restart SSH", section: "services", indicator: "blue" },
  { id: "install_xitoring_agent", label: "Install Xitoring agent", section: "services", indicator: "amber" },
  { id: "view_logs", label: "View logs", section: "logs", indicator: "green" },
  { id: "emergency_close", label: "Emergency close", section: "approval", indicator: "red" },
]);

const DEFAULT_SAFE_MODE = Object.freeze({
  mode: "LOCKED",
  rootLogin: "OFF",
  passwordLogin: "OFF",
  sshKeyOnly: "ON",
  firewall: "ON",
  humanApproval: "REQUIRED",
});

const XITORING_INSTALLER_URL = "https://app.xitoring.com/xitogent/v2/linux/installer.bash";
const XITORING_DEFAULT_FLAGS = Object.freeze([
  "--auto_discovery",
  "--auto_update",
  "--auto_trigger",
  "--http",
  "--ftp",
  "--dns",
  "--ping",
  "--smtp",
  "--pop3",
  "--imap",
  "--heartbeat",
  "--ipv4",
  "--notification='default'",
]);

const findQuickAction = (actionId) =>
  SERVER_QUICK_ACTIONS.find((item) => item.id === String(actionId || "").trim().toLowerCase()) || null;

const indicatorFromPlans = (plans) => {
  const rows = Array.isArray(plans) ? plans : [];
  if (rows.some((item) => String(item?.status || "").toLowerCase() === "change_executing")) return "blue";
  if (rows.some((item) => String(item?.actionId || "") === "emergency_close" && String(item?.status || "").toLowerCase() !== "completed")) return "red";
  if (rows.some((item) => String(item?.status || "").toLowerCase() === "blocked_conflict")) return "red";
  if (rows.some((item) => ["pending_external", "pending", "requires_human_confirmation"].includes(String(item?.status || "").toLowerCase()))) return "amber";
  return "green";
};

const serializePlan = (plan) => ({
  id: plan.id,
  workspaceId: plan.workspaceId,
  actionId: plan.actionId,
  section: plan.section,
  status: plan.status,
  indicator: plan.indicator,
  params: plan.params || {},
  requiresHumanApproval: plan.requiresHumanApproval !== false,
  reviewer: plan.reviewer || {},
  vaultRecordIds: Array.isArray(plan.vaultRecordIds) ? plan.vaultRecordIds.slice() : [],
  createdBy: plan.createdBy || "",
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

const normalizeParams = (params) => (params && typeof params === "object" ? { ...params } : {});

const buildServerActionPayload = ({ action, params }) => {
  const normalizedParams = normalizeParams(params);
  const basePayload = {
    actionId: action.id,
    label: action.label,
    params: normalizedParams,
    provider: "pending_external",
    executionModel: "bot_prepares_human_approves_system_executes",
  };

  if (action.id !== "install_xitoring_agent") {
    return basePayload;
  }

  const secretRefId = String(normalizedParams.secretRefId || normalizedParams.secret_ref_id || "").trim();
  const notification = String(normalizedParams.notification || "default").trim() || "default";
  const commandFlags = Array.isArray(normalizedParams.flags)
    ? normalizedParams.flags.map((item) => String(item || "").trim()).filter(Boolean)
    : XITORING_DEFAULT_FLAGS.map((item) =>
        item === "--notification='default'" ? `--notification='${notification.replace(/'/g, "")}'` : item
      );
  const commandTemplate = [
    `curl -fs '${XITORING_INSTALLER_URL}' > installer.bash`,
    `sudo bash installer.bash --key=${secretRefId ? `<vault:${secretRefId}>` : "<vault:secret_ref_id>"} ${commandFlags.join(" ")}`,
  ].join(" && ");

  return {
    ...basePayload,
    installerUrl: XITORING_INSTALLER_URL,
    commandTemplate,
    keySource: secretRefId ? { secretRefId } : { secretRefId: null, missing: true },
    commandFlags,
    missingRequirements: secretRefId ? [] : ["secretRefId"],
  };
};

const getServerPanel = ({ workspaceId = "ws_core" } = {}) => {
  const plans = listServerActionPlans({ workspaceId, limit: 20 }).map((item) => serializePlan(item));
  const indicator = indicatorFromPlans(plans);
  return {
    workspaceId,
    indicator,
    indicatorLabel:
      indicator === "red"
        ? "security_risk"
        : indicator === "amber"
          ? "limited_or_pending_approval"
          : indicator === "blue"
            ? "change_executing"
            : "secure_normal",
    safeMode: { ...DEFAULT_SAFE_MODE },
    sections: SERVER_PANEL_SECTIONS.slice(),
    quickActions: SERVER_QUICK_ACTIONS.map((item) => ({
      ...item,
      route: `/api/server/actions`,
      status: "pending_external",
    })),
    plans,
  };
};

const prepareServerAction = ({
  workspaceId = "ws_core",
  actionId,
  params = {},
  createdBy = "system",
}) => {
  const action = findQuickAction(actionId);
  if (!action) {
    const ids = SERVER_QUICK_ACTIONS.map((item) => item.id).join(", ");
    throw new Error(`Unknown server action. Expected one of: ${ids}`);
  }

  const reviewer = assessExecutionRequest({
    workspaceId,
    prompt: action.label,
    taskContext: {
      actionArea: "server",
      actionId: action.id,
      params,
    },
    intents: ["server_action"],
  });
  const reviewRecord = recordReviewerOutcome({
    workspaceId,
    createdBy,
    reviewer,
    prompt: action.label,
    taskContext: {
      actionArea: "server",
      actionId: action.id,
      params,
    },
  });

  const serverActionRecord = createSystemVaultRecord({
    workspaceId,
    recordType: "server_action",
    title: `Server action ${action.label}`,
    status: reviewer.status === "blocked_conflict" ? "blocked_conflict" : "pending_external",
    payload: buildServerActionPayload({ action, params }),
    meta: {
      indicator: reviewer.status === "blocked_conflict" ? "red" : action.indicator,
      section: action.section,
      fingerprint: reviewRecord?.meta?.fingerprint || reviewRecord?.payload?.fingerprint || "",
    },
    relatedIds: reviewRecord?.recordId ? [reviewRecord.recordId] : [],
    createdBy,
  });

  const plan = createServerActionPlan({
    workspaceId,
    actionId: action.id,
    section: action.section,
    status: reviewer.status === "blocked_conflict" ? "blocked_conflict" : "pending_external",
    indicator: reviewer.status === "blocked_conflict" ? "red" : action.indicator,
    params,
    reviewer,
    createdBy,
    vaultRecordIds: [reviewRecord?.recordId, serverActionRecord?.recordId].filter(Boolean),
  });

  return {
    plan: serializePlan(plan),
    panel: getServerPanel({ workspaceId }),
  };
};

module.exports = {
  DEFAULT_SAFE_MODE,
  SERVER_PANEL_SECTIONS,
  SERVER_QUICK_ACTIONS,
  getServerPanel,
  prepareServerAction,
};
