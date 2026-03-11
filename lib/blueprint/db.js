"use strict";

const crypto = require("crypto");

const nowIso = () => new Date().toISOString();

const state = {
  seeded: false,
  orgs: new Map(),
  users: new Map(),
  workspaces: new Map(),
  memberships: [],
  sessions: new Map(),
  connections: new Map(),
  vaultSecrets: new Map(),
  vaultRecords: new Map(),
  mailboxMessages: new Map(),
  authRequests: new Map(),
  browserJournal: [],
  serverActionPlans: new Map(),
  pipelineRuns: new Map(),
  manifests: new Map(),
  audits: [],
  connectorRequestLogs: [],
  counters: Object.create(null),
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const nextId = (prefix) => {
  const key = String(prefix || "id");
  const n = Number(state.counters[key] || 0) + 1;
  state.counters[key] = n;
  return `${key}_${String(n).padStart(6, "0")}`;
};

const hashPassword = (password, salt) => {
  const pwd = String(password || "");
  const s = String(salt || "");
  return crypto.pbkdf2Sync(pwd, s, 120000, 32, "sha256").toString("base64");
};

const seedIfNeeded = () => {
  if (state.seeded) return;
  state.seeded = true;

  const org = { id: "org_blueprint", name: "Blue-Print.AI", createdAt: nowIso() };
  state.orgs.set(org.id, org);

  const wsCore = { id: "ws_core", orgId: org.id, name: "Core Workspace", createdAt: nowIso() };
  const wsOps = { id: "ws_ops", orgId: org.id, name: "Ops Workspace", createdAt: nowIso() };
  state.workspaces.set(wsCore.id, wsCore);
  state.workspaces.set(wsOps.id, wsOps);

  const demoPassword = process.env.BLUEPRINT_DEMO_PASSWORD || "demo123!";
  const adminPassword = process.env.BLUEPRINT_ADMIN_PASSWORD || "admin123!";

  const demoSalt = "blueprint-demo-salt";
  const adminSalt = "blueprint-admin-salt";

  const demoUser = {
    id: "usr_demo",
    orgId: org.id,
    email: normalizeEmail(process.env.BLUEPRINT_DEMO_EMAIL || "demo@blueprint.ai"),
    name: "Demo User",
    passwordSalt: demoSalt,
    passwordHash: hashPassword(demoPassword, demoSalt),
    createdAt: nowIso(),
  };
  const adminUser = {
    id: "usr_admin",
    orgId: org.id,
    email: normalizeEmail(process.env.BLUEPRINT_ADMIN_EMAIL || "admin@blueprint.ai"),
    name: "Org Admin",
    passwordSalt: adminSalt,
    passwordHash: hashPassword(adminPassword, adminSalt),
    createdAt: nowIso(),
  };

  state.users.set(demoUser.id, demoUser);
  state.users.set(adminUser.id, adminUser);

  state.memberships.push(
    { userId: demoUser.id, workspaceId: wsCore.id, role: "owner" },
    { userId: demoUser.id, workspaceId: wsOps.id, role: "member" },
    { userId: adminUser.id, workspaceId: wsCore.id, role: "owner" },
    { userId: adminUser.id, workspaceId: wsOps.id, role: "owner" }
  );
};

const resetBlueprintDb = () => {
  state.seeded = false;
  state.orgs.clear();
  state.users.clear();
  state.workspaces.clear();
  state.memberships = [];
  state.sessions.clear();
  state.connections.clear();
  state.vaultSecrets.clear();
  state.vaultRecords.clear();
  state.mailboxMessages.clear();
  state.authRequests.clear();
  state.browserJournal = [];
  state.serverActionPlans.clear();
  state.pipelineRuns.clear();
  state.manifests.clear();
  state.audits = [];
  state.connectorRequestLogs = [];
  state.counters = Object.create(null);
  seedIfNeeded();
};

const listUsers = () => {
  seedIfNeeded();
  return Array.from(state.users.values());
};

const getUserByEmail = (email) => {
  seedIfNeeded();
  const e = normalizeEmail(email);
  for (const user of state.users.values()) {
    if (user.email === e) return user;
  }
  return null;
};

const getUserById = (userId) => {
  seedIfNeeded();
  return state.users.get(String(userId || "")) || null;
};

const verifyUserPassword = (user, password) => {
  if (!user || !user.passwordSalt || !user.passwordHash) return false;
  const supplied = hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(String(user.passwordHash), "utf8");
  const actual = Buffer.from(String(supplied), "utf8");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
};

const getWorkspaceById = (workspaceId) => {
  seedIfNeeded();
  return state.workspaces.get(String(workspaceId || "")) || null;
};

const listWorkspacesForUser = (userId) => {
  seedIfNeeded();
  const uid = String(userId || "");
  const rows = [];
  for (const membership of state.memberships) {
    if (membership.userId !== uid) continue;
    const ws = getWorkspaceById(membership.workspaceId);
    if (!ws) continue;
    rows.push({ ...ws, role: membership.role });
  }
  return rows;
};

const getUserRoleForWorkspace = (userId, workspaceId) => {
  seedIfNeeded();
  const uid = String(userId || "");
  const wid = String(workspaceId || "");
  const row = state.memberships.find((item) => item.userId === uid && item.workspaceId === wid);
  return row ? row.role : null;
};

const createSession = ({ userId, expiresAt, ip, userAgent }) => {
  seedIfNeeded();
  const id = nextId("sess");
  const session = {
    id,
    userId: String(userId || ""),
    expiresAt: String(expiresAt || nowIso()),
    ip: String(ip || ""),
    userAgent: String(userAgent || ""),
    createdAt: nowIso(),
  };
  state.sessions.set(id, session);
  return session;
};

const getSessionById = (sessionId) => {
  seedIfNeeded();
  return state.sessions.get(String(sessionId || "")) || null;
};

const deleteSessionById = (sessionId) => {
  seedIfNeeded();
  return state.sessions.delete(String(sessionId || ""));
};

const createConnection = ({ workspaceId, connectorId, status = "active", scopes = [], fields = [], createdBy }) => {
  seedIfNeeded();
  const id = nextId("conn");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    connectorId: String(connectorId || ""),
    status: String(status || "active"),
    scopes: Array.isArray(scopes) ? scopes.map((x) => String(x || "")).filter(Boolean) : [],
    fields: Array.isArray(fields) ? fields.map((x) => String(x || "")).filter(Boolean) : [],
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.connections.set(id, row);
  return row;
};

const updateConnection = (connectionId, patch) => {
  seedIfNeeded();
  const id = String(connectionId || "");
  const current = state.connections.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: nowIso(),
  };
  state.connections.set(id, next);
  return next;
};

