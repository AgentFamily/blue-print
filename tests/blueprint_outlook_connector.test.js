process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";
process.env.OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "outlook-client-id-test";
process.env.OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || "outlook-client-secret-test";
process.env.OUTLOOK_REDIRECT_URI =
  process.env.OUTLOOK_REDIRECT_URI || "https://agentc.blueprint.ai/api/connectors/oauth/callback";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb, getConnectionById } = require("../lib/blueprint/db");
const { createSecret, readSecretPlaintextForServer } = require("../lib/blueprint/vault/service");
const {
  authorizeConnector,
  testConnector,
} = require("../lib/blueprint/services/connector_service");
const { encodeEnvelopeBody } = require("../lib/blueprint/mail_ssot_payload");
const { getConnector } = require("../lib/blueprint/connectors/registry");
const {
  OUTLOOK_ACCESS_TOKEN_SECRET,
  OUTLOOK_EXPIRES_AT_SECRET,
} = require("../lib/blueprint/connectors/outlook_connector");

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
});

const makeFetchResponse = (status, body, headers = {}) => {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      forEach(fn) {
        for (const [key, value] of Object.entries(normalizedHeaders)) fn(value, key);
      },
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] || null;
      },
    },
    async json() {
      if (body == null || body === "") throw new Error("No JSON body");
      return typeof body === "string" ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body ?? "");
    },
  };
};

const envelope = () => ({
  schema: "agentc.mailssot.envelope.v1",
  alg: "AES-GCM-256",
  iv: Buffer.from("mailssot-iv", "utf8").toString("base64"),
  ciphertext: Buffer.from("{\"snapshot\":\"encrypted\"}", "utf8").toString("base64"),
  createdAt: new Date().toISOString(),
});

const authorizeOutlookConnection = async () => {
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(200, {
        access_token: "access_authorize",
        refresh_token: "refresh_authorize",
        scope: "openid offline_access Mail.ReadWrite Mail.Send",
        expires_in: 3600,
      });
    }
    if (href.includes("/me?$select=mail,userPrincipalName")) {
      return makeFetchResponse(200, {
        mail: "bot@blue-print.ai",
        userPrincipalName: "bot@blue-print.ai",
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  return authorizeConnector({
    connectorId: "outlook",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      code: "oauth_authorize_code",
    },
  });
};

test("outlook connector test refreshes expired tokens and validates mailbox access", async () => {
  resetBlueprintDb();
  const authorized = await authorizeOutlookConnection();

  await createSecret({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "outlook",
    name: OUTLOOK_EXPIRES_AT_SECRET,
    value: new Date(Date.now() - 60_000).toISOString(),
  });

  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(200, {
        access_token: "access_refreshed",
        refresh_token: "refresh_refreshed",
        scope: "openid offline_access Mail.ReadWrite Mail.Send",
        expires_in: 3600,
      });
    }
    if (href.includes("/me/mailFolders/inbox/messages")) {
      return makeFetchResponse(200, {
        value: [],
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const result = await testConnector({
    connectorId: "outlook",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  const storedToken = readSecretPlaintextForServer({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "outlook",
    name: OUTLOOK_ACCESS_TOKEN_SECRET,
  });
  assert.equal(storedToken, "access_refreshed");
});

test("outlook connector save enforces self-sent semantics and latest scans inbox then sent items", async () => {
  resetBlueprintDb();
  const authorized = await authorizeOutlookConnection();
  const connector = getConnector("outlook");
  const mailBody = encodeEnvelopeBody(envelope());

  await assert.rejects(
    () =>
      connector.request(
        authorized.connectionId,
        {
          method: "POST",
          path: "/mail/ssot/save",
          body: {
            planId: "plan_ops",
            subject: "AGENTC MailSSOT plan_ops r1",
            mailBody,
            from: "intruder@example.com",
          },
        },
        { actorUserId: "usr_demo", workspaceId: "ws_core" }
      ),
    /self-sent/
  );

  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const href = String(url);
    if (href.endsWith("/me/messages")) {
      return makeFetchResponse(201, {
        id: "immutable_message_1",
        createdDateTime: "2026-03-11T09:00:00.000Z",
      });
    }
    if (href.endsWith("/me/messages/immutable_message_1/send")) {
      return makeFetchResponse(202, null);
    }
    if (href.includes("/me/mailFolders/inbox/messages")) {
      return makeFetchResponse(200, {
        value: [
          {
            id: "ignored_mail",
            subject: "Other subject",
            body: { contentType: "text", content: "ignored" },
            from: { emailAddress: { address: "bot@blue-print.ai" } },
            toRecipients: [{ emailAddress: { address: "bot@blue-print.ai" } }],
            receivedDateTime: "2026-03-11T09:01:00.000Z",
          },
        ],
      });
    }
    if (href.includes("/me/mailFolders/sentitems/messages")) {
      return makeFetchResponse(200, {
        value: [
          {
            id: "immutable_message_1",
            subject: "AGENTC MailSSOT plan_ops r1",
            body: { contentType: "text", content: mailBody },
            from: { emailAddress: { address: "bot@blue-print.ai" } },
            toRecipients: [{ emailAddress: { address: "bot@blue-print.ai" } }],
            receivedDateTime: "2026-03-11T09:02:00.000Z",
            createdDateTime: "2026-03-11T09:00:00.000Z",
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const saved = await connector.request(
    authorized.connectionId,
    {
      method: "POST",
      path: "/mail/ssot/save",
      body: {
        planId: "plan_ops",
        subject: "AGENTC MailSSOT plan_ops r1",
        mailBody,
      },
    },
    { actorUserId: "usr_demo", workspaceId: "ws_core" }
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.messageId, "immutable_message_1");
  assert.equal(saved.from, "bot@blue-print.ai");
  assert.equal(saved.to, "bot@blue-print.ai");

  const latest = await connector.request(
    authorized.connectionId,
    {
      method: "GET",
      path: "/mail/ssot/latest",
      body: {
        planId: "plan_ops",
      },
    },
    { actorUserId: "usr_demo", workspaceId: "ws_core" }
  );
  assert.equal(latest.ok, true);
  assert.equal(latest.found, true);
  assert.equal(latest.messageId, "immutable_message_1");
  assert.equal(latest.meta.folderId, "sentitems");

  const draftRequest = requests.find((row) => row.url.endsWith("/me/messages"));
  const latestRequest = requests.find((row) => row.url.includes("/me/mailFolders/inbox/messages"));
  assert.equal(draftRequest.init.headers.Prefer, 'IdType="ImmutableId"');
  assert.equal(latestRequest.init.headers.Prefer, 'outlook.body-content-type="text"');
});

test("outlook connector marks connection error when refresh token is revoked", async () => {
  resetBlueprintDb();
  const authorized = await authorizeOutlookConnection();

  await createSecret({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "outlook",
    name: OUTLOOK_EXPIRES_AT_SECRET,
    value: new Date(Date.now() - 60_000).toISOString(),
  });

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(400, {
        error: "invalid_grant",
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const result = await testConnector({
    connectorId: "outlook",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, false);
  assert.equal(getConnectionById(authorized.connectionId)?.status, "error");
});
