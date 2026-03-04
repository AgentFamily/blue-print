"use strict";

const { listWorkspacesForUser, getUserRoleForWorkspace, getWorkspaceById } = require("../db");
const { BlueprintError } = require("../errors");

const listAccessibleWorkspaces = (userId) => {
  return listWorkspacesForUser(userId).map((ws) => ({
    id: ws.id,
    orgId: ws.orgId,
    name: ws.name,
    role: ws.role,
  }));
};

const assertWorkspaceAccess = (userId, workspaceId) => {
  const ws = getWorkspaceById(workspaceId);
  if (!ws) {
    throw new BlueprintError(404, "workspace_not_found", "Workspace not found");
  }
  const role = getUserRoleForWorkspace(userId, workspaceId);
  if (!role) {
    throw new BlueprintError(403, "workspace_forbidden", "No access to this workspace");
  }
  return {
    workspace: ws,
    role,
  };
};

module.exports = {
  listAccessibleWorkspaces,
  assertWorkspaceAccess,
};
