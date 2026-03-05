"use strict";

const tls = require("tls");
const { BlueprintError } = require("./blueprint/errors");
const { createSecret, readSecretPlaintextForServer } = require("./blueprint/vault/service");
const { getStatus: vaultBrokerStatus, unlockVault } = require("./vault_broker");

const CONNECTOR_ID = "server_monitor_plesk";
const SECRET_NAMES = Object.freeze({
  config: "server_monitor_config_json",
  token: "server_monitor_agent_token",
});

const DEFAULT_NOTIFICATIONS = Object.freeze({
  diskFull: true,
  serverDown: true,
  securityWarning: true,
});

const DEFAULT_CONFIG = Object.freeze({
  hostType: "VPS",
  provider: "Fasthosts",
  controlPanel: "Plesk",
  serverHost: "185.230.219.166",
  serverPort: 22,
  serverUser: "root",
  os: "Ubuntu 24.04",
  panelUrl: "https://185.230.219.166:8443",
  monitorAgentUrl: "http://185.230.219.166:9870/health",
  primaryDomains: [],
  notifications: DEFAULT_NOTIFICATIONS,
});

const INSTALL_SCRIPT_PATH = "scripts/install_plesk_webpros_monitor_agent.sh";

const withTimeoutSignal = (timeoutMs) => {
  const ms = Math.max(1, Number(timeoutMs) || 1);
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};

const normalizeWorkspaceId = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);

const resolveWorkspaceId = (auth, incoming) => {
  const direct = normalizeWorkspaceId(incoming || "");
  if (direct) return direct;
  const workspaces = Array.isArray(auth?.me?.workspaces) ? auth.me.workspaces : [];
  const first = normalizeWorkspaceId(workspaces[0]?.id || "");
  return first || "ws_core";
};

const roleForWorkspace = (auth, workspaceId) => {
  const wanted = normalizeWorkspaceId(workspaceId);
  if (!wanted) return "";
  const roles = Array.isArray(auth?.me?.roles) ? auth.me.roles : [];
  for (const row of roles) {
    if (normalizeWorkspaceId(row?.workspaceId || "") !== wanted) continue;
    return String(row?.role || "").trim().toLowerCase();
  }
  const workspaces = Array.isArray(auth?.me?.workspaces) ? auth.me.workspaces : [];
  for (const row of workspaces) {
    if (normalizeWorkspaceId(row?.id || "") !== wanted) continue;
    return String(row?.role || "").trim().toLowerCase();
  }
  return "";
};

const ensureWorkspaceAdmin = (auth, workspaceId) => {
  const role = roleForWorkspace(auth, workspaceId);
  if (!["owner", "admin"].includes(role)) {
    throw new BlueprintError(403, "workspace_admin_required", "Admin workspace access is required");
  }
  return role;
};

const normalizeHost = (value, fallback) => {
  const raw = String(value || "").trim();
  if (!raw) return String(fallback || "").trim();
  const cleaned = raw.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  return cleaned.slice(0, 255);
};

const normalizePort = (value, fallback) => {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(65535, n));
};

const normalizeText = (value, max, fallback) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return String(fallback || "");
  return text.slice(0, max);
};

