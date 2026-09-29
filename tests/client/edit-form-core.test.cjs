const test = require('node:test');
const assert = require('node:assert/strict');
const { orderToForm, formToOrderItems, isPositiveNumber } = require('../../utils/editFormCore.cjs');

test('历史模型、自定义颜色、订单行扩展资料回填再保存不丢失', () => {
  const original = { customer: { name: '客户', email: '', phone: '' }, dueDate: '2026-10-01',
    items: [{ id: 'line-7', modelId: 'deleted-model', modelName: '历史模型', color: '湖蓝', materialType: '自定义树脂',
      quantity: 2, unitPrice: 15, subtotal: 30, layerHeightMm: '0.2', externalFileUrl: 'protected-file', notes: '规格备注' }] };
  const { form, items } = orderToForm(original);
  assert.equal(form.dueDate.getDate(), 1);
  assert.equal(items[0].customColor, '湖蓝');
  items[0].quantity = '3';
  const saved = formToOrderItems(items, []);
  assert.deepEqual(saved[0], { ...original.items[0], quantity: 3, subtotal: 45 });
  assert.equal(original.items[0].quantity, 2);
});

test('价格与数量必须是完整的有限正数', () => {
  for (const value of ['', ' ', '1abc', 'Infinity', 'NaN', '-1', 0, true, false, [], {}]) assert.equal(isPositiveNumber(value), false);
  for (const value of ['0.01', '2', 100]) assert.equal(isPositiveNumber(value), true);
});

test('增删订单行不会重复已有行 ID，未更换模型时保留历史名称快照', () => {
  const saved = formToOrderItems([
    { id: '2', modelId: 'm1', modelName: '旧名称', color: '金色', quantity: '1', unitPrice: '5' },
    { modelId: 'm1', color: '红色', quantity: '2', unitPrice: '5' },
  ], [{ id: 'm1', name: '新名称' }]);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.equal(saved[0].modelName, '旧名称');
  assert.equal(saved[1].modelName, '新名称');
});
