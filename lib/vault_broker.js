const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getSecret: vaultGetSecret, listSecrets } = require("./vault");
const { kvGet, kvSet, kvDel, kvKeys } = require("./upstash_kv");

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const boolEnv = (value, fallback = false) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return Boolean(fallback);
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on" || raw === "y";
};

const toInt = (value, fallback) => {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

const clampInt = (value, min, max, fallback) => {
  const n = toInt(value, fallback);
  return Math.max(min, Math.min(max, n));
};

const SESSION_TTL_MS_DEFAULT = clampInt(firstEnv("VAULT_BROKER_SESSION_TTL_MS"), 60_000, 86_400_000, 10 * 60 * 1000);
const IDLE_LOCK_MS_DEFAULT = clampInt(firstEnv("VAULT_BROKER_IDLE_LOCK_MS"), 60_000, 86_400_000, 10 * 60 * 1000);
const AUDIT_MAX_DEFAULT = clampInt(firstEnv("VAULT_BROKER_AUDIT_MAX"), 20, 10_000, 500);
const ONE_TIME_DEFAULT = boolEnv(firstEnv("VAULT_BROKER_ONE_TIME_TOKEN"), false);
const STRICT_AUDIT = boolEnv(firstEnv("VAULT_BROKER_STRICT_AUDIT"), false);
const AUDIT_KEY_FROM_ENV = firstEnv("VAULT_BROKER_LOG_KEY", "VAULT_KEY");
const AUDIT_KEY_FILE_ENV = firstEnv("VAULT_BROKER_LOG_KEY_FILE");
const DISABLE_AUDIT_FILE_KEY = boolEnv(firstEnv("VAULT_BROKER_DISABLE_FILE_KEY"), false);

const KV_CONFIGURED = () => {
  const url = firstEnv("KV_REST_API_URL", "KV_RESTAPI_URL", "UPSTASH_REDIS_REST_URL");
  const token = firstEnv("KV_REST_API_TOKEN", "KV_RESTAPI_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
  return Boolean(url && token);
};

const KEY_PREFIX = "agentc:vault_broker:v1";
const STATE_KEY = `${KEY_PREFIX}:state`;
const SESSION_KEY_PREFIX = `${KEY_PREFIX}:session:`;
const AUDIT_KEY_PREFIX = `${KEY_PREFIX}:audit:`;
const AUDIT_INDEX_KEY = `${KEY_PREFIX}:audit:index`;

const memoryStore = {
  state: null,
  sessions: new Map(),
  audit: new Map(),
  auditIndex: [],
};
const toBase64Url = (buffer) =>
  String(Buffer.from(buffer).toString("base64"))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const buildDefaultAuditKeyFile = () => {
  const home = os.homedir();
  if (!home) return "";
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "AgentC", "vault_broker_log.key");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "AgentC", "vault_broker_log.key");
  }
  return path.join(home, ".agentc", "vault_broker_log.key");
};

const normalizeKeyMaterial = (raw) => String(raw || "").trim();

