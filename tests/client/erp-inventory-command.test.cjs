const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventoryCommandController, isValidGramQuantity } = require('../../utils/inventoryCommandCore.cjs');

test('数量校验拒绝部分解析、负数和超出毫克精度的输入', () => {
  for (const value of ['1x', '1e3', '-1', '0', '1.0000', '0.0001', '', ' ', false, NaN, '9007199254741']) {
    assert.equal(isValidGramQuantity(value), false, String(value));
  }
  assert.equal(isValidGramQuantity('0', { allowZero: true }), true);
  assert.equal(isValidGramQuantity('0.001'), true);
  assert.equal(isValidGramQuantity('100.123'), true);
});

test('超时重试复用原键与内容，成功后不重复发送', async () => {
  let count = 0;
  const controller = createInventoryCommandController(() => `key-${++count}`);
  const keys = [];
  const send = async (body, key) => { keys.push(key); if (keys.length === 1) throw new Error('timeout'); return { id: 'txn' }; };
  await assert.rejects(controller.run('out', { lotId: 'a', qty: '80' }, 'server-a', send), /timeout/);
  assert.deepEqual(await controller.run('out', { qty: '80', lotId: 'a' }, 'server-a', send), { id: 'txn' });
  assert.deepEqual(keys, ['key-1', 'key-1']);
  assert.equal(await controller.run('out', { qty: '80', lotId: 'a' }, 'server-a', send), null);
});

test('结果未知时修改内容或服务器拒绝，明确拒绝后允许重新提交', async () => {
  let count = 0;
  const controller = createInventoryCommandController(() => `key-${++count}`);
  await assert.rejects(controller.run('out', { qty: '80' }, 'a', async () => { throw new Error('network'); }));
  await assert.rejects(controller.run('out', { qty: '81' }, 'a', async () => {}), { code: 'INVENTORY_RETRY_PENDING' });
  await assert.rejects(controller.run('out', { qty: '80' }, 'b', async () => {}), { code: 'INVENTORY_RETRY_PENDING' });
  await assert.rejects(controller.run('out', { qty: '80' }, 'a', async () => { throw Object.assign(new Error('库存不足'), { status: 409 }); }));
  const result = await controller.run('out', { qty: '20' }, 'a', async (body, key) => ({ key, body }));
  assert.equal(result.key, 'key-2');
});

test('并发点击仅发送一个请求，5xx 后仍复用幂等键', async () => {
  let finish;
  let calls = 0;
  const controller = createInventoryCommandController(() => 'once');
  const send = async () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); };
  const first = controller.run('create', { qty: '1' }, 'a', send);
  assert.equal(await controller.run('create', { qty: '1' }, 'a', send), null);
  finish({ id: 'lot' });
  await first;
  assert.equal(calls, 1);
  const retry = createInventoryCommandController(() => 'server-error-key');
  await assert.rejects(retry.run('create', {}, 'a', async () => { throw Object.assign(new Error('失败'), { status: 500 }); }));
  assert.equal(await retry.run('create', {}, 'a', async (body, key) => key), 'server-error-key');
});
