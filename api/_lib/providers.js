// simple registry of supported providers and their connection patterns
// extend this object as you add new integrations. Each entry includes
// metadata required for OAuth (authorize/token URLs, default scopes) or
// for API-key validation steps.

const PROVIDERS = {
  hubspot: {
    type: "oauth",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    defaultScopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
    ],
  },
  google: {
    type: "oauth",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["openid", "email", "profile"],
  },
  cloudflare: {
    type: "apikey",
    validate: async (key) => {
      // lightweight validation: call a known Cloudflare endpoint
      // implementation omitted for brevity
      return true;
    },
  },
  // add more providers here
};

function getProviderConfig(name) {
  if (!name) return null;
  return PROVIDERS[String(name).toLowerCase()] || null;
}

module.exports = {
  getProviderConfig,
};