const normalizePanelUrl = (value, fallback) => {
  const source = String(value || "").trim() || String(fallback || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

const normalizeMonitorAgentUrl = (value, fallbackHost) => {
  const source = String(value || "").trim();
  const base = source || `http://${normalizeHost(fallbackHost, DEFAULT_CONFIG.serverHost)}:9870/health`;
  try {
    const parsed = new URL(base);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/health";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const normalizeDomain = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const stripped = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  if (!stripped || stripped.length > 253) return "";
  const pattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
  return pattern.test(stripped) ? stripped : "";
};

const normalizePrimaryDomains = (value) => {
  const out = [];
  const seen = new Set();
  const parts = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[\n,;\s]+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  for (const part of parts) {
    const domain = normalizeDomain(part);
    if (!domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= 30) break;
  }
  return out;
};

const normalizeNotifications = (raw, fallback = DEFAULT_NOTIFICATIONS) => {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    diskFull: typeof source.diskFull === "boolean" ? source.diskFull : Boolean(fallback?.diskFull),
    serverDown: typeof source.serverDown === "boolean" ? source.serverDown : Boolean(fallback?.serverDown),
    securityWarning:
      typeof source.securityWarning === "boolean"
        ? source.securityWarning
        : Boolean(fallback?.securityWarning),
  };
};

const normalizeConfig = (raw, fallback = DEFAULT_CONFIG) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const serverHost = normalizeHost(source.serverHost, fallback.serverHost);
  const monitorAgentUrl = normalizeMonitorAgentUrl(source.monitorAgentUrl, serverHost || fallback.serverHost);
  return {
    hostType: normalizeText(source.hostType, 40, fallback.hostType),
    provider: normalizeText(source.provider, 80, fallback.provider),
    controlPanel: normalizeText(source.controlPanel, 80, fallback.controlPanel),
    serverHost,
    serverPort: normalizePort(source.serverPort, fallback.serverPort),
    serverUser: normalizeText(source.serverUser, 80, fallback.serverUser),
    os: normalizeText(source.os, 120, fallback.os),
    panelUrl: normalizePanelUrl(source.panelUrl, fallback.panelUrl),
    monitorAgentUrl,
    primaryDomains: normalizePrimaryDomains(source.primaryDomains),
    notifications: normalizeNotifications(source.notifications, fallback.notifications),
  };
};

const mergeConfig = (current, patch) => {
  const base = normalizeConfig(current || DEFAULT_CONFIG, DEFAULT_CONFIG);
  const source = patch && typeof patch === "object" ? patch : {};
  const merged = {
    ...base,
    ...source,
    notifications: normalizeNotifications(source.notifications, base.notifications),
  };
  if (source.primaryDomains !== undefined) {
    merged.primaryDomains = normalizePrimaryDomains(source.primaryDomains);
  } else {
    merged.primaryDomains = normalizePrimaryDomains(base.primaryDomains);
  }
  return normalizeConfig(merged, DEFAULT_CONFIG);
};

const readSecretOptional = async ({ actorUserId, workspaceId, name }) => {
  try {
    return readSecretPlaintextForServer({
      actorUserId,
      workspaceId,
      connectorId: CONNECTOR_ID,
      name,
    });
  } catch (err) {
    if (err instanceof BlueprintError && err.code === "secret_not_found") return "";
    throw err;
  }
};

const loadMonitorSecrets = async ({ actorUserId, workspaceId }) => {
  const configRaw = await readSecretOptional({
    actorUserId,
    workspaceId,
    name: SECRET_NAMES.config,
  });
  const tokenRaw = await readSecretOptional({
    actorUserId,
    workspaceId,
    name: SECRET_NAMES.token,
  });

  const parsed = safeJsonParse(configRaw);
  const config = normalizeConfig(parsed && typeof parsed === "object" ? parsed : DEFAULT_CONFIG, DEFAULT_CONFIG);
  const token = String(tokenRaw || "").trim();

  return {
    config,
    token,
    hasConfig: Boolean(String(configRaw || "").trim()),
    hasToken: Boolean(token),
  };
};

const getVaultState = async () => {
  try {
    const status = await vaultBrokerStatus();
    return {
      unlocked: Boolean(status?.unlocked),
      reason: String(status?.reason || (status?.unlocked ? "" : "locked")),
      lastActivityAt: Number(status?.lastActivityAt || 0),
      idleLockMs: Number(status?.idleLockMs || 0),
    };
  } catch {
    return {
      unlocked: false,
      reason: "unavailable",
      lastActivityAt: 0,
      idleLockMs: 0,
    };
  }
};

const unlockMonitorVault = async ({ actorId, botId }) => {
  await unlockVault({
    actorType: "human",
    actorId: String(actorId || "server-monitor-admin").trim() || "server-monitor-admin",
    botId: String(botId || "server-monitor-widget").trim() || "server-monitor-widget",
    reason: "server_monitor_unlock",
  });
  return getVaultState();
};

const buildInstallOneLiner = (config) => {
  const host = normalizeHost(config?.serverHost, DEFAULT_CONFIG.serverHost);
  const domains = normalizePrimaryDomains(config?.primaryDomains || []);
  const domainsValue = domains.length ? domains.join(",") : "example.com";
  return `scp ./${INSTALL_SCRIPT_PATH} root@${host}:/tmp/install_plesk_webpros_monitor_agent.sh && ssh root@${host} \"chmod +x /tmp/install_plesk_webpros_monitor_agent.sh && AGENTC_MONITOR_TOKEN='<SET_STRONG_TOKEN>' PRIMARY_DOMAINS='${domainsValue}' bash /tmp/install_plesk_webpros_monitor_agent.sh\"`;
};

const deriveAgentUrl = (monitorAgentUrl, wantedPath) => {
  const source = String(monitorAgentUrl || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    if (wantedPath) parsed.pathname = `/${String(wantedPath).replace(/^\/+/, "")}`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const monitorAuthHeaders = (token) => {
  const value = String(token || "").trim();
  if (!value) return { Accept: "application/json" };
  return {
    Accept: "application/json",
    Authorization: `Bearer ${value}`,
    "x-agentc-monitor-token": value,
  };
};

const probeMonitorEndpoint = async (config, token, timeoutMs = 4500) => {
  const readyUrl = deriveAgentUrl(config?.monitorAgentUrl, "ready");
  const healthUrl = deriveAgentUrl(config?.monitorAgentUrl, "health");
  const headers = monitorAuthHeaders(token);

  const probe = async (url) => {
    if (!url) return { ok: false, error: "missing_url", status: 0, payload: null, url: "" };
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: withTimeoutSignal(timeoutMs),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          error: `http_${response.status}`,
          status: response.status,
          payload,
          url,
        };
      }
      return {
        ok: true,
        error: "",
        status: response.status,
        payload,
        url,
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || "monitor_probe_failed"),
        status: 0,
        payload: null,
        url,
      };
    }
  };

  const ready = await probe(readyUrl || healthUrl);
  if (ready.ok) return ready;
  if (healthUrl && ready.url !== healthUrl) {
    const health = await probe(healthUrl);
    if (health.ok) return health;
    return health;
  }
  return ready;
};

