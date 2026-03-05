const test = require("node:test");
const assert = require("node:assert/strict");

const alertsHandler = require("../api/fasthosts/alerts.js");

const makeResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    body: "",
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(payload) {
      this.body = payload == null ? "" : String(payload);
    },
    headers,
  };
};

const callHandler = async (req) => {
  const res = makeResponse();
  await alertsHandler(req, res);
  return res;
};

test("fasthosts alerts API validates invalid domain", async () => {
  const res = await callHandler({
    method: "GET",
    url: "/api/fasthosts/alerts?domain=bad_domain",
    query: { domain: "bad_domain" },
  });
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(String(res.body || "{}"));
  assert.equal(payload.ok, false);
});

test("fasthosts alerts API returns billing + system alerts", async () => {
  const now = Date.now();
  const invoiceDue = new Date(now + (2 * 86400000)).toISOString();
  const domainExpiry = new Date(now + (5 * 86400000)).toISOString();
  const sslExpiry = new Date(now + (12 * 86400000)).toISOString();

  const res = await callHandler({
    method: "POST",
    url: "/api/fasthosts/alerts",
    body: {
      domain: "a-i-agency.com",
      report: {
        domain: "a-i-agency.com",
        generatedAt: new Date(now).toISOString(),
        health: { overall: "warn" },
        expiry: {
          date: domainExpiry,
          daysRemaining: 5,
          status: "warn",
        },
        ssl: {
          validTo: sslExpiry,
          daysRemaining: 12,
          status: "warn",
        },
      },
      billingAlerts: [
        {
          id: "invoice_1",
          type: "invoice",
          title: "Upcoming invoice",
          dueAt: invoiceDue,
          amount: "1.20",
          currency: "GBP",
          status: "open",
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(String(res.body || "{}"));
  assert.equal(payload.ok, true);
  assert.equal(payload.domain, "a-i-agency.com");
  assert.equal(Array.isArray(payload.alerts), true);
  assert.equal(payload.alerts.length >= 3, true);
  assert.equal(payload.summary.critical >= 1 || payload.summary.warn >= 1, true);
  assert.equal(payload.alerts.some((row) => row.source === "billing" && row.type === "invoice"), true);
  assert.equal(payload.alerts.some((row) => row.source === "system" && row.type === "domain_expiry"), true);
});

