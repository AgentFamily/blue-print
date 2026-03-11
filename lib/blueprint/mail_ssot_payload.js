"use strict";

const { BlueprintError } = require("./errors");

const MAILSSOT_BODY_HEADER = "AGENTC_MAILSSOT_V1";

const normalizePlanId = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, "_")
    .slice(0, 120);

const normalizeRevision = (value) => {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1_000_000, n);
};

const normalizeIsoDate = (value, fallback) => {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms <= 0) return fallback || new Date().toISOString();
  return new Date(ms).toISOString();
};

const asBase64String = (value, fieldName) => {
  const text = String(value || "").trim();
  if (!text) {
    throw new BlueprintError(400, "validation", `${fieldName} is required`);
  }
  try {
    const roundtrip = Buffer.from(text, "base64").toString("base64");
    if (!roundtrip) throw new Error("invalid");
  } catch {
    throw new BlueprintError(400, "validation", `${fieldName} must be base64 encoded`);
  }
  return text;
};

const validateEncryptedEnvelope = (input) => {
  const source = input && typeof input === "object" ? input : null;
  if (!source) {
    throw new BlueprintError(400, "validation", "encryptedEnvelope must be an object");
  }

  const schema = String(source.schema || "").trim();
  const alg = String(source.alg || "").trim();
  if (schema !== "agentc.mailssot.envelope.v1") {
    throw new BlueprintError(400, "validation", "encryptedEnvelope.schema must be agentc.mailssot.envelope.v1");
  }
  if (alg !== "AES-GCM-256") {
    throw new BlueprintError(400, "validation", "encryptedEnvelope.alg must be AES-GCM-256");
  }

  return {
    schema,
    alg,
    iv: asBase64String(source.iv, "encryptedEnvelope.iv"),
    ciphertext: asBase64String(source.ciphertext, "encryptedEnvelope.ciphertext"),
    createdAt: normalizeIsoDate(source.createdAt, new Date().toISOString()),
  };
};

const encodeEnvelopeBody = (envelope) => {
  const serialized = JSON.stringify(envelope);
  const encoded = Buffer.from(serialized, "utf8").toString("base64");
  return `${MAILSSOT_BODY_HEADER}\n${encoded}`;
};

const parseEnvelopeBody = (bodyText) => {
  const text = String(bodyText || "");
  const lines = text.split(/\r?\n/).map((line) => String(line || "").trim());
  if (!lines.length || lines[0] !== MAILSSOT_BODY_HEADER) {
    throw new BlueprintError(400, "validation", "Snapshot body is not a MailSSOT payload");
  }

  const encoded = String(lines[1] || "").trim();
  if (!encoded) {
    throw new BlueprintError(400, "validation", "Snapshot body is missing envelope data");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new BlueprintError(400, "validation", "Snapshot body envelope is malformed");
  }
  return validateEncryptedEnvelope(parsed);
};

module.exports = {
  MAILSSOT_BODY_HEADER,
  normalizePlanId,
  normalizeRevision,
  normalizeIsoDate,
  validateEncryptedEnvelope,
  encodeEnvelopeBody,
  parseEnvelopeBody,
};
