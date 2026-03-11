process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const { loginWithPassword } = require("../lib/blueprint/services/auth_service");

const makeResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(payload) {
      this.body = payload == null ? "" : String(payload);
    },
  };
};

const callHandler = async (handler, req) => {
  const res = makeResponse();
  await handler(req, res);
  return res;
};

const authSessionCookie = () => {
  const out = loginWithPassword({
    email: process.env.BLUEPRINT_DEMO_EMAIL || "demo@blueprint.ai",
    password: process.env.BLUEPRINT_DEMO_PASSWORD || "demo123!",
    ip: "127.0.0.1",
    userAgent: "node-test",
  });
  return `bp_session=${encodeURIComponent(out.token)}`;
};

module.exports = {
  makeResponse,
  callHandler,
  authSessionCookie,
};
