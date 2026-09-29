'use strict';
// Only seeds the dedicated disposable Compose rehearsal, never a business server.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const deployment = path.resolve(__dirname, '../../.tmp/erp-release-acceptance');
const base = 'http://127.0.0.1:5812/api';
const organizationName = 'ERP隔离发布验收';
const env = Object.fromEntries(fs.readFileSync(path.join(deployment, '.env'), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
assert.equal(env.APP_PORT, '5812');
assert.equal(env.STORE_TABLE, 'erp_release_store');
assert.equal(env.STORE_ID, 'release-test');
const password = 'Isolated-ERP-2026!';
let token;
async function request(endpoint, method = 'GET', body, overrideToken = token) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + endpoint, { method, headers: {
    ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    ...(overrideToken ? { Authorization: 'Bearer ' + overrideToken } : {}),
    'Idempotency-Key': crypto.randomUUID(),
    ...(endpoint === '/system/bootstrap' ? { 'X-Bootstrap-Token': env.BOOTSTRAP_TOKEN } : {}),
  }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.ok, endpoint + ': ' + response.status + ' ' + JSON.stringify(result));
  return result;
}
async function main() {
  const info = await request('/system/info');
  if (info.initialized) {
    assert.equal(info.organizationName, organizationName, 'Refusing to seed an unrelated deployment');
    throw new Error('Fixture already seeded; use saved context');
  }
  token = (await request('/system/bootstrap', 'POST', { organizationName, ownerName: '验收Owner', email: 'owner@example.test', password })).token;
  assert.ok(token);
  const users = [];
  for (const role of ['staff', 'viewer']) users.push(await request('/users', 'POST', { role, name: role + '验收', email: role + '@example.test', password }));
  const material = await request('/materials', 'POST', { type: 'PLA', materialType: 'PLA', brand: 'ERP验收耗材', diameter: 1.75, color: '蓝色', unitPrice: 25, unit: 'kg', notes: 'original-note' });
  const model = await request('/models', 'POST', { name: 'ERP验收模型', description: 'original-model-description', source: 'original' });
  const upload = new FormData();
  upload.append('file', new Blob(['ERP isolated attachment fixture\n'], { type: 'application/pdf' }), 'rehearsal.pdf');
  const attachment = await request('/orders/upload-attachment', 'POST', upload);
  const order = await request('/orders', 'POST', { customer: { name: 'ERP验收订单', email: 'customer@example.test', phone: '123' },
    items: [{ id: 'line-1', modelId: model.id, modelName: model.name, materialType: 'PLA', color: '蓝色', quantity: 2, unitPrice: 15, layerHeightMm: '0.2' }],
    notes: 'original-order-note', dueDate: '2026-10-01', attachments: [attachment], total: 30, currency: 'CNY' });
  const lot = await request('/stock/lots', 'POST', { materialId: material.id, lotNo: 'ERP-LOT', qty: 500, location: 'A-1', notes: 'original-lot-note' });
  const context = { base, serverId: info.serverId, token, password, materialId: material.id, modelId: model.id, orderId: order.id, lotId: lot.id, users, attachment };
  fs.writeFileSync(path.join(deployment, 'fixture-context.json'), JSON.stringify(context, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ seeded: true, serverId: info.serverId, users: 3, orderId: order.id, lotQty: lot.qty }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