const computeGate = ({ vaultState, config, token, probe }) => {
  if (!vaultState?.unlocked) {
    return {
      state: "vault_locked",
      level: "warning",
      message: "Unlock Vault to load credentials.",
      missing: ["vault_unlock"],
      canRunCheck: false,
    };
  }

  const missing = [];
  if (!String(config?.monitorAgentUrl || "").trim()) missing.push("monitor_agent_url");
  if (!String(token || "").trim()) missing.push("monitor_agent_token");

  if (missing.length) {
    return {
      state: "credentials_missing",
      level: "warning",
      message: "Add monitor credentials (agent URL + token) to continue.",
      missing,
      canRunCheck: false,
    };
  }

  if (probe && !probe.ok) {
    return {
      state: "monitoring_not_configured",
      level: "warning",
      message: "Install Monitor Agent on the VPS and confirm /ready is reachable.",
      missing: ["monitor_agent_install"],
      canRunCheck: false,
      details: String(probe.error || "monitor_not_ready"),
    };
  }

  return {
    state: "ready",
    level: "healthy",
    message: "Monitoring configured and reachable.",
    missing: [],
    canRunCheck: true,
  };
};

const safeIso = (value) => {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
};

const sslStatusFromDays = (days) => {
  const n = Number(days);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0) return "expired";
  if (n <= 30) return "expiring";
  return "valid";
};

const checkSslDomain = (domain) =>
  new Promise((resolve) => {
    const name = normalizeDomain(domain);
    if (!name) {
      resolve({
        domain: String(domain || ""),
        status: "unknown",
        expiresAt: "",
        daysRemaining: null,
        error: "invalid_domain",
      });
      return;
    }

    const socket = tls.connect(
      {
        host: name,
        port: 443,
        servername: name,
        rejectUnauthorized: false,
        timeout: 9000,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !Object.keys(cert).length) {
            socket.end();
            resolve({
              domain: name,
              status: "unknown",
              expiresAt: "",
              daysRemaining: null,
              error: "missing_certificate",
            });
            return;
          }
          const expiresAt = safeIso(cert.valid_to);
          const ms = Date.parse(String(expiresAt || ""));
          const daysRemaining = Number.isFinite(ms) ? Math.floor((ms - Date.now()) / 86400000) : null;
          socket.end();
          resolve({
            domain: name,
            status: sslStatusFromDays(daysRemaining),
            expiresAt,
            daysRemaining,
            error: "",
          });
        } catch (err) {
          socket.end();
          resolve({
            domain: name,
            status: "unknown",
            expiresAt: "",
            daysRemaining: null,
            error: String(err?.message || "ssl_parse_failed"),
          });
        }
      }
    );

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        domain: name,
        status: "unknown",
        expiresAt: "",
        daysRemaining: null,
        error: "ssl_timeout",
      });
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({
        domain: name,
        status: "unknown",
        expiresAt: "",
        daysRemaining: null,
        error: String(err?.message || "ssl_error"),
      });
    });
  });