const ensureAuditKeyFile = (targetPath) => {
  const filePath = String(targetPath || "").trim();
  if (!filePath) return { material: "", source: "", filePath: "" };

  try {
    if (fs.existsSync(filePath)) {
      const existing = normalizeKeyMaterial(fs.readFileSync(filePath, "utf8"));
      if (existing) return { material: existing, source: "file", filePath };
    }
  } catch {
    // ignore and try create
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const generated = toBase64Url(crypto.randomBytes(48));
    fs.writeFileSync(filePath, `${generated}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // ignore chmod failures
    }
    return { material: generated, source: "file", filePath };
  } catch {
    return { material: "", source: "", filePath: "" };
  }
};

const resolveAuditKeyMaterial = () => {
  if (AUDIT_KEY_FROM_ENV) {
    return {
      material: normalizeKeyMaterial(AUDIT_KEY_FROM_ENV),
      source: "env",
      filePath: "",
      durable: true,
    };
  }

  if (!DISABLE_AUDIT_FILE_KEY) {
    const fileTarget = normalizeKeyMaterial(AUDIT_KEY_FILE_ENV) || buildDefaultAuditKeyFile();
    const fromFile = ensureAuditKeyFile(fileTarget);
    if (fromFile.material) {
      return {
        material: fromFile.material,
        source: "file",
        filePath: fromFile.filePath,
        durable: true,
      };
    }
  }

  return {
    material: "",
    source: "ephemeral",
    filePath: "",
    durable: false,
  };
};

const AUDIT_KEY_RESOLUTION = resolveAuditKeyMaterial();
const EPHEMERAL_AUDIT_KEY = crypto.randomBytes(32);
const auditKeyFingerprint = (() => {
  const base = AUDIT_KEY_RESOLUTION.material
    ? Buffer.from(AUDIT_KEY_RESOLUTION.material, "utf8")
    : EPHEMERAL_AUDIT_KEY;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 16);
})();

const nowMs = () => Date.now();

const makeError = (message, status = 500, details = null) => {
  const err = new Error(String(message || "Vault Broker error"));
  err.status = status;
  if (details != null) err.details = details;
  return err;
};

const normalizeSecretName = (name) =>
  String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_");

const permissionForSecret = (secretName) => `read:${normalizeSecretName(secretName)}`;

const normalizePermission = (value) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^read:(.+)$/i);
  if (!match || !match[1]) return "";
  return permissionForSecret(match[1]);
};

const actorAllowed = (actorType) => {
  const t = String(actorType || "").trim().toLowerCase();
  return t === "human" || t === "system";
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const readJson = async (key) => {
  if (!KV_CONFIGURED()) return null;
  const raw = await kvGet(key);
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null) return raw;
  const parsed = safeJsonParse(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
};

const writeJson = async (key, value, { exSeconds } = {}) => {
  if (!KV_CONFIGURED()) return;
  await kvSet(key, JSON.stringify(value), { exSeconds });
};

const deleteKey = async (key) => {
  if (!KV_CONFIGURED()) return;
  await kvDel(key);
};

const readState = async () => {
  if (!KV_CONFIGURED()) return memoryStore.state || null;
  return await readJson(STATE_KEY);
};

const writeState = async (state) => {
  if (!KV_CONFIGURED()) {
    memoryStore.state = state && typeof state === "object" ? { ...state } : null;
    return;
  }
  await writeJson(STATE_KEY, state || {});
};

const sessionKey = (sessionId) => `${SESSION_KEY_PREFIX}${sessionId}`;

const readSessionById = async (sessionId) => {
  if (!sessionId) return null;
  if (!KV_CONFIGURED()) return memoryStore.sessions.get(sessionId) || null;
  return await readJson(sessionKey(sessionId));
};

const writeSessionById = async (sessionId, session, exSeconds) => {
  if (!sessionId) return;
  if (!KV_CONFIGURED()) {
    memoryStore.sessions.set(sessionId, session);
    return;
  }
  await writeJson(sessionKey(sessionId), session, { exSeconds });
};

const deleteSessionById = async (sessionId) => {
  if (!sessionId) return;
  if (!KV_CONFIGURED()) {
    memoryStore.sessions.delete(sessionId);
    return;
  }
  await deleteKey(sessionKey(sessionId));
};

const clearAllSessions = async () => {
  if (!KV_CONFIGURED()) {
    memoryStore.sessions.clear();
    return;
  }
  const keys = await kvKeys(`${SESSION_KEY_PREFIX}*`);
  for (const key of keys) {
    await kvDel(key);
  }
};

const readAuditIndex = async () => {
  if (!KV_CONFIGURED()) return memoryStore.auditIndex.slice();
  const json = await readJson(AUDIT_INDEX_KEY);
  return Array.isArray(json?.ids) ? json.ids.map((x) => String(x || "")).filter(Boolean) : [];
};

const writeAuditIndex = async (ids) => {
  const clean = Array.isArray(ids) ? ids.map((x) => String(x || "")).filter(Boolean) : [];
  if (!KV_CONFIGURED()) {
    memoryStore.auditIndex = clean.slice();
    return;
  }
  await writeJson(AUDIT_INDEX_KEY, { ids: clean });
};

const auditCryptoKey = () => {
  if (AUDIT_KEY_RESOLUTION.material) {
    return crypto
      .createHash("sha256")
      .update(String(AUDIT_KEY_RESOLUTION.material), "utf8")
      .digest()
      .subarray(0, 32);
  }
  return EPHEMERAL_AUDIT_KEY;
};

const encryptAuditPayload = (payload) => {
  if (!AUDIT_KEY_RESOLUTION.material && STRICT_AUDIT) {
    throw makeError("Encrypted audit requires VAULT_BROKER_LOG_KEY/VAULT_KEY or a writable VAULT_BROKER_LOG_KEY_FILE.", 500);
  }
  const plaintext = Buffer.from(JSON.stringify(payload || {}), "utf8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", auditCryptoKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}::${enc.toString("base64")}::${tag.toString("base64")}`;
};

const decodeAuditPayload = (encrypted) => {
  const raw = String(encrypted || "").trim();
  if (!raw) return null;
  const [ivB, encB, tagB] = raw.split("::");
  if (!ivB || !encB || !tagB) return null;
  try {
    const iv = Buffer.from(ivB, "base64");
    const enc = Buffer.from(encB, "base64");
    const tag = Buffer.from(tagB, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", auditCryptoKey(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const parsed = safeJsonParse(out);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const writeAuditEvent = async (event) => {
  const payload = {
    timestamp: new Date(nowMs()).toISOString(),
    botId: String(event?.botId || "unknown"),
    secretName: String(event?.secretName || ""),
    action: String(event?.action || "unknown"),
    result: String(event?.result || "unknown"),
    reason: String(event?.reason || ""),
  };

  let encrypted = "";
  try {
    encrypted = encryptAuditPayload(payload);
  } catch (err) {
    if (STRICT_AUDIT) throw err;
    encrypted = "";
  }
  if (!encrypted) return;

  const id = `${nowMs()}_${crypto.randomBytes(6).toString("hex")}`;
  const key = `${AUDIT_KEY_PREFIX}${id}`;
  if (!KV_CONFIGURED()) {
    memoryStore.audit.set(id, encrypted);
    const next = [id, ...memoryStore.auditIndex].slice(0, AUDIT_MAX_DEFAULT);
    memoryStore.auditIndex = next;
    return;
  }

  await kvSet(key, encrypted);
  const prev = await readAuditIndex();
  const next = [id, ...prev].slice(0, AUDIT_MAX_DEFAULT);
  await writeAuditIndex(next);

  // Trim old entries from KV.
  const stale = prev.slice(AUDIT_MAX_DEFAULT - 1);
  for (const oldId of stale) {
    if (!oldId || next.includes(oldId)) continue;
    await kvDel(`${AUDIT_KEY_PREFIX}${oldId}`);
  }
};

const normalizeOpenAIKey = (raw) => {
  let value = String(raw || "").trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/^bearer\s+/i, "").trim();
  if (!value) return "";
  const match = value.match(/sk-(?:proj-)?[a-z0-9._-]+/i);
  if (match && match[0]) return String(match[0]).trim();
  return value;
};

const parseVaultSecretValue = (rawValue) => {
  const text = String(rawValue ?? "").trim();
  if (!text) return "";
  const parsed = safeJsonParse(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const inner = String(parsed.secret ?? parsed.value ?? "").trim();
    return normalizeOpenAIKey(inner) || inner;
  }
  return normalizeOpenAIKey(text) || text;
};

const openAiCandidateNames = () => {
  const fromEnv = String(firstEnv("VAULT_BROKER_OPENAI_SECRET_NAMES") || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const defaults = [
    "OPENAI_API_KEY",
    "open",
    "OPEN",
    "OPEN_AI_API_KEY",
    "OPEN_API_KEY",
    "OPENAI_KEY",
    "OPENAI_APIKEY",
    "openai_api_key",
  ];
  return Array.from(new Set([...fromEnv, ...defaults]));
};

const looksOpenAiLike = (nameOrLabel) => /openai|chatgpt|gpt|assistant/i.test(String(nameOrLabel || ""));

const resolveOpenAiSecret = async () => {
  const candidates = openAiCandidateNames();
  for (const name of candidates) {
    try {
      const raw = await vaultGetSecret(name);
      const value = parseVaultSecretValue(raw);
      if (value) return value;
    } catch {
      // continue
    }
  }

  let bestValue = "";
  let bestScore = -1;
  let names = [];
  try {
    names = await listSecrets();
  } catch {
    names = [];
  }

  for (const nameRaw of names) {
    const name = String(nameRaw || "").trim();
    if (!name) continue;
    let raw = null;
    try {
      raw = await vaultGetSecret(name);
    } catch {
      raw = null;
    }
    const value = parseVaultSecretValue(raw);
    if (!value) continue;

    const parsed = safeJsonParse(String(raw || ""));
    const label = String(parsed?.label || "").trim();
    const type = String(parsed?.type || "").trim().toLowerCase();
    let score = 0;
    if (looksOpenAiLike(name) || looksOpenAiLike(label)) score += 18;
    if (type === "api") score += 10;
    if (/^sk-(proj-)?/i.test(value)) score += 24;
    if (value.length > 20) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  }

  return bestScore >= 10 ? bestValue : "";
};

const parseCookieHeader = (header) => {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
};

const extractSessionTokenFromRequest = (req) => {
  const header =
    String(req?.headers?.["x-agentc-vault-session"] || "").trim() ||
    String(req?.headers?.["x-vault-session-token"] || "").trim();
  if (header) return header;
  const auth = String(req?.headers?.authorization || "").trim();
  const match = auth.match(/^vault-session\s+(.+)$/i);
  if (match && match[1]) return String(match[1]).trim();
  const cookies = parseCookieHeader(req?.headers?.cookie);
  return String(cookies.agentc_vault_session || "").trim();
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");

const createToken = () =>
  crypto
    .randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const ensureUnlockedAndActive = async ({ botId = "unknown", touch = false } = {}) => {
  const state = await readState();
  if (!state?.unlocked) return { ok: false, state: state || null, reason: "locked" };
  const lastActivityAt = Number(state.lastActivityAt || state.unlockedAt || 0);
  const idleMs = nowMs() - (Number.isFinite(lastActivityAt) ? lastActivityAt : 0);
  if (idleMs > IDLE_LOCK_MS_DEFAULT) {
    await lockVault({
      actorType: "system",
      actorId: "vault-broker:auto-lock",
      reason: "idle_timeout",
      botId,
    });
    return { ok: false, state: await readState(), reason: "idle_timeout" };
  }
  if (touch) {
    const next = {
      ...state,
      lastActivityAt: nowMs(),
    };
    await writeState(next);
    return { ok: true, state: next, reason: "" };
  }
  return { ok: true, state, reason: "" };
};

async function unlockVault(options = {}) {
  const actorType = String(options.actorType || "").trim().toLowerCase();
  const actorId = String(options.actorId || "unknown").trim() || "unknown";
  if (!actorAllowed(actorType)) throw makeError("unlockVault allowed only for human/system actors.", 403);

  const next = {
    unlocked: true,
    unlockedAt: nowMs(),
    lastActivityAt: nowMs(),
    lockReason: "",
    actorType,
    actorId,
  };
  await writeState(next);
  await writeAuditEvent({
    botId: actorId,
    secretName: "",
    action: "unlock_vault",
    result: "ok",
    reason: "",
  });
  return { ...next };
}

async function lockVault(options = {}) {
  const actorType = String(options.actorType || "").trim().toLowerCase();
  const actorId = String(options.actorId || "unknown").trim() || "unknown";
  const reason = String(options.reason || "manual").trim();
  if (!actorAllowed(actorType)) throw makeError("lockVault allowed only for human/system actors.", 403);

  await clearAllSessions();
  const next = {
    unlocked: false,
    unlockedAt: 0,
    lastActivityAt: 0,
    lockedAt: nowMs(),
    lockReason: reason,
    actorType,
    actorId,
  };
  await writeState(next);
  await writeAuditEvent({
    botId: String(options.botId || actorId || "unknown"),
    secretName: "",
    action: "lock_vault",
    result: "ok",
    reason,
  });
  return { ...next };
}

async function issueSessionToken(options = {}) {
  const actorType = String(options.actorType || "").trim().toLowerCase();
  const actorId = String(options.actorId || "unknown").trim() || "unknown";
  if (!actorAllowed(actorType)) throw makeError("issueSessionToken allowed only for human/system actors.", 403);

  const active = await ensureUnlockedAndActive({ botId: actorId, touch: true });
  if (!active.ok) throw makeError("Vault is locked.", 423, { reason: active.reason });

  const ttlMs = clampInt(options.ttlMs, 60_000, 86_400_000, SESSION_TTL_MS_DEFAULT);
  const now = nowMs();
  const expiresAt = now + ttlMs;
  const oneTime = typeof options.oneTime === "boolean" ? options.oneTime : ONE_TIME_DEFAULT;

  const permsRaw = Array.isArray(options.permissions) ? options.permissions : [permissionForSecret("OPENAI_API_KEY")];
  const permissions = Array.from(new Set(permsRaw.map(normalizePermission).filter(Boolean)));
  if (!permissions.length) throw makeError("At least one read permission is required.", 400);

  const botId = String(options.botId || "chat-assistant").trim() || "chat-assistant";
  const sessionToken = createToken();
  const sessionId = hashToken(sessionToken);
  const record = {
    id: sessionId,
    permissions,
    issuedAt: now,
    expiresAt,
    lastUsedAt: 0,
    oneTime: Boolean(oneTime),
    botId,
    actorId,
  };
  const ttlSeconds = Math.max(1, Math.ceil((ttlMs + IDLE_LOCK_MS_DEFAULT) / 1000));
  await writeSessionById(sessionId, record, ttlSeconds);
  await writeAuditEvent({
    botId,
    secretName: "",
    action: "issue_session_token",
    result: "ok",
    reason: "",
  });

  return {
    sessionToken,
    expiresAt,
    ttlMs,
    permissions,
    oneTime: Boolean(oneTime),
    botId,
  };
}

async function getSecret(secretName, sessionToken, options = {}) {
  const normalizedSecret = normalizeSecretName(secretName);
  const token = String(sessionToken || "").trim();
  const botId = String(options.botId || "chat-assistant").trim() || "chat-assistant";
  if (!normalizedSecret) throw makeError("secretName is required.", 400);
  if (!token) throw makeError("sessionToken is required.", 401);

  const active = await ensureUnlockedAndActive({ botId, touch: false });
  if (!active.ok) {
    await writeAuditEvent({
      botId,
      secretName: normalizedSecret,
      action: "get_secret",
      result: "denied",
      reason: active.reason || "locked",
    });
    throw makeError("Vault is locked.", 423, { reason: active.reason || "locked" });
  }

  const sessionId = hashToken(token);
  const record = await readSessionById(sessionId);
  if (!record || typeof record !== "object") {
    await writeAuditEvent({
      botId,
      secretName: normalizedSecret,
      action: "get_secret",
      result: "denied",
      reason: "invalid_session",
    });
    throw makeError("Invalid Vault session token.", 401);
  }

  const now = nowMs();
  if (Number(record.expiresAt || 0) <= now) {
    await deleteSessionById(sessionId);
    await writeAuditEvent({
      botId,
      secretName: normalizedSecret,
      action: "get_secret",
      result: "denied",
      reason: "session_expired",
    });
    throw makeError("Vault session token expired.", 401);
  }

  const needed = permissionForSecret(normalizedSecret);
  const perms = Array.isArray(record.permissions) ? record.permissions.map(normalizePermission).filter(Boolean) : [];
  if (!perms.includes(needed)) {
    await writeAuditEvent({
      botId,
      secretName: normalizedSecret,
      action: "get_secret",
      result: "denied",
      reason: "insufficient_permission",
    });
    throw makeError(`Session token missing permission ${needed}.`, 403);
  }

  let value = "";
  if (normalizedSecret === "OPENAI_API_KEY") {
    value = await resolveOpenAiSecret();
  } else {
    value = parseVaultSecretValue(await vaultGetSecret(normalizedSecret));
  }

  if (!value) {
    await writeAuditEvent({
      botId,
      secretName: normalizedSecret,
      action: "get_secret",
      result: "not_found",
      reason: "",
    });
    throw makeError(`Secret not found: ${normalizedSecret}`, 404);
  }

  if (record.oneTime) {
    await deleteSessionById(sessionId);
  } else {
    const ttlRemainingMs = Math.max(1_000, Number(record.expiresAt || now) - now);
    const ttlSeconds = Math.max(1, Math.ceil((ttlRemainingMs + IDLE_LOCK_MS_DEFAULT) / 1000));
    await writeSessionById(
      sessionId,
      {
        ...record,
        lastUsedAt: now,
      },
      ttlSeconds
    );
  }

  await writeState({
    ...(active.state || {}),
    unlocked: true,
    lastActivityAt: now,
  });

  await writeAuditEvent({
    botId,
    secretName: normalizedSecret,
    action: "get_secret",
    result: "ok",
    reason: record.oneTime ? "one_time_token" : "",
  });

  return value;
}

async function getStatus() {
  const active = await ensureUnlockedAndActive({ botId: "status-probe", touch: false });
  const state = active.state || {};
  return {
    unlocked: Boolean(active.ok && state?.unlocked),
    reason: active.ok ? "" : String(active.reason || "locked"),
    lastActivityAt: Number(state?.lastActivityAt || 0),
    idleLockMs: IDLE_LOCK_MS_DEFAULT,
    sessionTtlMs: SESSION_TTL_MS_DEFAULT,
    oneTimeDefault: ONE_TIME_DEFAULT,
    auditKeySource: AUDIT_KEY_RESOLUTION.source,
    auditKeyDurable: Boolean(AUDIT_KEY_RESOLUTION.durable),
    auditKeyFile: AUDIT_KEY_RESOLUTION.filePath || "",
    auditKeyFingerprint: auditKeyFingerprint,
  };
}

async function listAudit(options = {}) {
  const limit = clampInt(options.limit, 1, 200, 50);
  let ids = [];
  if (!KV_CONFIGURED()) {
    ids = memoryStore.auditIndex.slice(0, limit);
    return ids
      .map((id) => decodeAuditPayload(memoryStore.audit.get(id)))
      .filter((row) => row && typeof row === "object");
  }

  ids = (await readAuditIndex()).slice(0, limit);
  const out = [];
  for (const id of ids) {
    const enc = await kvGet(`${AUDIT_KEY_PREFIX}${id}`);
    const parsed = decodeAuditPayload(enc);
    if (parsed && typeof parsed === "object") out.push(parsed);
  }
  return out;
}

module.exports = {
  unlockVault,
  lockVault,
  issueSessionToken,
  getSecret,
  getStatus,
  listAudit,
  extractSessionTokenFromRequest,
  permissionForSecret,
  normalizeSecretName,
};
