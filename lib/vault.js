const crypto = require("crypto");
const { kvGet, kvSet, kvKeys } = require("./upstash_kv");

// vault encryption uses AES-256-GCM with a key supplied by environment
// variable VAULT_KEY.  You must set this to a 32-byte secret (base64 or raw
// string) in your deployment.  The same key is used for encrypt/decrypt.

const VAULT_KEY = process.env.VAULT_KEY || "";

function ensureKey() {
  if (!VAULT_KEY || VAULT_KEY.length < 32) {
    const err = new Error(
      "VAULT_KEY is not configured or too short (must be 32 bytes)"
    );
    err.status = 500;
    throw err;
  }
}

function encrypt(plaintext) {
  ensureKey();
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(VAULT_KEY, "utf8").slice(0, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store as base64 iv:cipher:tag
  return `${iv.toString("base64")}::${enc.toString("base64")}::${tag.toString("base64")}`;
}

function decrypt(str) {
  ensureKey();
  const [ivB, encB, tagB] = String(str || "").split("::");
  if (!ivB || !encB || !tagB) return null;
  const iv = Buffer.from(ivB, "base64");
  const enc = Buffer.from(encB, "base64");
  const tag = Buffer.from(tagB, "base64");
  const key = Buffer.from(VAULT_KEY, "utf8").slice(0, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

async function setSecret(name, value) {
  if (!name) throw new Error("Secret name required");
  const enc = encrypt(String(value));
  await kvSet(`vault:${name}`, enc);
  return true;
}

async function getSecret(name) {
  if (!name) return null;
  const enc = await kvGet(`vault:${name}`);
  if (enc == null) return null;
  try {
    return decrypt(String(enc));
  } catch {
    return null;
  }
}

async function deleteSecret(name) {
  if (!name) return false;
  // Upstash doesn't have a delete via kvFetch helper yet.  use kvFetch directly.
  const { kvFetch } = require("./upstash_kv");
  await kvFetch(["del", `vault:${name}`]);
  return true;
}

async function listSecrets() {
  const keys = await kvKeys("vault:*");
  return keys.map((k) => String(k).replace(/^vault:/, ""));
}

module.exports = {
  encrypt,
  decrypt,
  setSecret,
  getSecret,
  deleteSecret,
  listSecrets,
};