const buildSslStatuses = async (domains) => {
  const list = normalizePrimaryDomains(domains || []);
  const out = [];
  for (const domain of list) {
    out.push(await checkSslDomain(domain));
  }
  return out;
};

const numberOrNull = (value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
};

const normalizeHealthPayload = (rawPayload, config) => {
  const raw = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const signals = raw.signals && typeof raw.signals === "object" ? raw.signals : {};
  const maintenance = raw.maintenance && typeof raw.maintenance === "object" ? raw.maintenance : {};

  const cpuPercent = numberOrNull(
    signals?.cpu?.percent ?? raw?.cpuPercent ?? raw?.cpu?.percent,
    0,
    100
  );
  const cpuAvg5mPercent = numberOrNull(
    signals?.cpu?.avg5mPercent ?? raw?.cpuAvg5mPercent ?? raw?.cpu?.avg5mPercent,
    0,
    100
  );

  const ramPercent = numberOrNull(
    signals?.ram?.percent ?? raw?.ramPercent ?? raw?.ram?.percent,
    0,
    100
  );
  const ramAvg5mPercent = numberOrNull(
    signals?.ram?.avg5mPercent ?? raw?.ramAvg5mPercent ?? raw?.ram?.avg5mPercent,
    0,
    100
  );

  const diskUsedPercent = numberOrNull(
    signals?.disk?.usedPercent ?? raw?.diskUsedPercent ?? raw?.disk?.usedPercent,
    0,
    100
  );
  const diskFreeGb = numberOrNull(
    signals?.disk?.freeGb ?? raw?.diskFreeGb ?? raw?.disk?.freeGb,
    0,
    1000000
  );
  const diskTotalGb = numberOrNull(
    signals?.disk?.totalGb ?? raw?.diskTotalGb ?? raw?.disk?.totalGb,
    0,
    1000000
  );

  const uptimeSeconds = numberOrNull(
    signals?.uptime?.seconds ?? raw?.uptimeSeconds ?? raw?.uptime?.seconds,
    0,
    10000000000
  );
  const lastRebootAt = safeIso(signals?.uptime?.lastRebootAt ?? raw?.lastRebootAt ?? raw?.uptime?.lastRebootAt);

  const pendingOsUpdates = numberOrNull(
    maintenance?.pendingOsUpdates ?? raw?.pendingOsUpdates,
    0,
    100000
  );

  const pleskRaw = maintenance?.pleskUpdatesAvailable ?? raw?.pleskUpdatesAvailable;
  const pleskUpdatesAvailable =
    typeof pleskRaw === "boolean"
      ? pleskRaw
      : (String(pleskRaw || "").trim().toLowerCase() === "yes"
        ? true
        : (String(pleskRaw || "").trim().toLowerCase() === "no" ? false : null));

  const sslSource = Array.isArray(maintenance?.ssl)
    ? maintenance.ssl
    : Array.isArray(raw?.ssl)
      ? raw.ssl
      : [];

  const ssl = sslSource
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const domain = normalizeDomain(item.domain || "");
      if (!domain) return null;
      const daysRemaining = numberOrNull(item.daysRemaining, -1000000, 1000000);
      const statusRaw = String(item.status || "").trim().toLowerCase();
      const status = ["valid", "expiring", "expired", "unknown"].includes(statusRaw)
        ? statusRaw
        : sslStatusFromDays(daysRemaining);
      return {
        domain,
        status,
        expiresAt: safeIso(item.expiresAt),
        daysRemaining,
        error: String(item.error || "").trim(),
      };
    })
    .filter(Boolean);

  return {
    generatedAt: safeIso(raw.generatedAt) || new Date().toISOString(),
    host: {
      hostname: normalizeText(raw?.host?.hostname || "", 180, config?.serverHost || DEFAULT_CONFIG.serverHost),
      os: normalizeText(raw?.host?.os || "", 180, config?.os || DEFAULT_CONFIG.os),
      controlPanel: normalizeText(raw?.host?.controlPanel || "", 120, config?.controlPanel || DEFAULT_CONFIG.controlPanel),
    },
    signals: {
      cpu: {
        percent: cpuPercent,
        avg5mPercent: cpuAvg5mPercent,
      },
      ram: {
        percent: ramPercent,
        avg5mPercent: ramAvg5mPercent,
      },
      disk: {
        usedPercent: diskUsedPercent,
        freeGb: diskFreeGb,
        totalGb: diskTotalGb,
      },
      uptime: {
        seconds: uptimeSeconds,
        lastRebootAt,
      },
    },
    maintenance: {
      pendingOsUpdates,
      pleskUpdatesAvailable,
      ssl,
    },
    raw,
  };
};

