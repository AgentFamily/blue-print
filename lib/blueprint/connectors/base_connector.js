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

  supportsOauthStart() {
    return this.beginAuthorize !== BaseConnector.prototype.beginAuthorize;
  }

  async beginAuthorize() {
    throw new BlueprintError(501, "not_implemented", `Connector ${this.id} beginAuthorize() not implemented`);
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
