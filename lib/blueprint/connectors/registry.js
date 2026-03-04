"use strict";

const { FasthostsConnector } = require("./fasthosts_connector");
const { MockApiConnector } = require("./mock_api_connector");
const { EXTRA_CONNECTOR_DEFINITIONS } = require("../catalog");
const { BlueprintError } = require("../errors");

const registry = new Map();

const registerConnector = (connector) => {
  if (!connector || !connector.id) {
    throw new Error("Cannot register connector without id");
  }
  registry.set(String(connector.id), connector);
  return connector;
};

const listConnectors = () =>
  Array.from(registry.values()).map((connector) => ({
    id: connector.id,
    label: connector.label,
    authType: connector.authType,
  }));

const getConnector = (connectorId) => {
  const connector = registry.get(String(connectorId || ""));
  if (!connector) {
    throw new BlueprintError(404, "connector_not_found", `Unknown connector: ${connectorId}`);
  }
  return connector;
};

registerConnector(new FasthostsConnector());
for (const def of EXTRA_CONNECTOR_DEFINITIONS) {
  registerConnector(new MockApiConnector(def));
}

module.exports = {
  registerConnector,
  listConnectors,
  getConnector,
};
