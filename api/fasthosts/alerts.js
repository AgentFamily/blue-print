"use strict";

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

const normalizeCurrency = (value) => {
  const text = String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return text || "GBP";
};

const normalizeAmount = (value) => {
  const text = String(value == null ? "" : value).trim().replace(/[^0-9.\-]/g, "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};

const normalizeBillingType = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "renewal") return "renewal";
  if (raw === "payment") return "payment";
  if (raw === "domain") return "domain";
  return "invoice";
};

const normalizeStatus = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "paid") return "paid";
  if (raw === "dismissed") return "dismissed";
  return "open";
};

const levelFromDays = (days) => {
  const n = Number(days);
  if (!Number.isFinite(n)) return "info";
  if (n <= 3) return "critical";
  if (n <= 14) return "warn";
  return "info";
};

const levelRank = (level) => {
  const v = String(level || "").toLowerCase();
  if (v === "critical") return 3;
  if (v === "warn") return 2;
  if (v === "info") return 1;
  return 0;
};

const normalizeBillingAlerts = (value) => {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const row = source[i];
    if (!row || typeof row !== "object") continue;
    const title = String(row.title || row.label || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!title) continue;
    const dueAt = safeDateIso(row.dueAt || row.dueDate);
    const status = normalizeStatus(row.status);
    if (status !== "open") continue;
    const daysRemaining = daysRemainingFromIso(dueAt);
    if (daysRemaining != null && daysRemaining > 60) continue;
    out.push({
      id: String(row.id || `billing_${i + 1}`).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 96),
      source: "billing",
      type: normalizeBillingType(row.type),
      title,
      dueAt,
      daysRemaining,
      level: levelFromDays(daysRemaining),
      amount: normalizeAmount(row.amount),
      currency: normalizeCurrency(row.currency || "GBP"),
      details: String(row.notes || "").replace(/\s+/g, " ").trim().slice(0, 240),
      status,
    });
  }
  return out;
};

const buildSystemAlerts = (domain, report) => {
  const out = [];
  const safeReport = report && typeof report === "object" ? report : {};
  const activeDomain = normalizeDomain(domain || safeReport?.domain || "");

  const expiryIso = safeDateIso(safeReport?.expiry?.date || safeReport?.whois?.expiryDate);
  const expiryDays = Number.isFinite(Number(safeReport?.expiry?.daysRemaining))
    ? Number(safeReport.expiry.daysRemaining)
    : daysRemainingFromIso(expiryIso);
  if (expiryIso && Number.isFinite(expiryDays) && expiryDays <= 45) {
    out.push({
      id: `sys_domain_expiry_${activeDomain || "domain"}_${expiryIso.slice(0, 10)}`,
      source: "system",
      type: "domain_expiry",
      title: `Domain renewal due: ${activeDomain || "domain"}`,
      dueAt: expiryIso,
      daysRemaining: expiryDays,
      level: levelFromDays(expiryDays),
      details: `Domain expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}.`,
      status: "open",
    });
  }

  const sslIso = safeDateIso(safeReport?.ssl?.validTo);
  const sslDays = Number.isFinite(Number(safeReport?.ssl?.daysRemaining))
    ? Number(safeReport.ssl.daysRemaining)
    : daysRemainingFromIso(sslIso);
  if (sslIso && Number.isFinite(sslDays) && sslDays <= 45) {
    out.push({
      id: `sys_ssl_expiry_${activeDomain || "domain"}_${sslIso.slice(0, 10)}`,
      source: "system",
      type: "ssl_expiry",
      title: `SSL certificate nearing expiry: ${activeDomain || "domain"}`,
      dueAt: sslIso,
      daysRemaining: sslDays,
      level: levelFromDays(sslDays),
      details: `SSL validity ends in ${sslDays} day${sslDays === 1 ? "" : "s"}.`,
      status: "open",
    });
  }

  const overall = String(safeReport?.health?.overall || "").trim().toLowerCase();
  if (overall === "warn" || overall === "critical") {
    out.push({
      id: `sys_health_${overall}_${activeDomain || "domain"}`,
      source: "system",
      type: "health",
      title: `Domain health ${overall}: ${activeDomain || "domain"}`,
      dueAt: safeDateIso(safeReport?.generatedAt) || "",
      daysRemaining: null,
      level: overall === "critical" ? "critical" : "warn",
      details: "One or more FastHosts checks need attention.",
      status: "open",
    });
  }

  return out;
};

const summarize = (alerts) => {
  const rows = Array.isArray(alerts) ? alerts : [];
  const out = { total: 0, critical: 0, warn: 0, info: 0 };
  for (const row of rows) {
    out.total += 1;
    const level = String(row?.level || "").toLowerCase();
    if (level === "critical") out.critical += 1;
    else if (level === "warn") out.warn += 1;
    else out.info += 1;
  }
  return out;
};

const legacyListFromQuery = (req) => {
  const out = [];
  const invoiceDueAt = safeDateIso(queryValue(req, "invoiceDueAt"));
  const invoiceAmount = normalizeAmount(queryValue(req, "invoiceAmount"));
  if (invoiceDueAt) {
    out.push({
      id: "query_invoice_due",
      type: "invoice",
      title: "Upcoming invoice",
      dueAt: invoiceDueAt,
      amount: invoiceAmount,
      currency: normalizeCurrency(queryValue(req, "invoiceCurrency") || "GBP"),
      status: "open",
    });
  }
  const renewalDueAt = safeDateIso(queryValue(req, "renewalDueAt"));
  if (renewalDueAt) {
    out.push({
      id: "query_renewal_due",
      type: "renewal",
      title: "Upcoming renewal",
      dueAt: renewalDueAt,
      amount: null,
      currency: "GBP",
      status: "open",
    });
  }
  return out;
};

module.exports = async (req, res) => {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = method === "POST" ? ((await readJsonBody(req)) || {}) : {};
  const rawDomain = body?.domain || queryValue(req, "domain");
  const domain = rawDomain ? normalizeDomain(rawDomain) : "";
  if (rawDomain && !domain) {
    sendJson(res, 400, {
      ok: false,
      error: "domain must be a valid FQDN when provided.",
    });
    return;
  }

  const report = body?.report && typeof body.report === "object" ? body.report : null;
  const billingAlerts = normalizeBillingAlerts(
    (body?.billingAlerts && Array.isArray(body.billingAlerts)) ? body.billingAlerts : legacyListFromQuery(req)
  );
  const systemAlerts = buildSystemAlerts(domain, report);
  const alerts = [...systemAlerts, ...billingAlerts].sort((a, b) => {
    const rankDiff = levelRank(b?.level) - levelRank(a?.level);
    if (rankDiff !== 0) return rankDiff;
    const ad = Date.parse(String(a?.dueAt || "")) || Number.MAX_SAFE_INTEGER;
    const bd = Date.parse(String(b?.dueAt || "")) || Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });

  sendJson(res, 200, {
    ok: true,
    domain,
    generatedAt: new Date().toISOString(),
    summary: summarize(alerts),
    alerts,
  });
};

