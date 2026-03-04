"use strict";

const { BlueprintError } = require("../errors");

class BaseConnector {
  constructor({ id, label, authType }) {
    this.id = String(id || "");
    this.label = String(label || "");
    this.authType = authType || "none";
  }

  requirements() {
    return { scopes: [], fields: [], docsUrl: "" };
  }

  async authorize() {
    throw new BlueprintError(501, "not_implemented", `Connector ${this.id} authorize() not implemented`);
  }

  async test() {
    throw new BlueprintError(501, "not_implemented", `Connector ${this.id} test() not implemented`);
  }

  async request() {
    throw new BlueprintError(501, "not_implemented", `Connector ${this.id} request() not implemented`);
  }
}

module.exports = {
  BaseConnector,
};
