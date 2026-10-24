const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-edit-forms-'));
process.env.DATA_DIR = tempDir;
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.STORE_DRIVER = 'file';
process.env.JWT_SECRET = 'edit-forms-test-secret-at-least-32-characters';
process.env.OSS_ENABLED = 'false';
// Index scheduling is separate from editing; prevent background AI/network jobs in these isolated API tests.
const indexPath = require.resolve('../../backend/agent/modelIndex');
require.cache[indexPath] = { id: indexPath, filename: indexPath, loaded: true,
  exports: { queueUserAssetIndex() {}, queueUserModelReconcile() {}, deleteAssetIndexes() {} } };
const store = require('../../backend/utils/store');
const { issueToken } = require('../../backend/utils/authTokens');
const express = require('../../backend/node_modules/express');
const app = express();
app.use(express.json());
for (const route of ['orders', 'materials', 'models', 'stock', 'users']) app.use(`/${route}`, require(`../../backend/routes/${route}`));
let server;
let tokens;
let sequence = 0;
const request = async (url, method = 'GET', body, role = 'staff', key = `edit-${++sequence}`) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}`, 'Idempotency-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});
test.beforeEach(async () => {
  await store.withData((data) => {
    Object.assign(data, store.createFreshData());
    data.users.push(...['owner', 'staff', 'viewer'].map((role) => ({ id: role, role, name: role, active: true, tokenVersion: 1 })));
    data.materials.push({ id: 'm1', type: '自定义树脂', materialType: '自定义树脂', brand: '品牌', color: '蓝',
      diameter: 1.75, density: 1.24, unitPrice: 25, unit: 'kg', notes: '旧备注', createdAt: '2026-09-01' });
    data.orders.push({ id: 'o1', customer: { id: 'c1', name: '客户', email: 'old@example.com', phone: '123' },
      status: 'in_progress', notes: '旧备注', dueDate: '2026-10-01', createdBy: 'owner', createdAt: '2026-09-01',
      currency: 'CNY', total: 30, attachments: [{ fileKey: 'orders/old.pdf', originalName: '原图纸.pdf' }],
      items: [{ id: 'row-1', modelId: 'model-1', modelName: '原模型', materialType: '树脂', color: '蓝', quantity: 2,
        unitPrice: 15, subtotal: 30, layerHeightMm: '0.2', externalFileUrl: 'protected-link', notes: '打印说明' }] });
    data.models.push({ id: 'model-1', name: '原模型', description: '描述', source: 'original', createdAt: '2026-09-01',
      files: [{ id: 'file-1', name: 'part.stl', fileKey: 'models/part.stl' }],
      images: [{ id: 'image-1', type: 'cover', fileKey: 'models/cover.png' }] });
    return true;
  });
  const data = await store.getData();
  tokens = Object.fromEntries(data.users.map((user) => [user.role, issueToken(user, data.system.serverId)]));
});
test.after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await store.closeStore();
  assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('模型图片可逐张删除，访客无权删除，模型文件保持不变', async () => {
  const imagePath = path.join(tempDir, 'uploads', 'models', 'cover.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from('image data'));

  const denied = await request('/models/model-1/images/image-1', 'DELETE', undefined, 'viewer');
  assert.equal(denied.status, 403);
  assert.equal(fs.existsSync(imagePath), true);

  const removed = await request('/models/model-1/images/image-1', 'DELETE');
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { success: true });
  assert.equal(fs.existsSync(imagePath), false);

  const model = (await request('/models/model-1')).body;
  assert.deepEqual(model.images, []);
  assert.equal(model.files.length, 1);
  assert.equal((await request('/models/model-1/images/image-1', 'DELETE')).status, 404);
  assert.equal((await request('/models/missing/images/image-1', 'DELETE')).status, 404);

  const logs = (await store.getData()).auditLogs.filter((log) => log.action === 'image.delete');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].diff.id, 'image-1');
});

test('订单可清空可选字段并保留客户 ID、状态、附件和创建信息，修改行重算金额', async () => {
  const original = (await request('/orders/o1')).body;
  const updated = await request('/orders/o1', 'PATCH', { id: 'forged', createdBy: 'forged', createdAt: 'forged',
    customer: { name: '新客户', email: '', phone: '' }, notes: '', dueDate: null,
    items: [{ ...original.items[0], quantity: 3, subtotal: 30 }], total: 30 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.customer.id, 'c1');
  assert.equal(updated.body.customer.email, '');
  assert.equal(updated.body.customer.phone, '');
  assert.equal(updated.body.notes, '');
  assert.equal(updated.body.dueDate, null);
  assert.equal(updated.body.total, 45);
  assert.equal(updated.body.items[0].subtotal, 45);
  assert.equal(updated.body.items[0].externalFileUrl, 'protected-link');
  assert.equal(updated.body.id, 'o1');
  assert.equal(updated.body.createdBy, 'owner');
  assert.equal(updated.body.createdAt, '2026-09-01');
  assert.equal(updated.body.status, 'in_progress');
  assert.deepEqual(updated.body.attachments, original.attachments);
  const fetched = (await request('/orders/o1')).body;
  assert.equal(fetched.notes, '');
  assert.equal((await request('/orders/o1', 'PATCH', { status: 'completed' })).status, 400);
  const logs = (await store.getData()).auditLogs.filter((log) => log.entity === 'orders' && log.action === 'update');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].diff.before.notes, '旧备注');
  assert.equal(logs[0].diff.after.notes, '');
});

test('省略字段保留旧值，耗材清空备注保留密度、主键和历史资料', async () => {
  assert.equal((await request('/orders/o1', 'PATCH', { customer: { name: '仅改姓名' } })).body.notes, '旧备注');
  const result = await request('/materials/m1', 'PATCH', { id: 'forged', notes: '', unitPrice: 30 });
  assert.equal(result.status, 200);
  assert.equal(result.body.id, 'm1');
  assert.equal(result.body.notes, '');
  assert.equal(result.body.density, 1.24);
  assert.equal(result.body.type, '自定义树脂');
  assert.equal(result.body.createdAt, '2026-09-01');
  assert.equal((await request('/materials/m1')).body.unitPrice, 30);
  assert.equal((await request('/materials/m1', 'PATCH', { unitPrice: '3abc' })).status, 400);
});

test('模型资料修改不丢失受保护文件和封面', async () => {
  const before = (await store.getData()).models[0];
  const result = await request('/models/model-1', 'PATCH', { name: '新模型名称', description: '新描述', source: 'remix' });
  assert.equal(result.status, 200);
  const after = (await store.getData()).models[0];
  assert.equal(after.name, '新模型名称');
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(after.images, before.images);
  assert.equal(after.createdAt, before.createdAt);
});

test('Viewer 无编辑权限，Staff 不能改用户，Owner 可改普通用户姓名', async () => {
  for (const [url, payload] of [['/orders/o1', { notes: 'x' }], ['/materials/m1', { notes: 'x' }],
    ['/models/model-1', { name: 'x' }]]) assert.equal((await request(url, 'PATCH', payload, 'viewer')).status, 403);
  assert.equal((await request('/users/viewer', 'PATCH', { name: '新姓名' })).status, 403);
  assert.equal((await request('/users/viewer', 'PATCH', { name: '新姓名' }, 'owner')).body.name, '新姓名');
  assert.equal((await request('/users/owner', 'PATCH', { name: '改Owner' }, 'owner')).status, 409);
});

test('批次资料修改保留余额及流水，旧版本拒绝、重试不重复修改', async () => {
  const lot = (await request('/stock/lots', 'POST', { materialId: 'm1', lotNo: 'LOT-1', qty: 500 })).body;
  const payload = { lotNo: 'LOT-2', serialNo: 'SERIAL', location: 'A-1', notes: '', version: lot.version };
  const first = await request(`/stock/lots/${lot.id}`, 'PATCH', payload, 'staff', 'same-edit');
  assert.equal(first.status, 200);
  assert.deepEqual(await request(`/stock/lots/${lot.id}`, 'PATCH', payload, 'staff', 'same-edit'), first);
  assert.equal(first.body.qty, 500);
  assert.equal(first.body.version, lot.version + 1);
  assert.equal((await store.getData()).inventoryTxns.length, 1);
  assert.equal((await request(`/stock/lots/${lot.id}`, 'PATCH', payload)).status, 409);
  assert.equal((await request(`/stock/lots/${lot.id}`, 'PATCH', { qty: 800 })).status, 400);
  assert.equal((await request(`/stock/lots/${lot.id}`, 'PATCH', { notes: 'x' }, 'viewer')).status, 403);
});

test('非法订单行数量/单价拒绝且不会写入，删除记录返回 404', async () => {
  for (const value of ['1abc', 'Infinity', -1, null, false]) {
    assert.equal((await request('/orders/o1', 'PATCH', { items: [{ quantity: value, unitPrice: 5 }] })).status, 400);
  }
  assert.equal((await request('/orders/o1', 'PATCH', { items: [] })).status, 400);
  assert.equal((await request('/orders/missing', 'PATCH', { notes: 'x' })).status, 404);
  assert.equal((await request('/orders/o1')).body.total, 30);
});
