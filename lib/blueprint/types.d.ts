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
  supportsOauthStart(): boolean;
  beginAuthorize(ctx: unknown): Promise<{ redirect: string }>;
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
