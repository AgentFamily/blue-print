"use strict";

const {
  getUserByEmail,
  getUserById,
  verifyUserPassword,
  createSession,
  getSessionById,
  deleteSessionById,
  listWorkspacesForUser,
} = require("../db");
const { BlueprintError } = require("../errors");
const { signJwt, verifyJwt } = require("../security");
const { audit } = require("../audit");

const SESSION_TTL_SECONDS = 60 * 60 * 12;

const sanitizeUser = (user) => ({
  id: user.id,
  orgId: user.orgId,
  email: user.email,
  name: user.name,
});

const buildMePayload = (user) => {
  const workspaces = listWorkspacesForUser(user.id).map((item) => ({
    id: item.id,
    orgId: item.orgId,
    name: item.name,
    role: item.role,
  }));
  return {
    user: sanitizeUser(user),
    workspaces,
    roles: workspaces.map((item) => ({ workspaceId: item.id, role: item.role })),
  };
};

const loginWithPassword = ({ email, password, ip, userAgent }) => {
  const user = getUserByEmail(email);
  if (!user || !verifyUserPassword(user, password)) {
    throw new BlueprintError(401, "invalid_credentials", "Invalid email or password");
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const session = createSession({
    userId: user.id,
    expiresAt,
    ip,
    userAgent,
  });

  const jwt = signJwt({
    sub: user.id,
    sid: session.id,
    orgId: user.orgId,
  }, SESSION_TTL_SECONDS);

  audit({
    actorUserId: user.id,
    workspaceId: "",
    action: "auth.login",
    targetType: "session",
    targetId: session.id,
    meta: { ip: String(ip || ""), userAgent: String(userAgent || "") },
  });

  return {
    token: jwt,
    expiresAt,
    me: buildMePayload(user),
  };
};

const getSessionFromToken = (token) => {
  const payload = verifyJwt(token);
  const userId = String(payload?.sub || "");
  const sessionId = String(payload?.sid || "");
  if (!userId || !sessionId) {
    throw new BlueprintError(401, "invalid_session", "Session payload is missing subject/session id");
  }

  const session = getSessionById(sessionId);
  if (!session || session.userId !== userId) {
    throw new BlueprintError(401, "invalid_session", "Session not found");
  }

  const expiryMs = Date.parse(String(session.expiresAt || ""));
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    deleteSessionById(session.id);
    throw new BlueprintError(401, "session_expired", "Session has expired");
  }

  const user = getUserById(userId);
  if (!user) {
    throw new BlueprintError(401, "invalid_session", "Session user does not exist");
  }

  return {
    tokenPayload: payload,
    session,
    user,
    me: buildMePayload(user),
  };
};

const logoutSession = ({ actorUserId, token }) => {
  if (!token) return { ok: true, loggedOut: false };
  let payload = null;
  try {
    payload = verifyJwt(token);
  } catch {
    return { ok: true, loggedOut: false };
  }
  const sid = String(payload?.sid || "");
  if (!sid) return { ok: true, loggedOut: false };
  const deleted = deleteSessionById(sid);
  audit({
    actorUserId,
    workspaceId: "",
    action: "auth.logout",
    targetType: "session",
    targetId: sid,
    meta: { deleted: Boolean(deleted) },
  });
  return { ok: true, loggedOut: Boolean(deleted) };
};

module.exports = {
  loginWithPassword,
  getSessionFromToken,
  logoutSession,
};
