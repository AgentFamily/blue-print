process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-openai";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const chatHandler = require("../api/chat.js");
const { callHandler } = require("./test_utils");

const originalFetch = global.fetch;

const mockFetchSequence = (responses) => {
  let index = 0;
  global.fetch = async () => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      text: async () => JSON.stringify(next.body),
    };
  };
};

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("chat standard_send returns AgentC metadata", async () => {
  resetBlueprintDb();
  mockFetchSequence([
    {
      body: {
        choices: [{ message: { content: "Standard answer" } }],
      },
    },
  ]);

  const res = await callHandler(chatHandler, {
    method: "POST",
    headers: {},
    body: {
      messages: [{ role: "user", content: "Summarize this." }],
      characterProfileId: "miss_lead",
      executionMode: "standard_send",
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.agentIdentity, "AgentC");
  assert.equal(json.characterProfileId, "miss_lead");
  assert.equal(json.executionMode, "standard_send");
  assert.equal(json.displayLabel, "AgentC • Miss.Lead");
  assert.equal(json.message.content, "Standard answer");
});

test("chat ab_compare returns both lanes", async () => {
  resetBlueprintDb();
  mockFetchSequence([
    { body: { choices: [{ message: { content: "Lane A answer" } }] } },
    { body: { choices: [{ message: { content: "Lane B answer" } }] } },
  ]);

  const res = await callHandler(chatHandler, {
    method: "POST",
    headers: {},
    body: {
      messages: [{ role: "user", content: "Compare two answers." }],
      executionMode: "ab_compare",
      laneProfiles: [{ laneId: "A" }, { laneId: "B" }],
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(Array.isArray(json.lanes), true);
  assert.equal(json.lanes.length, 2);
  assert.equal(json.lanes[0].message.content, "Lane A answer");
  assert.equal(json.lanes[1].message.content, "Lane B answer");
});

test("chat auto_shoot evaluates both lanes and selects the winner", async () => {
  resetBlueprintDb();
  mockFetchSequence([
    { body: { choices: [{ message: { content: "Lane A answer" } }] } },
    { body: { choices: [{ message: { content: "Lane B answer" } }] } },
    {
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              selectedLane: "B",
              rationale: "Lane B is more precise.",
              scores: {
                A: { logical_correctness: 3, instruction_alignment: 3, precision: 3, usefulness: 3, guardrail_compliance: 4 },
                B: { logical_correctness: 5, instruction_alignment: 5, precision: 5, usefulness: 5, guardrail_compliance: 5 },
              },
            }),
          },
        }],
      },
    },
  ]);

  const res = await callHandler(chatHandler, {
    method: "POST",
    headers: {},
    body: {
      messages: [{ role: "user", content: "Choose the best response." }],
      executionMode: "auto_shoot",
      laneProfiles: [{ laneId: "A" }, { laneId: "B" }],
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.selectedLane, "B");
  assert.equal(json.evaluation.selectedLane, "B");
  assert.equal(Array.isArray(json.vaultRecordIds), true);
  assert.equal(json.vaultRecordIds.length >= 2, true);
});
