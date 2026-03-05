const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDefaultLayout,
  migrateLayout,
  applyWidgetSettings,
  reorderEnabledWidgets
} = require("../lib/dashboard_layout_model");

const REGISTRY = [
  {
    id: "assistant_chat",
    name: "Chat Assistant",
    defaultSize: "large",
    constraints: { minW: 6, minH: 12, maxW: 12, maxH: 64 },
    allowedRoles: ["user", "admin"],
    defaultProps: { title: "", refreshSec: 0, defaultH: 22 }
  },
  {
    id: "mail_memory_signal",
    name: "Mail Memory + Signaling",
    defaultSize: "large",
    constraints: { minW: 6, minH: 12, maxW: 12, maxH: 56 },
    allowedRoles: ["user", "admin"],
    defaultProps: { title: "", refreshSec: 0, defaultH: 20 }
  },
  {
    id: "secure_vault",
    name: "Secure Vault",
    defaultSize: "large",
    constraints: { minW: 6, minH: 12, maxW: 12, maxH: 56 },
    allowedRoles: ["user", "admin"],
    defaultProps: { title: "", refreshSec: 0, defaultH: 18 }
  }
];

test("settings persist through serialize + rehydrate", () => {
  const layout = buildDefaultLayout(REGISTRY, "user");
  const ok = applyWidgetSettings(layout, REGISTRY, "assistant_chat", {
    title: "Ops Chat",
    refreshSec: 45,
    visible: false,
    size: "custom",
    w: 8,
    h: 27
  });
  assert.equal(ok, true);

  const rehydrated = migrateLayout(JSON.parse(JSON.stringify(layout)), REGISTRY, "user");
  const widget = rehydrated.widgets.find((item) => item.id === "assistant_chat");
  assert.ok(widget);
  assert.equal(widget.settings.title, "Ops Chat");
  assert.equal(widget.settings.refreshSec, 45);
  assert.equal(widget.settings.visible, false);
  assert.equal(widget.settings.size, "custom");
  assert.equal(widget.w, 8);
  assert.equal(widget.h, 27);
});

test("drag reorder persists through serialize + rehydrate", () => {
  const layout = buildDefaultLayout(REGISTRY, "user");
  const changed = reorderEnabledWidgets(layout, "assistant_chat", "mail_memory_signal", false);
  assert.equal(changed, true);

  const rehydrated = migrateLayout(JSON.parse(JSON.stringify(layout)), REGISTRY, "user");
  const enabledIds = rehydrated.widgets.filter((item) => item.enabled).map((item) => item.id);
  assert.deepEqual(enabledIds, ["mail_memory_signal", "assistant_chat", "secure_vault"]);
});
