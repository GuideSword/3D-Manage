'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../../.tmp/erp-release-acceptance');
const context = JSON.parse(fs.readFileSync(path.join(directory, 'fixture-context.json')));
assert.equal(context.base, 'http://127.0.0.1:5812/api');
const headers = { Authorization: 'Bearer ' + context.token, 'Content-Type': 'application/json' };
async function call(endpoint, method = 'GET', body) {
  const response = await fetch(context.base + endpoint, { method, headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, endpoint + ': ' + response.status);
  return response.json();
}
async function snapshot() {
  const state = {};
  for (const [name, endpoint] of Object.entries({ order: '/orders/' + context.orderId, material: '/materials/' + context.materialId, model: '/models/' + context.modelId, lot: '/stock/lots/' + context.lotId, users: '/users' })) state[name] = await call(endpoint);
  const file = await fetch(context.base + '/files/' + context.attachment.fileKey, { headers });
  assert.equal(file.status, 200);
  state.fileSha256 = crypto.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
  assert.equal(state.fileSha256, context.attachment.sha256);
  return state;
}
async function main() {
  const mode = process.argv[2];
  const snapshotPath = path.join(directory, 'recovery-snapshot.json');
  const info = await call('/system/info');
  assert.equal(info.organizationName, 'ERP隔离发布验收');
  assert.equal(info.serverId, context.serverId);
  if (mode === 'snapshot') fs.writeFileSync(snapshotPath, JSON.stringify(await snapshot(), null, 2));
  else if (mode === 'mutate') {
    await call('/orders/' + context.orderId, 'PATCH', { notes: 'changed-after-backup' });
    await call('/stock/inventory/txns', 'POST', { lotId: context.lotId, type: 'out', qty: 100, orderId: context.orderId });
    fs.appendFileSync(path.join(directory, 'runtime/uploads', context.attachment.fileKey), 'changed-after-backup');
    assert.equal((await call('/stock/lots/' + context.lotId)).qty, 400);
  } else if (mode === 'verify') assert.deepEqual(await snapshot(), JSON.parse(fs.readFileSync(snapshotPath)));
  else throw new Error('Expected snapshot, mutate or verify');
  console.log('Release recovery ' + mode + ' passed');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
