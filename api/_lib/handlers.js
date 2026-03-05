// node type handlers for pipeline engine.  Add new handler functions here and
// reference them in `pipeline_engine.js`.

const intake = async ({ run, node }) => {
  // intake may simply return input for now
  return { received: run.input };
};

const qualify = async ({ run, node }) => {
  // simple qualifier stub
  return { qualified: true };
};

const crm_sync = async ({ run, node }) => {
  // placeholder for CRM sync logic
  return { synced: true };
};

module.exports = {
  intake,
  qualify,
  crm_sync,
};
