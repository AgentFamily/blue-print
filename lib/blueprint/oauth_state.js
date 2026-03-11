"use strict";

const { BlueprintError } = require("./errors");
const { randomToken, signJwt, verifyJwt } = require("./security");

const OAUTH_STATE_TYPE = "blueprint.connector.oauth_state.v1";
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

const createConnectorOauthState = ({ connectorId, workspaceId, userId }) => {
  const payload = {
    typ: OAUTH_STATE_TYPE,
    jti: randomToken(12),
    connectorId: String(connectorId || "").trim(),
    workspaceId: String(workspaceId || "").trim(),
    userId: String(userId || "").trim(),
  };

  if (!payload.connectorId || !payload.workspaceId || !payload.userId) {
    throw new BlueprintError(400, "invalid_oauth_state", "connectorId, workspaceId, and userId are required");
  }

  return signJwt(payload, OAUTH_STATE_TTL_SECONDS);
};

const readConnectorOauthState = (state) => {
  let payload = null;
  try {
    payload = verifyJwt(state);
  } catch (err) {
    throw new BlueprintError(400, "invalid_oauth_state", "OAuth state is invalid or expired", {
      cause: String(err?.code || err?.message || "invalid_state"),
    });
  }

  if (payload?.typ !== OAUTH_STATE_TYPE) {
    throw new BlueprintError(400, "invalid_oauth_state", "OAuth state type is not recognized");
  }

  const connectorId = String(payload?.connectorId || "").trim();
  const workspaceId = String(payload?.workspaceId || "").trim();
  const userId = String(payload?.userId || "").trim();
  if (!connectorId || !workspaceId || !userId) {
    throw new BlueprintError(400, "invalid_oauth_state", "OAuth state is missing required fields");
  }

  return {
    connectorId,
    workspaceId,
    userId,
  };
};

module.exports = {
  OAUTH_STATE_TYPE,
  createConnectorOauthState,
  readConnectorOauthState,
};
