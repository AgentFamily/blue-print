"use strict";

const {
  getUserRoleForWorkspace,
  createVaultSecret,
  updateVaultSecret,
  findVaultSecretById,
  findVaultSecretByName,
  listVaultSecrets,
  deleteVaultSecretById,
} = require("../db");
const { BlueprintError } = require("../errors");
const { audit } = require("../audit");
const { encryptText, decryptText, maskSecret } = require("./crypto");

const ensureWorkspaceAccess = (userId, workspaceId) => {
  const role = getUserRoleForWorkspace(userId, workspaceId);
  if (!role) {
    throw new BlueprintError(403, "workspace_forbidden", "User does not have workspace access");
  }
  return role;
};

const secretMetadata = (row) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  connectorId: row.connectorId,
  name: row.name,
  keyVersion: row.keyVersion,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastUsedAt: row.lastUsedAt,
  maskedValue: "***",
});

const createSecret = ({ actorUserId, workspaceId, connectorId, name, value }) => {
  ensureWorkspaceAccess(actorUserId, workspaceId);
  const secretName = String(name || "").trim();
  if (!secretName) {
    throw new BlueprintError(400, "invalid_secret", "Secret name is required");
  }
  const plain = String(value || "");
  if (!plain) {
    throw new BlueprintError(400, "invalid_secret", "Secret value is required");
  }

  const encrypted = encryptText(plain);
  const existing = findVaultSecretByName(workspaceId, connectorId, secretName);

  const row = existing
    ? updateVaultSecret(existing.id, {
        connectorId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
      })
    : createVaultSecret({
        workspaceId,
        connectorId,
        name: secretName,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        createdBy: actorUserId,
      });

  audit({
    actorUserId,
    workspaceId,
    action: existing ? "vault.secret.update" : "vault.secret.create",
    targetType: "vault_secret",
    targetId: row.id,
    meta: {
      connectorId: row.connectorId,
      name: row.name,
      maskedValue: maskSecret(plain),
    },
  });

  return {
    ...secretMetadata(row),
    plaintextOnce: plain,
  };
};

const listSecretMetadata = ({ actorUserId, workspaceId, connectorId }) => {
  ensureWorkspaceAccess(actorUserId, workspaceId);
  const rows = listVaultSecrets(workspaceId)
    .filter((row) => (connectorId ? row.connectorId === String(connectorId) : true))
    .map((row) => secretMetadata(row));
  return rows;
};

const updateSecret = ({ actorUserId, workspaceId, secretId, value }) => {
  ensureWorkspaceAccess(actorUserId, workspaceId);
  const row = findVaultSecretById(secretId);
  if (!row || row.workspaceId !== String(workspaceId)) {
    throw new BlueprintError(404, "secret_not_found", "Secret not found");
  }
  const plain = String(value || "");
  if (!plain) {
    throw new BlueprintError(400, "invalid_secret", "Secret value is required");
  }
  const encrypted = encryptText(plain);
  const next = updateVaultSecret(row.id, {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
  });

  audit({
    actorUserId,
    workspaceId,
    action: "vault.secret.update",
    targetType: "vault_secret",
    targetId: next.id,
    meta: {
      connectorId: next.connectorId,
      name: next.name,
      maskedValue: maskSecret(plain),
    },
  });

  return secretMetadata(next);
};

const deleteSecret = ({ actorUserId, workspaceId, secretId }) => {
  ensureWorkspaceAccess(actorUserId, workspaceId);
  const row = findVaultSecretById(secretId);
  if (!row || row.workspaceId !== String(workspaceId)) {
    throw new BlueprintError(404, "secret_not_found", "Secret not found");
  }
  deleteVaultSecretById(row.id);
  audit({
    actorUserId,
    workspaceId,
    action: "vault.secret.delete",
    targetType: "vault_secret",
    targetId: row.id,
    meta: {
      connectorId: row.connectorId,
      name: row.name,
    },
  });
  return { ok: true };
};

const readSecretPlaintextForServer = ({ actorUserId, workspaceId, connectorId, name }) => {
  // Server-only path; still requires workspace membership for actor context.
  ensureWorkspaceAccess(actorUserId, workspaceId);
  const row = findVaultSecretByName(workspaceId, connectorId, name);
  if (!row) {
    throw new BlueprintError(404, "secret_not_found", `Missing secret: ${name}`);
  }
  const plain = decryptText(row);
  updateVaultSecret(row.id, {
    lastUsedAt: new Date().toISOString(),
  });
  audit({
    actorUserId,
    workspaceId,
    action: "vault.secret.use",
    targetType: "vault_secret",
    targetId: row.id,
    meta: {
      connectorId: row.connectorId,
      name: row.name,
    },
  });
  return plain;
};

module.exports = {
  createSecret,
  listSecretMetadata,
  updateSecret,
  deleteSecret,
  readSecretPlaintextForServer,
  ensureWorkspaceAccess,
};
