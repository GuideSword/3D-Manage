// Agent tool registry.
// Aggregates all tool definitions from the sibling tool modules and
// exposes a `dispatchTool(name, args, ctx)` helper that:
//   1. looks up the tool by name,
//   2. validates the raw LLM-supplied args with the tool's Zod schema,
//   3. invokes the handler with (validatedArgs, ctx).
//
// The Orchestrator (Agent #4) calls `tools.map(t => ({ type: 'function',
// function: { name: t.name, description: t.description, parameters:
// t.parameters } }))` to convert these to OpenAI function-calling format.

const ordersTools = require('./orders');
const modelsTools = require('./models');
const inventoryTools = require('./inventory');
const extractTools = require('./extract');

const tools = [
  ...modelsTools, // search_models_by_keyword, search_models_semantic
  ...ordersTools, // list_orders, get_order_detail
  ...inventoryTools, // get_inventory_summary
  ...extractTools, // extract_order_draft
];

const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

/**
 * Dispatch a tool call by name.
 *
 * @param {string} name        tool name (must match a registered tool)
 * @param {unknown} args       raw args from the LLM (will be Zod-validated)
 * @param {object} ctx         execution context: { db, embed, userId }
 * @returns {Promise<unknown>} the tool's return value
 */
async function dispatchTool(name, args, ctx) {
  const tool = toolsByName[name];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const validated = tool.schema.parse(args);
  return tool.handler(validated, ctx);
}

module.exports = { tools, toolsByName, dispatchTool };