const getConnectionById = (connectionId) => {
  seedIfNeeded();
  return state.connections.get(String(connectionId || "")) || null;
};

const listConnections = (workspaceId) => {
  seedIfNeeded();
  const wid = String(workspaceId || "");
  return Array.from(state.connections.values()).filter((item) => item.workspaceId === wid);
};

const findActiveConnection = (workspaceId, connectorId) => {
  seedIfNeeded();
  const wid = String(workspaceId || "");
  const cid = String(connectorId || "");
  for (const row of state.connections.values()) {
    if (row.workspaceId === wid && row.connectorId === cid && row.status === "active") return row;
  }
  return null;
};

const createVaultSecret = ({ workspaceId, connectorId, name, ciphertext, iv, tag, createdBy }) => {
  seedIfNeeded();
  const id = nextId("sec");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    connectorId: String(connectorId || ""),
    name: String(name || "").trim(),
    ciphertext: String(ciphertext || ""),
    iv: String(iv || ""),
    tag: String(tag || ""),
    keyVersion: "v1",
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
  };
  state.vaultSecrets.set(id, row);
  return row;
};

const updateVaultSecret = (secretId, patch) => {
  seedIfNeeded();
  const id = String(secretId || "");
  const current = state.vaultSecrets.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: nowIso(),
  };
  state.vaultSecrets.set(id, next);
  return next;
};

const findVaultSecretById = (secretId) => {
  seedIfNeeded();
  return state.vaultSecrets.get(String(secretId || "")) || null;
};

const findVaultSecretByName = (workspaceId, connectorId, name) => {
  seedIfNeeded();
  const wid = String(workspaceId || "");
  const cid = String(connectorId || "");
  const n = String(name || "").trim();
  for (const row of state.vaultSecrets.values()) {
    if (row.workspaceId === wid && row.connectorId === cid && row.name === n) return row;
  }
  return null;
};

const listVaultSecrets = (workspaceId) => {
  seedIfNeeded();
  const wid = String(workspaceId || "");
  return Array.from(state.vaultSecrets.values()).filter((item) => item.workspaceId === wid);
};