const evaluateRules = (health) => {
  const alerts = [];
  const diskUsed = Number(health?.signals?.disk?.usedPercent);
  if (Number.isFinite(diskUsed)) {
    if (diskUsed > 95) {
      alerts.push({
        id: "disk_critical",
        level: "critical",
        title: "Disk usage critical",
        detail: `Disk usage is ${diskUsed.toFixed(1)}% (threshold > 95%).`,
        signal: "disk",
      });
    } else if (diskUsed > 85) {
      alerts.push({
        id: "disk_warning",
        level: "warning",
        title: "Disk usage high",
        detail: `Disk usage is ${diskUsed.toFixed(1)}% (warning > 85%).`,
        signal: "disk",
      });
    }
  }

  const ramAvg = Number(health?.signals?.ram?.avg5mPercent);
  const ramCurrent = Number(health?.signals?.ram?.percent);
  const ramEffective = Number.isFinite(ramAvg) ? ramAvg : (Number.isFinite(ramCurrent) ? ramCurrent : null);
  if (Number.isFinite(ramEffective) && ramEffective > 90) {
    alerts.push({
      id: "ram_warning",
      level: "warning",
      title: "RAM sustained high",
      detail: `RAM sustained around ${ramEffective.toFixed(1)}% over 5 minutes (warning > 90%).`,
      signal: "ram",
    });
  }

  const cpuAvg = Number(health?.signals?.cpu?.avg5mPercent);
  const cpuCurrent = Number(health?.signals?.cpu?.percent);
  const cpuEffective = Number.isFinite(cpuAvg) ? cpuAvg : (Number.isFinite(cpuCurrent) ? cpuCurrent : null);
  if (Number.isFinite(cpuEffective) && cpuEffective > 90) {
    alerts.push({
      id: "cpu_warning",
      level: "warning",
      title: "CPU sustained high",
      detail: `CPU sustained around ${cpuEffective.toFixed(1)}% over 5 minutes (warning > 90%).`,
      signal: "cpu",
    });
  }

  return alerts;
};

const securityFindingsFromMaintenance = (maintenance) => {
  const out = [];
  const updates = Number(maintenance?.pendingOsUpdates);
  if (Number.isFinite(updates) && updates > 0) {
    out.push({
      id: "os_updates_pending",
      level: "warning",
      detail: `${updates} OS update(s) pending`,
    });
  }
  if (maintenance?.pleskUpdatesAvailable === true) {
    out.push({
      id: "plesk_updates_available",
      level: "warning",
      detail: "Plesk/WebPros updates are available",
    });
  }
  const sslRows = Array.isArray(maintenance?.ssl) ? maintenance.ssl : [];
  for (const row of sslRows) {
    const status = String(row?.status || "").toLowerCase();
    if (status === "expired") {
      out.push({
        id: `ssl_expired_${row.domain}`,
        level: "critical",
        detail: `SSL expired for ${row.domain}`,
      });
    } else if (status === "expiring") {
      out.push({
        id: `ssl_expiring_${row.domain}`,
        level: "warning",
        detail: `SSL expiring soon for ${row.domain}`,
      });
    }
  }
  return out;
};

