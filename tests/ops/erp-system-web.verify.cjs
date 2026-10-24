'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { createMaintenanceService } = require('../../backend/business-db/maintenance');
async function main() {
  const configPath = process.argv[2];
  if (!configPath || !process.env.ERP_02C_PLAYWRIGHT_MODULE || !process.env.ERP_02C_BROWSER_EXECUTABLE) throw Error('Explicit fixture config and headless browser required');
  const config = JSON.parse((await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
  const target = new URL(config.connectionString);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/erp_02d2_acceptance');
  const directory = path.dirname(path.resolve(configPath));
  const pool = await createBusinessPool({ connectionString: config.connectionString });
  const serverId = '02d20000-0000-4000-8000-000000000001';
  assert.equal((await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0].server_id, serverId);
  const maintenance = createMaintenanceService(pool);
  const browser = await require(process.env.ERP_02C_PLAYWRIGHT_MODULE).chromium.launch({ headless: true, executablePath: process.env.ERP_02C_BROWSER_EXECUTABLE });
  const origin = `http://127.0.0.1:${config.webPort}`, api = `http://127.0.0.1:${config.apiPort}/api`;
  const checks = [], errors = [];
  let current;
  const reportPath = path.join(directory, 'system-web-verification.json');
  await fs.writeFile(reportPath, JSON.stringify({ result: 'running', utcTimestamp: new Date().toISOString() }));
  async function home(page) {
    await page.getByRole('button', { name: '待审核订单 2', exact: true }).first().waitFor();
    await page.getByRole('button', { name: '执行中订单 1', exact: true }).first().waitFor();
    await page.getByRole('button', { name: '库存风险', exact: true }).getByText('107', { exact: true }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes('部分数据加载失败'), false);
    for (let index = 0; index < 4; index++) await page.getByText(new RegExp(`#system-order-${index}`)).waitFor();
  }
  async function login(role, before, width = 1366) {
    const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 900 : 844 } });
    const page = await context.newPage(); current = page;
    page.on('pageerror', error => errors.push(error.message));
    if (before) await before(page);
    await page.goto(origin);
    await page.getByPlaceholder('例如 192.168.1.10:5000').fill(api);
    await page.getByText('测试并保存', { exact: true }).click();
    await page.getByPlaceholder('请输入邮箱').fill(`${role}@erp-system.example.test`);
    await page.getByPlaceholder('请输入密码').fill(config.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    return { context, page };
  }
  try {
    for (const role of ['owner', 'staff', 'viewer']) {
      const { context, page } = await login(role, null, role === 'owner' ? 1366 : 390);
      await home(page);
      await page.screenshot({ path: path.join(directory, `dashboard-${role}-top.png`) });
      await page.getByRole('button', { name: '库存风险', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(directory, `dashboard-${role}-risk.png`) });
      checks.push(`${role} 首页一次关系快照显示2/1及107个风险批次，最近4单与窄屏正常`);
      await context.close();
    }
    const { context, page } = await login('owner'); await home(page);
    const before = await maintenance.status({ expectedServerId: serverId });
    await maintenance.setState({ expectedServerId: serverId, expectedVersion: before.version, state: 'maintenance', reason: '系统Web隔离验收' });
    try {
      await page.getByText('设置', { exact: true }).click();
      const response = page.waitForResponse(value => value.url().startsWith(api + '/system/dashboard'));
      await page.getByText('首页', { exact: true }).click();
      assert.equal((await response).status(), 200); await home(page);
      checks.push('维护状态下原登录会话仍能读取并刷新首页');
    } finally {
      const state = await maintenance.status({ expectedServerId: serverId });
      await maintenance.setState({ expectedServerId: serverId, expectedVersion: state.version, state: 'open', reason: '系统Web验收结束' });
    }
    await context.close();
    const failed = await login('staff', async targetPage => {
      await targetPage.route('**/api/system/dashboard*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'BUSINESS_SERVICE_UNAVAILABLE', error: '业务服务暂时不可用，请稍后重试' }) }));
    }, 390);
    await failed.page.getByText('部分数据加载失败 · 点击重试', { exact: true }).waitFor();
    assert.equal(await failed.page.getByRole('button', { name: '待审核订单 0', exact: true }).count(), 0);
    await failed.page.unroute('**/api/system/dashboard*');
    await failed.page.getByText('部分数据加载失败 · 点击重试', { exact: true }).click(); await home(failed.page);
    checks.push('统计503显示失败而非零，点击重试恢复同一关系来源'); await failed.context.close();
    let dashboardRequests = 0;
    const fallback = await login('viewer', async targetPage => {
      targetPage.on('request', request => { if (request.url().startsWith(api + '/system/dashboard')) dashboardRequests++; });
      await targetPage.route('**/api/system/info*', async route => {
        const response = await route.fetch(); const info = await response.json(); delete info.capabilities.dashboardRulesVersion;
        await route.fulfill({ response, json: info });
      });
    });
    await fallback.page.getByRole('button', { name: '待审核订单 2', exact: true }).first().waitFor();
    await fallback.page.getByRole('button', { name: '执行中订单 1', exact: true }).first().waitFor();
    assert.equal(dashboardRequests, 0);
    checks.push('服务器未声明新统计能力时沿用原列表请求，不误调用新接口'); await fallback.context.close();
    const expired = await login('viewer'); await home(expired.page);
    await expired.page.route('**/api/system/dashboard*', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'AUTHENTICATION_REQUIRED', error: '请重新登录' }) }));
    await expired.page.getByText('设置', { exact: true }).click(); await expired.page.getByText('首页', { exact: true }).click();
    await expired.page.getByPlaceholder('请输入邮箱').waitFor(); await expired.page.getByRole('button', { name: '登录', exact: true }).waitFor();
    checks.push('统计401沿用原会话退出，不继续显示上一账号统计'); await expired.context.close();
    assert.deepEqual(errors, []);
    await fs.writeFile(reportPath, JSON.stringify({ result: 'passed', utcTimestamp: new Date().toISOString(), checks, pageErrors: errors, productionUsed: false }, null, 2));
    console.log(JSON.stringify({ result: 'passed', checks: checks.length, pageErrors: errors.length }));
  } catch (error) {
    if (current && !current.isClosed()) { await current.screenshot({ path: path.join(directory, 'system-web-failure.png') }); console.error((await current.locator('body').innerText()).slice(-2500)); }
    await fs.writeFile(reportPath, JSON.stringify({ result: 'failed', utcTimestamp: new Date().toISOString(), checks, pageErrors: errors, error: error.message, productionUsed: false }, null, 2));
    throw error;
  } finally { try { await browser.close(); } finally { await pool.end(); } }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