const deleteVaultSecretById = (secretId) => {
  seedIfNeeded();
  return state.vaultSecrets.delete(String(secretId || ""));
};

const createMailboxMessage = ({
  workspaceId,
  connectorId,
  connectionId,
  mailboxEmail,
  planId,
  from,
  to,
  subject,
  body,
  meta,
}) => {
  seedIfNeeded();
  const id = nextId("mailmsg");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    connectorId: String(connectorId || ""),
    connectionId: String(connectionId || ""),
    mailboxEmail: normalizeEmail(mailboxEmail),
    planId: String(planId || "").trim(),
    from: normalizeEmail(from),
    to: normalizeEmail(to),
    subject: String(subject || "").trim(),
    body: String(body || ""),
    meta: meta && typeof meta === "object" ? { ...meta } : {},
    createdAt: nowIso(),
  };
  state.mailboxMessages.set(id, row);
  return row;
};

const listMailboxMessages = ({ workspaceId, connectorId, connectionId, mailboxEmail, planId } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  const cid = String(connectorId || "").trim();
  const conn = String(connectionId || "").trim();
  const email = normalizeEmail(mailboxEmail);
  const plan = String(planId || "").trim();

  return Array.from(state.mailboxMessages.values())
    .filter((row) => {
      if (wid && row.workspaceId !== wid) return false;
      if (cid && row.connectorId !== cid) return false;
      if (conn && row.connectionId !== conn) return false;
      if (email && row.mailboxEmail !== email) return false;
      if (plan && row.planId !== plan) return false;
      return true;
    })
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
};

const getLatestMailboxMessage = (filters = {}) => listMailboxMessages(filters)[0] || null;

const createVaultRecord = ({
  workspaceId,
  recordType,
  title = "",
  status = "active",
  payload = {},
  meta = {},
  secretRefId = "",
  relatedIds = [],
  createdBy,
}) => {
  seedIfNeeded();
  const id = nextId("rec");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    recordType: String(recordType || "").trim(),
    title: String(title || "").trim().slice(0, 180),
    status: String(status || "active").trim().slice(0, 80) || "active",
    payload: payload && typeof payload === "object" ? payload : {},
    meta: meta && typeof meta === "object" ? meta : {},
    secretRefId: String(secretRefId || "").trim(),
    relatedIds: Array.isArray(relatedIds) ? relatedIds.map((item) => String(item || "").trim()).filter(Boolean) : [],
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.vaultRecords.set(id, row);
  return row;
};

const updateVaultRecord = (recordId, patch) => {
  seedIfNeeded();
  const id = String(recordId || "");
  const current = state.vaultRecords.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: nowIso(),
  };
  state.vaultRecords.set(id, next);
  return next;
};

const getVaultRecordById = (recordId) => {
  seedIfNeeded();
  return state.vaultRecords.get(String(recordId || "")) || null;
};

const listVaultRecords = ({ workspaceId = "", recordType = "", limit = 0 } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  const type = String(recordType || "").trim();
  let rows = Array.from(state.vaultRecords.values()).filter((item) => {
    if (wid && item.workspaceId !== wid) return false;
    if (type && item.recordType !== type) return false;
    return true;
  });
  rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (Number(limit) > 0) rows = rows.slice(0, Number(limit));
  return rows;
};

const createAuthRequest = ({
  workspaceId,
  code,
  kind,
  task,
  requester,
  receiver,
  channel,
  sessionSnapshot = {},
  status = "pending",
  decision = "",
  expiresAt,
  reviewer = {},
  createdBy,
  vaultRecordIds = [],
}) => {
  seedIfNeeded();
  const id = nextId("authreq");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    code: String(code || "").trim().toUpperCase(),
    kind: String(kind || "approval").trim().toLowerCase(),
    task: String(task || "").trim(),
    requester: normalizeEmail(requester || ""),
    receiver: normalizeEmail(receiver || ""),
    channel: String(channel || "").trim().toLowerCase(),
    sessionSnapshot: sessionSnapshot && typeof sessionSnapshot === "object" ? sessionSnapshot : {},
    status: String(status || "pending").trim().toLowerCase(),
    decision: String(decision || "").trim().toLowerCase(),
    reviewer: reviewer && typeof reviewer === "object" ? reviewer : {},
    vaultRecordIds: Array.isArray(vaultRecordIds) ? vaultRecordIds.map((item) => String(item || "").trim()).filter(Boolean) : [],
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: String(expiresAt || nowIso()),
    decidedAt: "",
  };
  state.authRequests.set(row.code, row);
  return row;
};

