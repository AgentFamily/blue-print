"use strict";

const crypto = require("crypto");
const { deriveKey } = require("../security");

const ALG = "aes-256-gcm";

const encryptText = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const key = deriveKey("vault");
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    alg: ALG,
    keyVersion: "v1",
  };
};

const decryptText = ({ ciphertext, iv, tag }) => {
  const key = deriveKey("vault");
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(String(iv || ""), "base64"));
  decipher.setAuthTag(Buffer.from(String(tag || ""), "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(ciphertext || ""), "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

const maskSecret = (value) => {
  const text = String(value || "");
  if (!text) return "***";
  if (text.length <= 6) return `${text[0] || "*"}***`;
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
};

module.exports = {
  encryptText,
  decryptText,
  maskSecret,
};
