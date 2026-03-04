"use strict";

const { upsertManifest, listManifests, getManifestByWidgetId, deleteManifest } = require("../db");
const { BlueprintError } = require("../errors");
const { audit } = require("../audit");
const { listConnectors } = require("../connectors/registry");
const { STRATEGIC_WIDGET_MANIFESTS } = require("../catalog");

let z = null;
try {
  ({ z } = require("zod"));
} catch {
  z = null;
}

const CATEGORIES = [
  "Valuation",
  "Finding",
  "Marketing",
  "Operations",
  "Security",
  "Finance",
  "Other",
];

const zodManifestSchema = z
  ? z
      .object({
        widgetId: z.string().min(1),
        name: z.string().min(1),
        version: z.string().min(1),
        requiredConnectors: z
          .array(
            z.object({
              connectorId: z.string().min(1),
              scopes: z.array(z.string().min(1)).optional(),
              fields: z.array(z.string().min(1)).optional(),
            })
          )
          .default([]),
        runPolicy: z.object({
          serverOnly: z.literal(true),
        }),
        ui: z.object({
          category: z.enum(CATEGORIES),
        }),
      })
      .strict()
  : null;

const manualValidateManifest = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BlueprintError(400, "invalid_manifest", "Manifest must be an object");
  }
  const widgetId = String(input.widgetId || "").trim();
  const name = String(input.name || "").trim();
  const version = String(input.version || "").trim();
  if (!widgetId || !name || !version) {
    throw new BlueprintError(400, "invalid_manifest", "widgetId, name, version are required");
  }

  const requiredConnectorsRaw = Array.isArray(input.requiredConnectors) ? input.requiredConnectors : [];
  const requiredConnectors = requiredConnectorsRaw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BlueprintError(400, "invalid_manifest", `requiredConnectors[${index}] must be an object`);
    }
    const connectorId = String(item.connectorId || "").trim();
    if (!connectorId) {
      throw new BlueprintError(400, "invalid_manifest", `requiredConnectors[${index}].connectorId is required`);
    }
    const scopes = Array.isArray(item.scopes) ? item.scopes.map((x) => String(x || "")).filter(Boolean) : undefined;
    const fields = Array.isArray(item.fields) ? item.fields.map((x) => String(x || "")).filter(Boolean) : undefined;
    return {
      connectorId,
      ...(scopes ? { scopes } : {}),
      ...(fields ? { fields } : {}),
    };
  });

  if (!input.runPolicy || input.runPolicy.serverOnly !== true) {
    throw new BlueprintError(400, "invalid_manifest", "runPolicy.serverOnly must be true");
  }

  const category = String(input?.ui?.category || "").trim();
  if (!CATEGORIES.includes(category)) {
    throw new BlueprintError(400, "invalid_manifest", `ui.category must be one of ${CATEGORIES.join(", ")}`);
  }

  return {
    widgetId,
    name,
    version,
    requiredConnectors,
    runPolicy: { serverOnly: true },
    ui: { category },
  };
};

const validateManifest = (input) => {
  const knownConnectors = new Set(listConnectors().map((item) => String(item.id || "")));
  if (zodManifestSchema) {
    const parsed = zodManifestSchema.safeParse(input);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new BlueprintError(400, "invalid_manifest", "Manifest validation failed", details);
    }
    for (const req of parsed.data.requiredConnectors || []) {
      if (!knownConnectors.has(req.connectorId)) {
        throw new BlueprintError(400, "invalid_manifest", `Unknown connectorId '${req.connectorId}' in manifest`);
      }
    }
    return parsed.data;
  }
  const parsed = manualValidateManifest(input);
  for (const req of parsed.requiredConnectors || []) {
    if (!knownConnectors.has(req.connectorId)) {
      throw new BlueprintError(400, "invalid_manifest", `Unknown connectorId '${req.connectorId}' in manifest`);
    }
  }
  return parsed;
};

const ensureStrategicWidgetManifests = () => {
  for (const manifest of STRATEGIC_WIDGET_MANIFESTS) {
    if (!getManifestByWidgetId(manifest.widgetId)) {
      upsertManifest(manifest);
    }
  }
};

const listWidgetManifests = () => {
  ensureStrategicWidgetManifests();
  return listManifests();
};

const saveWidgetManifest = ({ actorUserId, manifest }) => {
  const parsed = validateManifest(manifest);
  const saved = upsertManifest(parsed);
  audit({
    actorUserId,
    workspaceId: "",
    action: "widget.manifest.upsert",
    targetType: "widget_manifest",
    targetId: saved.widgetId,
    meta: {
      version: saved.version,
      requiredConnectorCount: Array.isArray(saved.requiredConnectors) ? saved.requiredConnectors.length : 0,
    },
  });
  return saved;
};

const removeWidgetManifest = ({ actorUserId, widgetId }) => {
  const id = String(widgetId || "").trim();
  if (!id) {
    throw new BlueprintError(400, "invalid_widget_id", "widgetId is required");
  }
  const existed = deleteManifest(id);
  if (!existed) {
    throw new BlueprintError(404, "manifest_not_found", "Manifest not found");
  }
  audit({
    actorUserId,
    workspaceId: "",
    action: "widget.manifest.delete",
    targetType: "widget_manifest",
    targetId: id,
    meta: {},
  });
  return { ok: true };
};

const readWidgetManifest = (widgetId) => {
  ensureStrategicWidgetManifests();
  const manifest = getManifestByWidgetId(widgetId);
  if (!manifest) {
    throw new BlueprintError(404, "manifest_not_found", `Manifest not found for widget ${widgetId}`);
  }
  return manifest;
};

module.exports = {
  CATEGORIES,
  validateManifest,
  listWidgetManifests,
  saveWidgetManifest,
  removeWidgetManifest,
  readWidgetManifest,
};
