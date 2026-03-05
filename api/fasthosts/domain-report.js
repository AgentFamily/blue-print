"use strict";

const tls = require("tls");

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const queryValue = (req, name) => {
  if (req?.query && Object.prototype.hasOwnProperty.call(req.query, name)) {
    return String(req.query[name] || "").trim();
  }
  try {
    const url = new URL(String(req?.url || ""), "http://local");
    return String(url.searchParams.get(name) || "").trim();
  } catch {
    return "";
  }
};

const readJsonBody = async (req) => {
  if (req?.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", resolve);
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeDomain = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const stripped = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  if (!stripped || stripped.length > 253) return "";
  const pattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
  return pattern.test(stripped) ? stripped : "";
};

const withTimeoutSignal = (timeoutMs) => {
  const ms = Math.max(1, Number(timeoutMs) || 1);
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
};

const fetchJson = async (url, { timeoutMs = 10000, headers = {} } = {}) => {
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: withTimeoutSignal(timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    const err = new Error(`Upstream request failed (${response.status})`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
};

const safeDateIso = (value) => {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
};

const daysRemainingFromIso = (iso) => {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor((ms - Date.now()) / 86400000);
};

const extractVCardField = (entity, fieldNames) => {
  const wanted = new Set((Array.isArray(fieldNames) ? fieldNames : [fieldNames]).map((item) => String(item || "").toLowerCase()));
  const arr = Array.isArray(entity?.vcardArray) ? entity.vcardArray : [];
  const rows = Array.isArray(arr[1]) ? arr[1] : [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const key = String(row[0] || "").toLowerCase();
    if (!wanted.has(key)) continue;
    const value = row[3];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) {
      const text = value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
      if (text) return text;
    }
  }
  return "";
};

const extractRegistrarName = (rdap) => {
  const entities = Array.isArray(rdap?.entities) ? rdap.entities : [];
  for (const entity of entities) {
    const roles = Array.isArray(entity?.roles) ? entity.roles.map((item) => String(item || "").toLowerCase()) : [];
    if (!roles.includes("registrar")) continue;
    const org = extractVCardField(entity, ["org", "fn"]);
    if (org) return org;
  }
  return "";
};

const extractRdapEventDate = (rdap, actions) => {
  const events = Array.isArray(rdap?.events) ? rdap.events : [];
  const desired = new Set((Array.isArray(actions) ? actions : [actions]).map((item) => String(item || "").toLowerCase()));
  for (const event of events) {
    const action = String(event?.eventAction || "").toLowerCase();
    if (!desired.has(action)) continue;
    const iso = safeDateIso(event?.eventDate);
    if (iso) return iso;
  }
  return "";
};

const normalizeDnsAnswerValue = (type, value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (type === "TXT") return text.replace(/^"+|"+$/g, "");
  return text.replace(/\.$/, "");
};

const fetchDnsReport = async (domain) => {
  const types = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"];
  const records = {};
  const errors = {};
  let totalRecords = 0;

  for (const type of types) {
    records[type] = [];
    const endpoint = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`;
    try {
      const payload = await fetchJson(endpoint, {
        timeoutMs: 7000,
        headers: { Accept: "application/dns-json, application/json" }
      });
      const answers = Array.isArray(payload?.Answer) ? payload.Answer : [];
      const values = [];
      for (const answer of answers) {
        const data = normalizeDnsAnswerValue(type, answer?.data);
        if (!data) continue;
        if (!values.includes(data)) values.push(data);
      }
      records[type] = values;
      totalRecords += values.length;
    } catch (err) {
      errors[type] = String(err?.message || "Lookup failed");
    }
  }

  let status = "unknown";
  if (totalRecords > 0) status = "good";
  else if (Object.keys(errors).length === types.length) status = "critical";
  else status = "warn";

  return {
    status,
    source: "dns.google",
    records,
    totalRecords,
    errors
  };
};

const fetchWhoisReport = async (domain) => {
  const endpoint = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    const payload = await fetchJson(endpoint, {
      timeoutMs: 12000,
      headers: {
        Accept: "application/rdap+json, application/json"
      }
    });

    const registrar = extractRegistrarName(payload);
    const expiryDate = extractRdapEventDate(payload, ["expiration", "expiry", "expires"]);
    const registrationDate = extractRdapEventDate(payload, ["registration", "registered"]);
    const nameservers = Array.isArray(payload?.nameservers)
      ? payload.nameservers
        .map((item) => String(item?.ldhName || item?.unicodeName || "").trim().toLowerCase())
        .filter(Boolean)
      : [];

    return {
      status: "good",
      source: "rdap.org",
      registrar,
      expiryDate,
      registrationDate,
      nameservers,
      domainStatus: Array.isArray(payload?.status) ? payload.status.map((item) => String(item || "")).filter(Boolean) : []
    };
  } catch (err) {
    return {
      status: "critical",
      source: "rdap.org",
      registrar: "",
      expiryDate: "",
      registrationDate: "",
      nameservers: [],
      domainStatus: [],
      error: String(err?.message || "WHOIS lookup failed")
    };
  }
};

const fetchSslReport = async (domain) => {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
        timeout: 9000
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !Object.keys(cert).length) {
            socket.end();
            resolve({
              status: "critical",
              valid: false,
              source: "tls",
              error: "No SSL certificate returned by host."
            });
            return;
          }

          const validFrom = safeDateIso(cert.valid_from);
          const validTo = safeDateIso(cert.valid_to);
          const daysRemaining = daysRemainingFromIso(validTo);
          const now = Date.now();
          const notAfterMs = Date.parse(String(validTo || ""));
          const notBeforeMs = Date.parse(String(validFrom || ""));
          const isValidWindow = Number.isFinite(notAfterMs) && Number.isFinite(notBeforeMs) && notAfterMs > now && notBeforeMs <= now;
          let status = "critical";
          if (isValidWindow && daysRemaining != null && daysRemaining > 30) status = "good";
          else if (isValidWindow && daysRemaining != null && daysRemaining >= 0) status = "warn";

          const subjectCn = String(cert?.subject?.CN || "").trim();
          const issuerCn = String(cert?.issuer?.CN || cert?.issuer?.O || "").trim();

          socket.end();
          resolve({
            status,
            valid: Boolean(isValidWindow),
            source: "tls",
            subject: subjectCn,
            issuer: issuerCn,
            validFrom,
            validTo,
            daysRemaining
          });
        } catch (err) {
          socket.end();
          resolve({
            status: "critical",
            valid: false,
            source: "tls",
            error: String(err?.message || "SSL parse failed")
          });
        }
      }
    );

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        status: "critical",
        valid: false,
        source: "tls",
        error: "SSL check timed out"
      });
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({
        status: "critical",
        valid: false,
        source: "tls",
        error: String(err?.message || "SSL check failed")
      });
    });
  });
};

const buildExpiryHealth = (expiryIso) => {
  const daysRemaining = daysRemainingFromIso(expiryIso);
  if (daysRemaining == null) {
    return {
      date: "",
      daysRemaining: null,
      status: "unknown"
    };
  }
  if (daysRemaining < 0) {
    return {
      date: expiryIso,
      daysRemaining,
      status: "critical"
    };
  }
  if (daysRemaining <= 30) {
    return {
      date: expiryIso,
      daysRemaining,
      status: "warn"
    };
  }
  return {
    date: expiryIso,
    daysRemaining,
    status: "good"
  };
};

const severityScore = (status) => {
  const v = String(status || "").toLowerCase();
  if (v === "critical" || v === "error" || v === "bad") return 3;
  if (v === "warn" || v === "warning") return 2;
  if (v === "good" || v === "healthy" || v === "ok") return 1;
  return 0;
};

const overallHealth = (statuses) => {
  const list = Array.isArray(statuses) ? statuses : [];
  let max = 0;
  for (const status of list) {
    const score = severityScore(status);
    if (score > max) max = score;
  }
  if (max >= 3) return "critical";
  if (max >= 2) return "warn";
  if (max >= 1) return "good";
  return "unknown";
};

module.exports = async (req, res) => {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = method === "POST" ? (await readJsonBody(req)) || {} : {};
  const rawDomain = body?.domain || queryValue(req, "domain");
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    sendJson(res, 400, {
      ok: false,
      error: "A valid domain is required (e.g. example.com)."
    });
    return;
  }

  const [whois, dns, ssl] = await Promise.all([
    fetchWhoisReport(domain),
    fetchDnsReport(domain),
    fetchSslReport(domain)
  ]);

  const expiry = buildExpiryHealth(whois?.expiryDate || "");
  const indicators = {
    whois: whois?.status || "unknown",
    dns: dns?.status || "unknown",
    ssl: ssl?.status || "unknown",
    expiry: expiry?.status || "unknown"
  };

  const report = {
    domain,
    generatedAt: new Date().toISOString(),
    whois,
    dns,
    ssl,
    registrar: {
      name: String(whois?.registrar || "").trim() || "Unknown",
      source: whois?.source || "rdap.org"
    },
    expiry,
    health: {
      overall: overallHealth(Object.values(indicators)),
      indicators
    }
  };

  sendJson(res, 200, {
    ok: true,
    domain,
    report
  });
};
