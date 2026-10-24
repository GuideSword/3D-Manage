'use strict';

// Real browser -> HTTP adapter -> isolated PostgreSQL, without request interception.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const { createOrderService } = require('../../backend/modules/orders/service');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const url = new URL(process.env.ORDER_WEB_TEST_DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/erp_order_web_verify', 'requires a dedicated disposable database');
  const pool = await createBusinessPool({ connectionString: url.href });
  let server, browser;
  try {
    await migrateBusinessDatabase(pool);
    assert.equal((await pool.query('SELECT count(*) FROM erp.users')).rows[0].count, '0');
    const password = 'isolated-order-web-password';
    await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'订单通信验收',now(),'relational')", [randomUUID()]);
    await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('order-web-owner','order-web@example.test','owner',$1)", [await bcrypt.hash(password, 10)]);
    await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('web-customer','WEB-CUSTOMER','真实后端回归订单')");
    await pool.query("INSERT INTO erp.models(id,name) VALUES('web-model','验收模型')");
    const orders = createOrderService(pool);
    const actor = { actorId: 'order-web-owner', tokenVersion: '1' };
    const makeOrder = async () => (await orders.execute({ ...actor, key: randomUUID(), operation: 'order.create',
      payload: { customerId: 'web-customer', items: [{ modelId: 'web-model', quantity: '1', unitPrice: '10' }] } })).body;
    let order = await makeOrder();
    order = (await orders.execute({ ...actor, key: randomUUID(), operation: 'order.transition', payload: { id: order.id, version: order.version, status: 'pending_review' } })).body;
    const app = express();
    const writes = [];
    app.use('/api', (req, _res, next) => {
      if (req.method !== 'GET' && req.url.startsWith('/orders/')) writes.push({ method: req.method, url: req.url });
      next();
    });
    app.use('/api', createRelationalRouter(pool, { jwtSecret: 'isolated-order-web-jwt-secret-at-least-32-characters' }));
    app.use(express.static(path.resolve(process.env.WEB_EXPORT_DIR || '.tmp/web-order-image-fixes')));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const button = name => page.getByRole('button', { name, exact: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.getByPlaceholder('例如 192.168.1.10:5000').fill(origin + '/api');
    await button('测试并保存').click();
    await page.getByPlaceholder('请输入邮箱').fill('order-web@example.test');
    await page.getByPlaceholder('请输入密码').fill(password);
    await button('登录').click();
    await page.getByRole('tab', { name: '订单', exact: true }).click();
    await page.getByText('订单中心', { exact: true }).waitFor();
    await page.getByText('加载订单中...', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('真实后端回归订单', { exact: true }).last().click();
    await button('开始执行').click();
    await button('标记完成').waitFor();
    assert.equal((await orders.get(actor, order.id)).status, 'in_progress');
    await button('取消订单').click();
    await button('恢复为草稿').waitFor();
    assert.equal((await orders.get(actor, order.id)).status, 'cancelled');
    await button('恢复为草稿').click();
    await button('提交审核').waitFor();
    assert.equal((await orders.get(actor, order.id)).status, 'draft');
    await button('删除订单').click();
    await page.getByText('订单中心', { exact: true }).waitFor();
    assert.equal((await pool.query('SELECT count(*) FROM erp.orders WHERE id=$1', [order.id])).rows[0].count, '0');
    console.log('PASS real backend: detail start/cancel/restore/delete persisted in PostgreSQL');

    order = await makeOrder();
    await page.reload();
    await page.getByRole('tab', { name: '订单', exact: true }).click();
    await page.getByText('订单中心', { exact: true }).waitFor();
    await page.getByText('加载订单中...', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('真实后端回归订单', { exact: true }).last().click({ delay: 600 });
    await page.getByText('修改订单状态', { exact: true }).waitFor();
    await page.getByText('待审核', { exact: true }).last().click();
    await page.getByText('修改订单状态', { exact: true }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    assert.equal((await orders.get(actor, order.id)).status, 'pending_review');
    await button(`删除订单 ${order.id}`).click();
    await page.getByText('还没有订单喵', { exact: true }).waitFor();
    assert.equal((await pool.query('SELECT count(*) FROM erp.orders WHERE id=$1', [order.id])).rows[0].count, '0');
    const audit = (await pool.query("SELECT action FROM erp.audit_logs WHERE entity='orders' AND action IN ('status','delete')")).rows;
    assert.equal(audit.filter(row => row.action === 'status').length, 5);
    assert.equal(audit.filter(row => row.action === 'delete').length, 2);
    assert.equal(writes.length, 6);
    assert.deepEqual(errors, []);
    console.log('PASS real backend: list transition/delete persisted, six HTTP writes received and audit records committed');
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
