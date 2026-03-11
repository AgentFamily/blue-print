process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const {
  recordBrowserJournalEntry,
  listJournal,
  rollupBrowserTranscript,
} = require("../lib/blueprint/services/browser_journal_service");

test("browser journal records entries and rolls them into a transcript record", () => {
  resetBlueprintDb();

  recordBrowserJournalEntry({
    workspaceId: "ws_core",
    sessionId: "sess_browser",
    url: "https://example.com",
    title: "Example",
    mode: "live",
    action: "navigate",
    result: "loaded",
    createdBy: "browser",
  });

  const entries = listJournal({ workspaceId: "ws_core", sessionId: "sess_browser", limit: 10 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Example");

  const out = rollupBrowserTranscript({
    workspaceId: "ws_core",
    sessionId: "sess_browser",
    dayKey: entries[0].createdAt,
    createdBy: "browser",
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.transcript.recordType, "browser_transcript");
});