const overallStatusFromAlerts = (alerts, securityFindings, fallback = "healthy") => {
  const rows = [...(Array.isArray(alerts) ? alerts : []), ...(Array.isArray(securityFindings) ? securityFindings : [])];
  let critical = false;
  let warning = false;
  for (const row of rows) {
    const level = String(row?.level || "").toLowerCase();
    if (level === "critical") critical = true;
    if (level === "warning" || level === "warn") warning = true;
  }
  if (critical) return "critical";
  if (warning) return "warning";
  return fallback;
};

const suggestedActions = (alerts, securityFindings) => {
  const steps = [];
  const hasDiskCritical = alerts.some((row) => row.id === "disk_critical");
  const hasDiskWarn = alerts.some((row) => row.id === "disk_warning");
  if (hasDiskCritical || hasDiskWarn) {
    steps.push("Free disk space now: rotate/delete large logs and remove unused backups.");
  }
  if (alerts.some((row) => row.id === "ram_warning")) {
    steps.push("Review active services/processes and restart or scale memory-hungry workloads.");
  }
  if (alerts.some((row) => row.id === "cpu_warning")) {
    steps.push("Inspect top CPU processes and schedule heavy jobs for off-peak windows.");
  }
  if (securityFindings.some((row) => row.id === "os_updates_pending")) {
    steps.push("Apply pending Ubuntu security updates (`apt update && apt upgrade`) during a maintenance window.");
  }
  if (securityFindings.some((row) => row.id === "plesk_updates_available")) {
    steps.push("Open Plesk updater and install pending WebPros/Plesk updates.");
  }
  if (securityFindings.some((row) => String(row.id || "").startsWith("ssl_"))) {
    steps.push("Renew or replace expiring SSL certificates for affected domains.");
  }
  if (!steps.length) {
    steps.push("No immediate action required.");
  }
  return steps;
};

const saveMonitorConfig = async ({ actorUserId, workspaceId, patch, token }) => {
  const current = await loadMonitorSecrets({ actorUserId, workspaceId });
  const nextConfig = mergeConfig(current.config, patch || {});

  await createSecret({
    actorUserId,
    workspaceId,
    connectorId: CONNECTOR_ID,
    name: SECRET_NAMES.config,
    value: JSON.stringify(nextConfig),
  });

  const tokenText = typeof token === "string" ? token.trim() : "";
  if (tokenText) {
    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: CONNECTOR_ID,
      name: SECRET_NAMES.token,
      value: tokenText,
    });
  }

  return {
    config: nextConfig,
    tokenSaved: Boolean(tokenText),
  };
};

const getMonitorContext = async ({ actorUserId, workspaceId, probeReady = true }) => {
  const [vaultState, secrets] = await Promise.all([
    getVaultState(),
    loadMonitorSecrets({ actorUserId, workspaceId }),
  ]);

  let probe = null;
  if (vaultState.unlocked && secrets.hasToken && secrets.config.monitorAgentUrl && probeReady) {
    probe = await probeMonitorEndpoint(secrets.config, secrets.token);
  }

  const gate = computeGate({
    vaultState,
    config: secrets.config,
    token: secrets.token,
    probe,
  });

  return {
    workspaceId,
    vaultState,
    config: secrets.config,
    token: secrets.token,
    hasToken: secrets.hasToken,
    gate,
    probe,
  };
};

