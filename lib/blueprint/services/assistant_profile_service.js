"use strict";

const SYSTEM_ASSISTANT_IDENTITY = "AgentC";

const SYSTEM_CHARACTER_PROFILES = Object.freeze([
  {
    id: "agentc_base",
    name: "AgentC Base",
    description: "Internal base shell for AgentC.",
    customizationLevel: 1,
    systemPromptSuffix:
      "You are operating in the AgentC base shell. Keep the response neutral, precise, and system-oriented.",
    active: false,
    isSystem: true,
    internalOnly: true,
  },
  {
    id: "miss_lead",
    name: "Miss.Lead",
    description: "Assistant Lady profile layered on top of AgentC.",
    customizationLevel: 100,
    systemPromptSuffix:
      "Active character profile: Miss.Lead. Keep the response sharp, polished, and operationally useful while preserving AgentC accuracy.",
    active: true,
    isSystem: true,
    internalOnly: false,
  },
]);

const normalizeProfileId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

const listAssistantProfiles = () =>
  SYSTEM_CHARACTER_PROFILES
    .filter((item) => item.internalOnly !== true)
    .map((item) => ({ ...item }));

const getAssistantProfile = (profileId) => {
  const target = normalizeProfileId(profileId);
  if (!target) return null;
  const found = SYSTEM_CHARACTER_PROFILES.find((item) => item.id === target);
  return found ? { ...found } : null;
};

const getDefaultAssistantProfile = () => ({ ...SYSTEM_CHARACTER_PROFILES[1] });

const resolveAssistantProfile = (profileId) => {
  const resolved = getAssistantProfile(profileId);
  return resolved || getDefaultAssistantProfile();
};

const buildAssistantIdentity = (profileId) => {
  const profile = resolveAssistantProfile(profileId);
  return {
    agentIdentity: SYSTEM_ASSISTANT_IDENTITY,
    characterProfileId: profile.id,
    displayLabel: `${SYSTEM_ASSISTANT_IDENTITY} • ${profile.name}`,
    profile,
  };
};

module.exports = {
  SYSTEM_ASSISTANT_IDENTITY,
  listAssistantProfiles,
  getAssistantProfile,
  getDefaultAssistantProfile,
  resolveAssistantProfile,
  buildAssistantIdentity,
};
