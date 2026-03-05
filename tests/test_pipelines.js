// simple script to verify pipeline creation and run indexing
const { pipelines } = require("../api/_lib");

async function run() {
  console.log("existing definitions:", await pipelines.listDefinitions());
  const sample = {
    id: "test-pipe",
    name: "Test Pipe",
    version: 1,
    nodes: [{ id: "n1", type: "intake", next: [] }],
  };
  await pipelines.saveDefinition(sample);
  console.log("defs after save", await pipelines.listDefinitions());
  const run = await pipelines.createRun("test-pipe", { foo: "bar" });
  console.log("created run", run);
  console.log("get same run", await pipelines.getRun(run.runId));
}

run().catch((e) => { console.error(e); process.exit(1); });
