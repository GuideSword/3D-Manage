'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { createPartnerService } = require('../../backend/modules/partners/service');
const { createOrderService } = require('../../backend/modules/orders/service');
async function main() {
  const configPath = process.argv[2];
  if (!configPath || !process.env.ERP_02C_PLAYWRIGHT_MODULE || !process.env.ERP_02C_BROWSER_EXECUTABLE) throw new Error('Explicit isolated config and headless browser required');
  const config = JSON.parse((await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
  const database = new URL(config.connectionString);
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/erp_02c_acceptance') throw new Error('Not an isolated UI database');
  const pool = await createBusinessPool({ connectionString: config.connectionString });
  let browser;
  try {
    const state = (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0];
    assert.equal(state.server_id, '02c00000-0000-4000-8000-000000000001');
    const { chromium } = require(process.env.ERP_02C_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, executablePath: process.env.ERP_02C_BROWSER_EXECUTABLE });
  } catch (error) { await pool.end(); throw error; }
  const origin = `http://127.0.0.1:${config.port}`;
  const suffix = Date.now().toString(36);
  const output = path.dirname(path.resolve(configPath));
  const checks = [];
  const errors = [];
  let currentPage;
  await fs.writeFile(path.join(output, 'web-verification.json'), JSON.stringify({ result: 'running', utcTimestamp: new Date().toISOString() }));
  async function login(role, width = 1366) {
    const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 900 : 844 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByPlaceholder('例如 192.168.1.10:5000').fill(origin + '/api');
    await page.getByText('测试并保存', { exact: true }).click();
    await page.getByPlaceholder('请输入邮箱').fill(`${role}@erp-02c.example.test`);
    await page.getByPlaceholder('请输入密码').fill(config.password);
    await page.getByText('登录', { exact: true }).click();
    await page.getByText('设置', { exact: true }).click();
    return { context, page };
  }
  const field = (page, label) => page.getByText(label, { exact: true }).locator('..').locator('input,textarea');
  async function openList(page, label) {
    await page.getByText(`${label}资料`, { exact: true }).click();
    await page.getByText('查询', { exact: true }).waitFor();
  }
  async function backTo(page, title) {
    const destination = page.getByText(title, { exact: true }).filter({ visible: true }).first();
    try { await page.getByRole('link', { name: /back$/i }).first().click({ timeout: 3000 }); }
    catch (error) { if (!await destination.isVisible()) throw error; }
    await destination.waitFor();
  }
  async function openRecord(page, label, code, name) {
    await page.getByRole('button', { name: `查看${label} ${code} ${name}` }).click();
    await page.getByText(`${label}详情`, { exact: true }).waitFor();
  }
  try {
    const { context, page } = await login('owner');
    currentPage = page;
    await openList(page, '客户');
    await page.getByRole('button', { name: '查看客户 C001 同名客户' }).waitFor();
    await page.screenshot({ path: path.join(output, 'customers-desktop.png') });
    const code = `WEB-${suffix}`;
    await page.getByText('新增客户', { exact: true }).click();
    await field(page, '编号 *').fill(code);
    await field(page, '名称 *').fill('Web 验收客户');
    await field(page, '联系人').fill('联系人');
    await field(page, '电话').fill('13812345678');
    await field(page, '备注').fill('第一行\n第二行，保留标点');
    let dropped = false;
    await page.route('**/api/customers', async route => {
      if (!dropped && route.request().method() === 'POST') {
        dropped = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.getByText('保存', { exact: true }).click();
    await page.getByText('重试原保存', { exact: true }).waitFor();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.customers WHERE code=$1', [code])).rows[0].n, 1);
    await page.getByText('重试原保存', { exact: true }).click();
    await openRecord(page, '客户', code, 'Web 验收客户');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.customers WHERE code=$1', [code])).rows[0].n, 1);
    checks.push('服务器已提交但响应丢失时，原键重试只保留一条新资料');
    let loadFailure = true;
    await page.route('**/api/customers/*', async route => {
      if (loadFailure && route.request().method() === 'GET') {
        loadFailure = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_LOAD_FAILURE', error: '验收原记录读取失败' }) });
      }
      return route.continue();
    });
    await page.getByText('编辑客户', { exact: true }).filter({ visible: true }).click();
    await page.getByText('验收原记录读取失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('保存', { exact: true }).isVisible(), false);
    await page.getByText('重新加载', { exact: true }).click();
    await field(page, '电话').waitFor();
    checks.push('原记录加载失败时不显示可保存空表单，重载后恢复原值');
    assert.equal(await field(page, '电话').inputValue(), '13812345678');
    await field(page, '电话').fill('');
    await field(page, '备注').fill('');
    let outage = true;
    await page.route('**/api/customers/*', async route => {
      if (outage && route.request().method() === 'PATCH') {
        outage = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_OUTAGE', error: '验收临时故障' }) });
      }
      return route.continue();
    });
    await page.getByText('保存', { exact: true }).click();
    await page.getByText('重试原保存', { exact: true }).waitFor();
    assert.equal(await field(page, '名称 *').inputValue(), 'Web 验收客户');
    assert.equal(await field(page, '电话').isEditable(), false);
    await page.getByText('重试原保存', { exact: true }).click();
    await page.getByText('客户详情', { exact: true }).waitFor();
    const customer = (await pool.query('SELECT id,phone,notes,version FROM erp.customers WHERE code=$1', [code])).rows[0];
    assert.equal(customer.phone, ''); assert.equal(customer.notes, ''); assert.equal(customer.version, '2');
    checks.push('客户创建、回填、清空字段、503 保留输入及同键重试');
    await page.getByText('编辑客户', { exact: true }).filter({ visible: true }).click();
    await field(page, '备注').fill('冲突时保留输入');
    const customers = createPartnerService(pool, 'customers');
    await customers.execute({ actorId: 'owner', tokenVersion: '1', operation: 'customer.update', key: `external-${suffix}`,
      payload: { id: customer.id, version: '2', changes: { name: '其他人更新的客户' } } });
    await page.getByText('保存', { exact: true }).click();
    await page.getByText('重新加载最新资料（替换当前输入）', { exact: true }).waitFor();
    assert.equal(await field(page, '备注').inputValue(), '冲突时保留输入');
    await page.getByText('重新加载最新资料（替换当前输入）', { exact: true }).click();
    await field(page, '名称 *').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === '其他人更新的客户'));
    await field(page, '备注').fill('重新核对后保存');
    await page.getByText('保存', { exact: true }).click();
    await page.getByText('客户详情', { exact: true }).waitFor();
    checks.push('409 保留未保存输入、明确重新加载后重新提交');
    await page.getByText('停用', { exact: true }).click();
    await page.getByText('恢复启用', { exact: true }).waitFor();
    await page.getByText('恢复启用', { exact: true }).click();
    await page.getByText('停用', { exact: true }).waitFor();
    await page.getByText('删除资料', { exact: true }).click();
    await page.getByText('确认删除', { exact: true }).click();
    await page.getByText('新增客户', { exact: true }).waitFor();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.customers WHERE code=$1', [code])).rows[0].n, 0);
    checks.push('停用、恢复、确认后删除及返回列表刷新');
    const referenced = (await customers.execute({ actorId: 'owner', tokenVersion: '1', operation: 'customer.create', key: `ref-${suffix}`,
      payload: { code: `REF-${suffix}`, name: '已有订单客户' } })).body;
    const orders = createOrderService(pool);
    const order = (await orders.execute({ actorId: 'owner', tokenVersion: '1', operation: 'order.create', key: `ref-order-${suffix}`,
      payload: { customerId: referenced.id, items: [{ quantity: '1', unitPrice: '1' }] } })).body;
    await page.getByText('查询', { exact: true }).click();
    await openRecord(page, '客户', referenced.code, referenced.name);
    await page.getByText('删除资料', { exact: true }).click();
    await page.getByText('确认删除', { exact: true }).click();
    await page.getByText('记录存在引用或关联记录已变化，请刷新后重试', { exact: true }).waitFor();
    await page.getByText('停用', { exact: true }).click();
    await page.getByText('恢复启用', { exact: true }).waitFor();
    assert.equal((await customers.get({ actorId: 'owner', tokenVersion: '1' }, referenced.id)).active, false);
    assert.equal((await orders.get({ actorId: 'owner', tokenVersion: '1' }, order.id)).customer.name, referenced.name);
    checks.push('被订单引用的客户禁止删除，允许停用并保留订单快照');
    await backTo(page, '客户资料');
    // The stack header back button has its own accessible name; discover it from rendered DOM.
    await backTo(page, '设置中心');
    await page.getByText('默认仓库', { exact: true }).click();
    await field(page, '仓库名称 *').fill('');
    await page.getByText('保存仓库名称', { exact: true }).click();
    await page.getByText('仓库名称不能为空且不能超过 240 个字符', { exact: true }).waitFor();
    assert.equal(await field(page, '仓库名称 *').isEditable(), true);
    await field(page, '仓库名称 *').fill('Web 验收仓库');
    await page.getByText('保存仓库名称', { exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Web 验收仓库' && !input.disabled));
    await page.screenshot({ path: path.join(output, 'warehouse-desktop.png') });
    checks.push('Owner 仓库名称验证失败可继续修改并成功保存');
    await context.close();
    for (const role of ['staff', 'viewer']) {
      const narrow = await login(role, 390);
      currentPage = narrow.page;
      await openList(narrow.page, '供应商');
      assert.equal(await narrow.page.getByText('新增供应商', { exact: true }).count(), role === 'staff' ? 1 : 0);
      await openRecord(narrow.page, '供应商', 'S001', '验收供应商');
      assert.equal(await narrow.page.getByText('编辑供应商', { exact: true }).count(), role === 'staff' ? 1 : 0);
      assert.equal(await narrow.page.getByText('删除资料', { exact: true }).count(), role === 'staff' ? 1 : 0);
      if (role === 'staff') {
        await narrow.page.getByText('编辑供应商', { exact: true }).click();
        const longName = '长名称'.repeat(80);
        await field(narrow.page, '名称 *').fill(longName);
        await field(narrow.page, '备注').fill('员工窄屏修改\n保留换行');
        await narrow.page.getByText('保存', { exact: true }).click();
        await narrow.page.getByText('供应商详情', { exact: true }).waitFor();
        await narrow.page.getByText('员工窄屏修改\n保留换行', { exact: true }).waitFor();
        await narrow.page.getByText(longName, { exact: true }).waitFor();
        assert.equal(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await narrow.page.screenshot({ path: path.join(output, 'supplier-long-name-narrow.png') });
        await narrow.page.getByText('编辑供应商', { exact: true }).filter({ visible: true }).click();
        await field(narrow.page, '名称 *').fill('验收供应商');
        await narrow.page.getByText('保存', { exact: true }).click();
        await narrow.page.getByText('供应商详情', { exact: true }).waitFor();
        await narrow.page.getByText('停用', { exact: true }).click();
        await narrow.page.getByText('恢复启用', { exact: true }).waitFor();
        await narrow.page.getByText('恢复启用', { exact: true }).click();
        await narrow.page.getByText('停用', { exact: true }).waitFor();
        checks.push('Staff 窄屏 240 字名称、多行备注、供应商编辑、停用与恢复');
      }
      assert.equal(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await narrow.page.screenshot({ path: path.join(output, `supplier-${role}-narrow.png`) });
      checks.push(`${role} 窄屏读取与操作权限`);
      await backTo(narrow.page, '供应商资料');
      await backTo(narrow.page, '设置中心');
      await narrow.page.getByText('默认仓库', { exact: true }).click();
      await field(narrow.page, '仓库名称 *').waitFor();
      assert.equal(await field(narrow.page, '仓库名称 *').isEditable(), false);
      assert.equal(await narrow.page.getByText('保存仓库名称', { exact: true }).count(), 0);
      checks.push(`${role} 仓库名称只读`);
      await narrow.context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'web-verification.json'), JSON.stringify({ result: 'passed', utcTimestamp: new Date().toISOString(), checks, pageErrors: errors, productionUsed: false }, null, 2));
    console.log(JSON.stringify({ result: 'passed', checks: checks.length, pageErrors: errors.length }));
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(output, 'web-failure.png') }).catch(() => {});
      console.error('Visible UI:', (await currentPage.locator('body').innerText()).slice(-4500));
      console.error('Visible links:', await currentPage.getByRole('link').evaluateAll(nodes => nodes.map(node => ({ label: node.getAttribute('aria-label'), text: node.textContent }))));
    }
    await fs.writeFile(path.join(output, 'web-verification.json'), JSON.stringify({ result: 'failed', utcTimestamp: new Date().toISOString(), checks, pageErrors: errors, productionUsed: false, error: error.message }, null, 2));
    throw error;
  } finally { try { await browser.close(); } finally { await pool.end(); } }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
