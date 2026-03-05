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
 * @property {(input: any, ctx: any) => Promise<{ connectionId: string }>} authorize
 * @property {(connectionId: string, ctx: any) => Promise<ConnectorTestResult>} test
 * @property {(connectionId: string, opts: ConnectorRequestOptions, ctx: any) => Promise<any>} request
 *
 * @typedef {Object} MailSsotConnectorRef
 * @property {"blueprint_connection"} type
 * @property {string} workspaceId
 * @property {"mailbox"} connectorId
 * @property {string} connectionId
 *
 * @typedef {Object} MailSsotSnapshotV1
 * @property {"agentc.mailssot.snapshot.v1"} schema
 * @property {string} planId
 * @property {number} revision
 * @property {string} capturedAt
 * @property {MailSsotConnectorRef[]} connectorRefs
 * @property {{
 *   draft: {
 *     objective: string,
 *     metric: string,
 *     horizon: "14"|"30"|"60"|"90",
 *     constraints: string,
 *     plan: string
 *   },
 *   tasks: Array<{
 *     id: string,
 *     title: string,
 *     owner: "me"|"codex",
 *     due: string,
 *     done: boolean,
 *     createdAt: number
 *   }>
 * }} strategic
 * @property {{
 *   tasks: Array<{
 *     id: string,
 *     title: string,
 *     dueAt: string,
 *     status: "todo"|"done",
 *     priority: "high"|"normal"|"low",
 *     notes: string,
 *     source: string,
 *     createdAt: number,
 *     updatedAt: number
 *   }>
 * }} followups
 * @property {{
 *   userEmail: string,
 *   botEmail: string,
 *   channel: string,
 *   events: any[]
 * }} mailMemory
 */

const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"];
const CONNECTOR_AUTH_TYPES = ["oauth2", "apiKey", "basic", "none"];

module.exports = {
  WORKSPACE_ROLES,
  CONNECTOR_AUTH_TYPES,
};
