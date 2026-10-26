'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { tools, toolsByName, dispatchTool } = require('../../backend/agent/tools');

const port = {
  describe: async entity => ({ entity, fields: {} }),
  list: async (entity, query) => ({ items: [{ id: 'o-1', entity }], total: 1, returned: 1, hasMore: false, nextCursor: null, truncated: false, query }),
  get: async (entity, id) => ({ id, entity }),
  search: async (entity, query) => ({ items: [], total: 0, returned: 0, hasMore: false, nextCursor: null, truncated: false, query }),
  prepareCreate: async (entity, changes) => ({ proposalId: 'p-1', action: 'create', entity, changes }),
  prepareUpdate: async (entity, id, changes) => ({ proposalId: 'p-2', action: 'update', entity, id, changes }),
  prepareDelete: async (entity, id) => ({ proposalId: 'p-3', action: 'delete', entity, id }),
  confirmMutation: async input => input,
};

test('metadata tools register all four entity read operations', () => {
  for (const name of ['describe_entity', 'list_records', 'get_record', 'search_records', 'prepare_create', 'prepare_update', 'prepare_delete']) {
    assert.ok(toolsByName[name], `missing ${name}`);
  }
  assert.ok(tools.length >= 7);
});

test('list_records returns the complete pagination envelope', async () => {
  const result = await dispatchTool('list_records', { entity: 'orders', all: true }, { agentDataPort: port, role: 'owner' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'o-1');
  assert.equal(result.query.all, true);
});

test('strict tool schema rejects unknown top-level arguments', async () => {
  await assert.rejects(
    dispatchTool('list_records', { entity: 'orders', unexpected: true }, { agentDataPort: port, role: 'owner' }),
    error => error.code === 'TOOL_ARGUMENT_INVALID' && Array.isArray(error.path),
  );
});

test('mutation tools only prepare proposals and do not confirm writes', async () => {
  const result = await dispatchTool('prepare_update', {
    entity: 'models', id: 'm-1', changes: { name: 'new name' },
  }, { agentDataPort: port, role: 'staff' });
  assert.equal(result.proposal.action, 'update');
  assert.equal(result.proposal.entity, 'models');
});

test('model and material domain tools are explicit and confirmation-gated', async () => {
  for (const name of ['list_models', 'get_model_detail', 'prepare_model_update', 'prepare_model_delete', 'list_materials', 'get_material_detail', 'prepare_material_create', 'prepare_material_update', 'prepare_material_delete']) {
    assert.ok(toolsByName[name], `missing ${name}`);
  }
  const modelList = await dispatchTool('list_models', { all: true }, { agentDataPort: port, role: 'viewer' });
  assert.equal(modelList.total, 1);
  const materialProposal = await dispatchTool('prepare_material_create', { changes: { type: 'PLA', brand: '测试' } }, { agentDataPort: port, role: 'staff' });
  assert.equal(materialProposal.proposal.action, 'create');
  assert.equal(materialProposal.proposal.entity, 'materials');
});