const buildStatePayload = (context) => {
  const cfg = context?.config || DEFAULT_CONFIG;
  return {
    ok: true,
    workspaceId: String(context?.workspaceId || ""),
    gate: context?.gate || computeGate({ vaultState: { unlocked: false }, config: cfg, token: "", probe: null }),
    vault: {
      unlocked: Boolean(context?.vaultState?.unlocked),
      reason: String(context?.vaultState?.reason || ""),
      lastActivityAt: Number(context?.vaultState?.lastActivityAt || 0),
      idleLockMs: Number(context?.vaultState?.idleLockMs || 0),
    },
    config: {
      hostType: cfg.hostType,
      provider: cfg.provider,
      controlPanel: cfg.controlPanel,
      serverHost: cfg.serverHost,
      serverPort: cfg.serverPort,
      serverUser: cfg.serverUser,
      os: cfg.os,
      panelUrl: cfg.panelUrl,
      monitorAgentUrl: cfg.monitorAgentUrl,
      primaryDomains: normalizePrimaryDomains(cfg.primaryDomains),
      notifications: normalizeNotifications(cfg.notifications, DEFAULT_NOTIFICATIONS),
      hasAgentToken: Boolean(context?.hasToken),
    },
    install: {
      scriptPath: INSTALL_SCRIPT_PATH,
      oneLiner: buildInstallOneLiner(cfg),
    },
    schema: {
      id: "server-monitor-health-v1",
      path: "docs/server_monitor_health.schema.json",
    },
  };
};

const runMonitorCheck = async (context) => {
  const checkedAt = new Date().toISOString();
  const config = context?.config || DEFAULT_CONFIG;
  const token = String(context?.token || "").trim();
  const notifications = normalizeNotifications(config.notifications, DEFAULT_NOTIFICATIONS);

  const healthUrl = deriveAgentUrl(config.monitorAgentUrl, "health");
  if (!healthUrl || !token) {
    return {
      ok: false,
      checkedAt,
      status: "critical",
      alerts: [
        {
          id: "server_down",
          level: "critical",
          title: "Server monitor is not configured",
          detail: "Monitor URL or token is missing.",
          signal: "server",
        },
      ],
      securityFindings: [],
      suggestedActions: ["Add monitor credentials and install the monitor agent on the VPS."],
      signals: null,
      maintenance: null,
      notifications,
      notificationSignals: {
        diskFull: false,
        serverDown: true,
        securityWarning: false,
      },
      raw: null,
    };
  }

  let payload = null;
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: monitorAuthHeaders(token),
      cache: "no-store",
      signal: withTimeoutSignal(10000),
    });
    payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new Error(`Monitor endpoint failed (${response.status || 500})`);
    }
  } catch (err) {
    const detail = String(err?.message || "monitor_unreachable");
    return {
      ok: false,
      checkedAt,
      status: "critical",
      alerts: [
        {
          id: "server_down",
          level: "critical",
          title: "Server monitor is unreachable",
          detail,
          signal: "server",
        },
      ],
      securityFindings: [],
      suggestedActions: [
        "Verify the monitor service is running (`systemctl status agentc-plesk-monitor`).",
        "Check firewall rules and confirm the monitor URL/token are correct.",
      ],
      signals: null,
      maintenance: null,
      notifications,
      notificationSignals: {
        diskFull: false,
        serverDown: true,
        securityWarning: false,
      },
      raw: payload,
    };
  }

  const health = normalizeHealthPayload(payload, config);
  if ((!Array.isArray(health.maintenance.ssl) || !health.maintenance.ssl.length) && config.primaryDomains.length) {
    health.maintenance.ssl = await buildSslStatuses(config.primaryDomains);
  }

  const alerts = evaluateRules(health);
  const securityFindings = securityFindingsFromMaintenance(health.maintenance);
  const status = overallStatusFromAlerts(alerts, securityFindings, "healthy");

  return {
    ok: true,
    checkedAt,
    status,
    alerts,
    securityFindings,
    suggestedActions: suggestedActions(alerts, securityFindings),
    signals: health.signals,
    maintenance: health.maintenance,
    notifications,
    notificationSignals: {
      diskFull: alerts.some((row) => row.signal === "disk"),
      serverDown: false,
      securityWarning: securityFindings.length > 0,
    },
    raw: health.raw,
  };
};

module.exports = {
  CONNECTOR_ID,
  SECRET_NAMES,
  DEFAULT_CONFIG,
  DEFAULT_NOTIFICATIONS,
  INSTALL_SCRIPT_PATH,
  normalizeWorkspaceId,
  resolveWorkspaceId,
  ensureWorkspaceAdmin,
  normalizePrimaryDomains,
  normalizeNotifications,
  mergeConfig,
  getVaultState,
  unlockMonitorVault,
  saveMonitorConfig,
  getMonitorContext,
  buildStatePayload,
  runMonitorCheck,
};
