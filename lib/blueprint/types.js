"use strict";

/**
 * @typedef {"owner"|"admin"|"member"|"viewer"} WorkspaceRole
 * @typedef {"oauth2"|"apiKey"|"basic"|"none"} ConnectorAuthType
 *
 * @typedef {Object} ConnectorRequirementField
 * @property {string} name
 * @property {"text"|"password"|"url"|"token"} type
 * @property {boolean} required
 * @property {string=} help
 *
 * @typedef {Object} ConnectorRequirements
 * @property {string[]=} scopes
 * @property {ConnectorRequirementField[]=} fields
 * @property {string=} docsUrl
 *
 * @typedef {Object} ConnectorRequestOptions
 * @property {string} method
 * @property {string} path
 * @property {Record<string, string>=} headers
 * @property {any=} body
 *
 * @typedef {Object} ConnectorTestResult
 * @property {boolean} ok
 * @property {string=} details
 *
 * @typedef {Object} Connector
 * @property {string} id
 * @property {string} label
 * @property {ConnectorAuthType} authType
 * @property {() => ConnectorRequirements} requirements
 * @property {() => boolean} supportsOauthStart
 * @property {(ctx: any) => Promise<{ redirect: string }>} beginAuthorize
 * @property {(input: any, ctx: any) => Promise<{ connectionId: string }>} authorize
 * @property {(connectionId: string, ctx: any) => Promise<ConnectorTestResult>} test
 * @property {(connectionId: string, opts: ConnectorRequestOptions, ctx: any) => Promise<any>} request
 */

const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"];
const CONNECTOR_AUTH_TYPES = ["oauth2", "apiKey", "basic", "none"];

module.exports = {
  WORKSPACE_ROLES,
  CONNECTOR_AUTH_TYPES,
};