const getAuthRequestByCode = (code) => {
  seedIfNeeded();
  return state.authRequests.get(String(code || "").trim().toUpperCase()) || null;
};

const updateAuthRequest = (code, patch) => {
  seedIfNeeded();
  const key = String(code || "").trim().toUpperCase();
  const current = state.authRequests.get(key);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: nowIso(),
  };
  state.authRequests.set(key, next);
  return next;
};

const listAuthRequests = ({ workspaceId = "", status = "", limit = 0 } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  const wantedStatus = String(status || "").trim().toLowerCase();
  let rows = Array.from(state.authRequests.values()).filter((item) => {
    if (wid && item.workspaceId !== wid) return false;
    if (wantedStatus && item.status !== wantedStatus) return false;
    return true;
  });
  rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (Number(limit) > 0) rows = rows.slice(0, Number(limit));
  return rows;
};

const addBrowserJournalEntry = ({
  workspaceId,
  sessionId = "",
  url = "",
  title = "",
  mode = "",
  action = "",
  result = "",
  handoffKind = "",
  meta = {},
  createdBy = "",
}) => {
  seedIfNeeded();
  const row = {
    id: nextId("journal"),
    workspaceId: String(workspaceId || ""),
    sessionId: String(sessionId || "").trim(),
    url: String(url || "").trim(),
    title: String(title || "").trim().slice(0, 240),
    mode: String(mode || "").trim().toLowerCase(),
    action: String(action || "").trim().toLowerCase(),
    result: String(result || "").trim().toLowerCase(),
    handoffKind: String(handoffKind || "").trim().toLowerCase(),
    meta: meta && typeof meta === "object" ? meta : {},
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
  };
  state.browserJournal.push(row);
  return row;
};

const listBrowserJournalEntries = ({ workspaceId = "", sessionId = "", limit = 0 } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  const sid = String(sessionId || "").trim();
  let rows = state.browserJournal.filter((item) => {
    if (wid && item.workspaceId !== wid) return false;
    if (sid && item.sessionId !== sid) return false;
    return true;
  });
  rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (Number(limit) > 0) rows = rows.slice(0, Number(limit));
  return rows;
};

const createServerActionPlan = ({
  workspaceId,
  actionId,
  section = "approval",
  status = "pending_external",
  indicator = "amber",
  params = {},
  requiresHumanApproval = true,
  createdBy = "",
  reviewer = {},
  vaultRecordIds = [],
}) => {
  seedIfNeeded();
  const id = nextId("srvplan");
  const row = {
    id,
    workspaceId: String(workspaceId || ""),
    actionId: String(actionId || "").trim().toLowerCase(),
    section: String(section || "approval").trim().toLowerCase(),
    status: String(status || "pending_external").trim().toLowerCase(),
    indicator: String(indicator || "amber").trim().toLowerCase(),
    params: params && typeof params === "object" ? params : {},
    requiresHumanApproval: requiresHumanApproval !== false,
    reviewer: reviewer && typeof reviewer === "object" ? reviewer : {},
    vaultRecordIds: Array.isArray(vaultRecordIds) ? vaultRecordIds.map((item) => String(item || "").trim()).filter(Boolean) : [],
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.serverActionPlans.set(id, row);
  return row;
};

const updateServerActionPlan = (planId, patch) => {
  seedIfNeeded();
  const id = String(planId || "");
  const current = state.serverActionPlans.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: nowIso(),
  };
  state.serverActionPlans.set(id, next);
  return next;
};

const listServerActionPlans = ({ workspaceId = "", limit = 0 } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  let rows = Array.from(state.serverActionPlans.values()).filter((item) => !wid || item.workspaceId === wid);
  rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (Number(limit) > 0) rows = rows.slice(0, Number(limit));
  return rows;
};

