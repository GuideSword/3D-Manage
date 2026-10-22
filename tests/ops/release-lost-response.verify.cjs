'use strict';

// Run only against the isolated ERP release fixture. This intentionally posts 1g out.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const context = JSON.parse(fs.readFileSync(path.resolve('.tmp/erp-release-acceptance/fixture-context.json'), 'utf8'));
const expectedBase = 'http://127.0.0.1:5812/api';
assert.equal(context.base, expectedBase, 'Refusing to test a non-isolated backend');

const headers = { Authorization: `Bearer ${context.token}` };
const api = async (endpoint, options = {}) => {
  const response = await fetch(`${context.base}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  return { status: response.status, body: await response.json() };
};

(async () => {
  const info = await api('/system/info');
  assert.equal(info.body.serverId, context.serverId, 'Fixture identity changed');
  assert.equal(info.body.organizationName, 'ERP隔离发布验收', 'Fixture organization changed');
  const lotPath = `/stock/lots/${context.lotId}`;
  const before = await api(lotPath);
  const beforeTxns = await api(`/stock/inventory/txns?lotId=${context.lotId}`);
  assert.equal(before.status, 200);
  assert.equal(beforeTxns.status, 200);
  assert.ok(Number(before.body.qty) >= 1);
  const key = `lost-response-${crypto.randomUUID()}`;
  const payload = JSON.stringify({ lotId: context.lotId, type: 'out', qty: '1' });
  let committed;
  const upstreamFinished = new Promise((resolve, reject) => {
    committed = { resolve, reject };
  });
  const proxy = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const posted = await api('/stock/inventory/txns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: Buffer.concat(chunks),
      });
      assert.equal(posted.status, 201);
      committed.resolve(posted.body);
      response.destroy(); // Drop only this test client's response after the server has committed.
    } catch (error) {
      committed.reject(error);
      response.destroy(error);
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    let clientLostResponse = false;
    try {
      await fetch(`http://127.0.0.1:${proxy.address().port}/drop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      });
    } catch {
      clientLostResponse = true;
    }
    assert.ok(clientLostResponse, 'Client unexpectedly received the committed response');
    const first = await upstreamFinished;
    const afterFirst = await api(lotPath);
    const retry = await api('/stock/inventory/txns', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: payload,
    });
    const afterRetry = await api(lotPath);
    const afterTxns = await api(`/stock/inventory/txns?lotId=${context.lotId}`);
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.body, first);
    assert.equal(afterFirst.body.qty, before.body.qty - 1);
    assert.equal(afterRetry.body.qty, afterFirst.body.qty);
    assert.equal(afterRetry.body.version, before.body.version + 1);
    assert.equal(afterTxns.body.items.length, beforeTxns.body.items.length + 1);
    console.log(JSON.stringify({ clientLostResponse, beforeQty: before.body.qty,
      afterQty: afterRetry.body.qty, newMovements: 1, newVersions: 1, sameReceipt: true }));
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
