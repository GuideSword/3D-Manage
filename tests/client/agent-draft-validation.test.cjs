'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderDraftSchema, normalizeOrderDraft, missingOrderDraftFields } = require('../../backend/agent/contracts/drafts');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('missing_fields 根据规范化后的实际值计算', () => {
  const draft = normalizeOrderDraft({ customer_name: ' 客户 ', items: [{ material_type: 'PLA', qty: '2', unit_price: '3' }], missing_fields: ['customer_name'] });
  assert.equal(draft.customer_name, '客户');
  assert.deepEqual(draft.missing_fields, []);
  assert.deepEqual(missingOrderDraftFields(draft), []);
});

test('草稿校验会标记真实缺失项并拒绝无订单行', () => {
  const draft = normalizeOrderDraft({ customer_name: ' ', items: [] });
  assert.deepEqual(draft.missing_fields, ['customer_name', 'items']);
  assert.equal(orderDraftSchema.safeParse({ customer_name: '客户', items: [] }).success, false);
});

test('数量和单价转换为有限数字，非法值保持缺失', () => {
  const draft = normalizeOrderDraft({ customer_name: '客户', items: [{ material_type: 'PLA', qty: '2.5', unit_price: '3.2' }, { material_type: 'ABS', qty: 'nope', unit_price: Infinity }] });
  assert.equal(draft.items[0].qty, 2.5);
  assert.equal(draft.items[0].unit_price, 3.2);
  assert.ok(draft.missing_fields.includes('items[1].qty'));
  assert.ok(draft.missing_fields.includes('items[1].unit_price'));
});

test('草稿确认卡使用实时校验并支持完整订单行字段', () => {
  const card = read('components/agent/DraftConfirmCard.js');
  assert.match(card, /missingOrderDraftFields\(editing\)/);
  assert.match(card, /normalizeDraftForClient\(editing\)/);
  for (const field of ['model_name', 'color', 'layer_height_mm', 'notes']) {
    assert.match(card, new RegExp(`updateItem\\(idx, '${field}'`));
  }
  assert.match(card, /删除订单行/);
  assert.match(card, /添加订单行/);
});

test('通用 mutation API 与提案确认卡已接入聊天', () => {
  const api = read('utils/agentApi.js');
  const screen = read('screens/AgentChatScreen.js');
  const card = read('components/agent/MutationConfirmCard.js');
  assert.match(api, /prepareMutation:/);
  assert.match(api, /confirmMutation:/);
  assert.match(api, /Idempotency-Key/);
  assert.match(screen, /mutation_proposal/);
  assert.match(screen, /mutation_result/);
  assert.match(screen, /<MutationConfirmCard/);
  assert.match(card, /HUMAN_CONFIRMATION_REQUIRED|确认执行/);
});