const createPipelineRun = ({
  workspaceId,
  pipelineId,
  status = "completed",
  input = {},
  output = {},
  meta = {},
  createdBy = "",
}) => {
  seedIfNeeded();
  const id = nextId("pipe");
  const row = {
    id,
    runId: id,
    workspaceId: String(workspaceId || ""),
    pipelineId: String(pipelineId || "").trim().toLowerCase(),
    status: String(status || "completed").trim().toLowerCase(),
    input: input && typeof input === "object" ? input : {},
    output: output && typeof output === "object" ? output : {},
    meta: meta && typeof meta === "object" ? meta : {},
    createdBy: String(createdBy || ""),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.pipelineRuns.set(id, row);
  return row;
};

const listPipelineRuns = ({ workspaceId = "", pipelineId = "", limit = 0 } = {}) => {
  seedIfNeeded();
  const wid = String(workspaceId || "").trim();
  const pid = String(pipelineId || "").trim().toLowerCase();
  let rows = Array.from(state.pipelineRuns.values()).filter((item) => {
    if (wid && item.workspaceId !== wid) return false;
    if (pid && item.pipelineId !== pid) return false;
    return true;
  });
  rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (Number(limit) > 0) rows = rows.slice(0, Number(limit));
  return rows;
};

const upsertManifest = (manifest) => {
  seedIfNeeded();
  const widgetId = String(manifest?.widgetId || "").trim();
  if (!widgetId) return null;
  const existing = state.manifests.get(widgetId);
  const now = nowIso();
  const next = {
    ...(existing || {}),
    ...(manifest || {}),
    widgetId,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
  state.manifests.set(widgetId, next);
  return next;
};

const getManifestByWidgetId = (widgetId) => {
  seedIfNeeded();
  return state.manifests.get(String(widgetId || "")) || null;
};

const listManifests = () => {
  seedIfNeeded();
  return Array.from(state.manifests.values());
};

const deleteManifest = (widgetId) => {
  seedIfNeeded();
  return state.manifests.delete(String(widgetId || ""));
};

const addAudit = ({ actorUserId, workspaceId, action, targetType, targetId, meta }) => {
  seedIfNeeded();
  const row = {
    id: nextId("audit"),
    actorUserId: String(actorUserId || ""),
    workspaceId: String(workspaceId || ""),
    action: String(action || ""),
    targetType: String(targetType || ""),
    targetId: String(targetId || ""),
    meta: meta && typeof meta === "object" ? meta : {},
    timestamp: nowIso(),
  };
  state.audits.push(row);
  return row;
};

const listAudits = () => {
  seedIfNeeded();
  return state.audits.slice();
};

const addConnectorRequestLog = ({ workspaceId, connectorId, connectionId, status, latencyMs, rateLimitHeaders, meta }) => {
  seedIfNeeded();
  const row = {
    id: nextId("creq"),
    workspaceId: String(workspaceId || ""),
    connectorId: String(connectorId || ""),
    connectionId: String(connectionId || ""),
    status: Number(status || 0) || 0,
    latencyMs: Math.max(0, Number(latencyMs || 0) || 0),
    rateLimitHeaders: rateLimitHeaders && typeof rateLimitHeaders === "object" ? rateLimitHeaders : {},
    meta: meta && typeof meta === "object" ? meta : {},
    timestamp: nowIso(),
  };
  state.connectorRequestLogs.push(row);
  return row;
};

const listConnectorRequestLogs = () => {
  seedIfNeeded();
  return state.connectorRequestLogs.slice();
};

seedIfNeeded();

module.exports = {
  resetBlueprintDb,
  listUsers,
  getUserByEmail,
  getUserById,
  verifyUserPassword,
  getWorkspaceById,
  listWorkspacesForUser,
  getUserRoleForWorkspace,
  createSession,
  getSessionById,
  deleteSessionById,
  createConnection,
  updateConnection,
  getConnectionById,
  listConnections,
  findActiveConnection,
  createVaultSecret,
  updateVaultSecret,
  findVaultSecretById,
  findVaultSecretByName,
  listVaultSecrets,
  deleteVaultSecretById,
  createMailboxMessage,
  listMailboxMessages,
  getLatestMailboxMessage,
  createVaultRecord,
  updateVaultRecord,
  getVaultRecordById,
  listVaultRecords,
  createAuthRequest,
  getAuthRequestByCode,
  updateAuthRequest,
  listAuthRequests,
  addBrowserJournalEntry,
  listBrowserJournalEntries,
  createServerActionPlan,
  updateServerActionPlan,
  listServerActionPlans,
  createPipelineRun,
  listPipelineRuns,
  upsertManifest,
  getManifestByWidgetId,
  listManifests,
  deleteManifest,
  addAudit,
  listAudits,
  addConnectorRequestLog,
  listConnectorRequestLogs,
  nextId,
};
