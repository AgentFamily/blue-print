process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SYSTEM_ASSISTANT_IDENTITY,
  listAssistantProfiles,
  getDefaultAssistantProfile,
  buildAssistantIdentity,
} = require("../lib/blueprint/services/assistant_profile_service");

test("assistant profiles default to AgentC with Miss.Lead display label", () => {
  const profiles = listAssistantProfiles();
  assert.equal(Array.isArray(profiles), true);
  assert.equal(profiles.some((item) => item.id === "miss_lead"), true);

  const defaults = getDefaultAssistantProfile();
  assert.equal(defaults.id, "miss_lead");

  const identity = buildAssistantIdentity();
  assert.equal(identity.agentIdentity, SYSTEM_ASSISTANT_IDENTITY);
  assert.equal(identity.characterProfileId, "miss_lead");
  assert.equal(identity.displayLabel, "AgentC • Miss.Lead");
});
