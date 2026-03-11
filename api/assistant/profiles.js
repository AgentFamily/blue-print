"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson } = require("../../lib/blueprint/http");
const {
  listAssistantProfiles,
  getDefaultAssistantProfile,
  SYSTEM_ASSISTANT_IDENTITY,
} = require("../../lib/blueprint/services/assistant_profile_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.assistant.profiles" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const profiles = listAssistantProfiles();
    const defaults = getDefaultAssistantProfile();
    sendJson(res, 200, {
      ok: true,
      agentIdentity: SYSTEM_ASSISTANT_IDENTITY,
      defaultProfileId: defaults.id,
      displayLabel: `${SYSTEM_ASSISTANT_IDENTITY} • ${defaults.name}`,
      profiles,
    });
  });
};
