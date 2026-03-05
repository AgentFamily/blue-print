export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type ConnectorAuthType = "oauth2" | "apiKey" | "basic" | "none";

export interface ConnectorRequirementField {
  name: string;
  type: "text" | "password" | "url" | "token";
  required: boolean;
  help?: string;
}

export interface ConnectorRequirements {
  scopes?: string[];
  fields?: ConnectorRequirementField[];
  docsUrl?: string;
}

export interface ConnectorRequestOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ConnectorTestResult {
  ok: boolean;
  details?: string;
}

export interface Connector {
  id: string;
  label: string;
  authType: ConnectorAuthType;
  requirements(): ConnectorRequirements;
  authorize(input: unknown, ctx: unknown): Promise<{ connectionId: string }>;
  test(connectionId: string, ctx: unknown): Promise<ConnectorTestResult>;
  request(connectionId: string, opts: ConnectorRequestOptions, ctx: unknown): Promise<unknown>;
}

export interface WidgetManifest {
  widgetId: string;
  name: string;
  version: string;
  requiredConnectors: {
    connectorId: string;
    scopes?: string[];
    fields?: string[];
  }[];
  runPolicy: { serverOnly: true };
  ui: { category: "Valuation" | "Finding" | "Marketing" | "Operations" | "Security" | "Finance" | "Other" };
}

export interface MailSsotConnectorRef {
  type: "blueprint_connection";
  workspaceId: string;
  connectorId: "mailbox";
  connectionId: string;
}

export interface MailSsotSnapshotV1 {
  schema: "agentc.mailssot.snapshot.v1";
  planId: string;
  revision: number;
  capturedAt: string;
  connectorRefs: MailSsotConnectorRef[];
  strategic: {
    draft: {
      objective: string;
      metric: string;
      horizon: "14" | "30" | "60" | "90";
      constraints: string;
      plan: string;
    };
    tasks: Array<{
      id: string;
      title: string;
      owner: "me" | "codex";
      due: string;
      done: boolean;
      createdAt: number;
    }>;
  };
  followups: {
    tasks: Array<{
      id: string;
      title: string;
      dueAt: string;
      status: "todo" | "done";
      priority: "high" | "normal" | "low";
      notes: string;
      source: string;
      createdAt: number;
      updatedAt: number;
    }>;
  };
  mailMemory: {
    userEmail: string;
    botEmail: string;
    channel: string;
    events: unknown[];
  };
}
