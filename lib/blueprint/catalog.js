"use strict";

const EXTRA_CONNECTOR_DEFINITIONS = [
  {
    id: "namecheap",
    label: "Namecheap",
    authType: "apiKey",
    scopes: ["domain:read", "pricing:read"],
    fields: [
      { name: "apiUser", type: "text", required: true, help: "Namecheap API user" },
      { name: "apiKey", type: "password", required: true, help: "Namecheap API key" },
      { name: "clientIp", type: "text", required: false, help: "Allowed client IP (optional)" },
    ],
    docsUrl: "https://www.namecheap.com/support/api/intro/",
  },
  {
    id: "autotrader",
    label: "Autotrader",
    authType: "apiKey",
    scopes: ["vehicles:read", "pricing:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "Autotrader partner API key" },
      { name: "partnerId", type: "text", required: false, help: "Partner identifier" },
    ],
    docsUrl: "https://developer.autotrader.com/",
  },
  {
    id: "myclickdealer",
    label: "MyClickDealer",
    authType: "apiKey",
    scopes: ["inventory:read", "dealer:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "MyClickDealer API key" },
      { name: "dealerId", type: "text", required: true, help: "Dealer identifier" },
    ],
    docsUrl: "https://www.myclickdealer.co.uk/",
  },
  {
    id: "booking",
    label: "Booking",
    authType: "apiKey",
    scopes: ["accommodations:read", "availability:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "Booking API key/token" },
      { name: "affiliateId", type: "text", required: false, help: "Affiliate identifier" },
    ],
    docsUrl: "https://developers.booking.com/",
  },
  {
    id: "skyscanner",
    label: "Skyscanner",
    authType: "apiKey",
    scopes: ["flights:read", "pricing:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "Skyscanner API key" },
      { name: "market", type: "text", required: false, help: "Market (e.g. UK, US)" },
    ],
    docsUrl: "https://developers.skyscanner.net/",
  },
  {
    id: "openai",
    label: "OpenAI",
    authType: "apiKey",
    scopes: ["responses:write", "models:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "OpenAI API key" },
      { name: "organization", type: "text", required: false, help: "Optional org/project id" },
    ],
    docsUrl: "https://platform.openai.com/docs",
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    authType: "oauth2",
    scopes: ["ads:write", "campaigns:read"],
    fields: [
      { name: "accessToken", type: "token", required: true, help: "Meta Ads access token" },
      { name: "adAccountId", type: "text", required: true, help: "Ad account id" },
    ],
    docsUrl: "https://developers.facebook.com/docs/marketing-apis/",
  },
  {
    id: "zillow",
    label: "Zillow",
    authType: "apiKey",
    scopes: ["property:read", "valuation:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "Zillow API key/token" },
      { name: "market", type: "text", required: false, help: "Target market/ZIP" },
    ],
    docsUrl: "https://www.zillowgroup.com/developers/",
  },
  {
    id: "rightmove",
    label: "Rightmove",
    authType: "apiKey",
    scopes: ["listings:read", "valuation:read"],
    fields: [
      { name: "apiKey", type: "password", required: true, help: "Rightmove API key/token" },
      { name: "branchId", type: "text", required: false, help: "Branch identifier" },
    ],
    docsUrl: "https://www.rightmove.co.uk/",
  },
];

const STRATEGIC_WIDGET_MANIFESTS = [
  {
    widgetId: "widget_domain_valuator",
    name: "Domain Valuator",
    version: "1.0.0",
    requiredConnectors: [
      { connectorId: "fasthosts", scopes: ["domain:read", "dns:read"], fields: ["apiKey"] },
      { connectorId: "namecheap", scopes: ["domain:read", "pricing:read"], fields: ["apiUser", "apiKey"] },
    ],
    runPolicy: { serverOnly: true },
    ui: { category: "Valuation" },
  },
  {
    widgetId: "widget_car_valuator",
    name: "Car Valuator",
    version: "1.0.0",
    requiredConnectors: [
      { connectorId: "autotrader", scopes: ["vehicles:read", "pricing:read"], fields: ["apiKey"] },
      { connectorId: "myclickdealer", scopes: ["inventory:read", "dealer:read"], fields: ["apiKey", "dealerId"] },
    ],
    runPolicy: { serverOnly: true },
    ui: { category: "Valuation" },
  },
  {
    widgetId: "widget_trip_finder",
    name: "Trip Finder",
    version: "1.0.0",
    requiredConnectors: [
      { connectorId: "booking", scopes: ["accommodations:read", "availability:read"], fields: ["apiKey"] },
      { connectorId: "skyscanner", scopes: ["flights:read", "pricing:read"], fields: ["apiKey"] },
    ],
    runPolicy: { serverOnly: true },
    ui: { category: "Finding" },
  },
  {
    widgetId: "widget_ad_generator",
    name: "Ad Generator",
    version: "1.0.0",
    requiredConnectors: [
      { connectorId: "openai", scopes: ["responses:write"], fields: ["apiKey"] },
      { connectorId: "meta_ads", scopes: ["ads:write", "campaigns:read"], fields: ["accessToken", "adAccountId"] },
    ],
    runPolicy: { serverOnly: true },
    ui: { category: "Marketing" },
  },
  {
    widgetId: "widget_property_evaluator",
    name: "Property Evaluator",
    version: "1.0.0",
    requiredConnectors: [
      { connectorId: "zillow", scopes: ["property:read", "valuation:read"], fields: ["apiKey"] },
      { connectorId: "rightmove", scopes: ["listings:read", "valuation:read"], fields: ["apiKey"] },
    ],
    runPolicy: { serverOnly: true },
    ui: { category: "Valuation" },
  },
];

const connectorToWidgets = () => {
  const out = new Map();
  for (const manifest of STRATEGIC_WIDGET_MANIFESTS) {
    for (const req of manifest.requiredConnectors || []) {
      const connectorId = String(req?.connectorId || "");
      if (!connectorId) continue;
      if (!out.has(connectorId)) out.set(connectorId, []);
      out.get(connectorId).push({
        widgetId: manifest.widgetId,
        name: manifest.name,
      });
    }
  }
  return out;
};

module.exports = {
  EXTRA_CONNECTOR_DEFINITIONS,
  STRATEGIC_WIDGET_MANIFESTS,
  connectorToWidgets,
};
