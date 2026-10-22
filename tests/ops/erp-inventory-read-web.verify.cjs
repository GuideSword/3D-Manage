'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { createInventoryService } = require('../../backend/modules/inventory/service');
async function main() {
  const config = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
  const url = new URL(config.connectionString); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/erp_02d3a_inventory');
  const directory = path.dirname(path.resolve(process.argv[2])), fixture = JSON.parse(await fs.readFile(path.join(directory, 'inventory-fixture.json'), 'utf8'));
  const pool = await createBusinessPool({ connectionString: config.connectionString });
  assert.equal((await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0].server_id, '02d3a200-0000-4000-8000-000000000001');
  const browser = await require(process.env.ERP_02C_PLAYWRIGHT_MODULE).chromium.launch({ headless: true, executablePath: process.env.ERP_02C_BROWSER_EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }), page = await context.newPage(); page.setDefaultTimeout(12000);
  const origin = `http://127.0.0.1:${config.webPort}`, api = `http://127.0.0.1:${config.apiPort}/api`;
  const checks = [], errors = [], report = path.join(directory, 'inventory-read-web-verification.json');
  const pass = value => { checks.push(value); console.log(value); };
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  const text = value => page.getByText(value, { exact: true }).filter({ visible: true });
  const tab = label => text(label).last().click();
  const back = () => page.getByRole('link', { name: /back|返回/i }).filter({ visible: true }).first().click();
  const search = () => page.getByPlaceholder('搜索材质、品牌或颜色');
  await fs.writeFile(report, JSON.stringify({ result: 'running' }));
  try {
    await page.goto(origin); await page.getByPlaceholder('例如 192.168.1.10:5000').fill(api); await button('测试并保存').click();
    await page.getByPlaceholder('请输入邮箱').fill('owner@erp-inventory.example.test'); await page.getByPlaceholder('请输入密码').fill(config.password); await button('登录').click(); await button('待审核订单 0').waitFor();
    await tab('耗材'); await text(`已加载 100 / ${fixture.materials} 条`).waitFor();
    await text('库存批次').locator('..').getByText('205', { exact: true }).waitFor();
    await text(fixture.summary.totalQty + 'g').first().waitFor();
    await button('加载更多').click(); await text('已加载 200 / 206 条').waitFor(); await button('加载更多').click(); await text('已加载 206 / 206 条').scrollIntoViewIfNeeded();
    for(let scroll=0;scroll<35&&!await text('库存精度耗材').count();scroll++){await text('已加载 206 / 206 条').scrollIntoViewIfNeeded();await page.waitForTimeout(80)}
    await text('库存精度耗材').scrollIntoViewIfNeeded();
    assert.equal((await page.locator('body').innerText()).includes('0100.001100'), false); pass('耗材分页可达第206条，全量205批次及大数量汇总精确，未按当前页统计');
    await search().fill('库存精度耗材'); await text('已加载 1 / 1 条').waitFor(); await text('库存精度耗材').click();
    await text(fixture.summary.totalQty + 'g').waitFor(); await text('205 个').waitFor(); await text('已加载 100 / 205 条').waitFor();
    await button('加载更多').click(); await text('已加载 200 / 205 条').waitFor(); await button('加载更多').click(); await text('已加载 205 / 205 条').waitFor(); await text('INV-000').waitFor(); await page.screenshot({ path: path.join(directory, 'inventory-detail-full.png') }); pass('耗材详情使用同一全量汇总，205条批次逐页可达最早批次');
    await back(); await tab('库存'); await text('已加载 100 / 205 条').waitFor();
    let failed = false;
    await page.route(api + '/inventory/lots?**', async route => {
      const query = new URL(route.request().url()).searchParams;
      if (!query.has('materialId') && query.get('offset') === '100' && !failed) {
        failed = true; const response = await route.fetch(); return route.fulfill({ response, status: 503, json: { error: '测试批次读取失败', code: 'TEST_READ_FAILURE' } });
      }
      return route.continue();
    });
    await button('加载更多').click(); await button('重试加载更多').waitFor(); await text('已加载 100 / 205 条').waitFor();
    await button('重试加载更多').click(); await text('已加载 200 / 205 条').waitFor(); await button('加载更多').click(); await text('已加载 205 / 205 条').waitFor(); await text('INV-000').waitFor(); pass('批次下一页503保留已读100条，原offset重试后完整加载205条');
    let summaryFails = true;
    await page.route(api + '/inventory/summary**', async route => { if (!summaryFails) return route.continue(); const response = await route.fetch(); return route.fulfill({ response, status: 503, json: { error: '测试汇总读取失败', code: 'TEST_READ_FAILURE' } }); });
    await tab('模型'); await tab('耗材'); await button('重试库存汇总').waitFor(); await text('暂不可用').first().waitFor(); summaryFails = false; await button('重试库存汇总').click(); await text(fixture.summary.totalQty + 'g').first().waitFor(); pass('汇总失败显示暂不可用和重试，未伪装零库存，恢复后精确合计返回');
    let releaseOld, oldStarted; const started = new Promise(resolve => { oldStarted = resolve; }); const held = new Promise(resolve => { releaseOld = resolve; });
    await page.route(api + '/materials?**', async route => {
      if (new URL(route.request().url()).searchParams.get('search') !== 'slow-query') return route.continue();
      const response = await route.fetch(); oldStarted(); await held; return route.fulfill({ response }).catch(() => {});
    });
    await text('耗材').first().click();
    await search().fill('slow-query'); await started; await search().fill('库存精度耗材'); await text('已加载 1 / 1 条').waitFor(); releaseOld(); await page.waitForTimeout(150); await text('库存精度耗材').waitFor(); pass('慢旧筛选响应晚于新筛选时不会覆盖当前耗材结果');
    await tab('模型'); await text('已加载 100 / 205 条').waitFor(); await button('加载更多').click(); await text('已加载 200 / 205 条').waitFor(); await button('加载更多').click(); for(let scroll=0;scroll<35&&!await text('Inventory-Model-000').count();scroll++){await text('已加载 205 / 205 条').scrollIntoViewIfNeeded();await page.waitForTimeout(80)} await text('Inventory-Model-000').scrollIntoViewIfNeeded(); pass('模型列表也能访问200条以后的记录，不再静默截断');
    await page.setViewportSize({ width: 390, height: 844 }); await tab('耗材'); await search().fill('库存精度耗材'); await text('已加载 1 / 1 条').waitFor(); await page.screenshot({ path: path.join(directory, 'inventory-summary-narrow.png') });
    let releaseAccount, accountStarted; const accountReady = new Promise(resolve => { accountStarted = resolve; }); const accountHold = new Promise(resolve => { releaseAccount = resolve; });
    await page.route(api + '/materials?**', async route => {
      if (new URL(route.request().url()).searchParams.get('search') !== 'account-hold') return route.fallback();
      const response = await route.fetch(); accountStarted(); await accountHold; return route.fulfill({ response }).catch(() => {});
    });
    await search().fill('account-hold'); await accountReady; await tab('设置'); await text('退出登录').click();
    await page.getByPlaceholder('请输入邮箱').fill('staff@erp-inventory.example.test'); await page.getByPlaceholder('请输入密码').fill(config.password); await button('登录').click(); await button('待审核订单 0').waitFor();
    await tab('设置'); await text('库存验收staff').waitFor(); await tab('耗材'); await text('已加载 100 / 206 条').waitFor(); releaseAccount(); await page.waitForTimeout(150); await text('已加载 100 / 206 条').waitFor(); await text(fixture.summary.totalQty + 'g').first().waitFor(); pass('Owner读取未返回时退出并登录Staff，旧账号响应不能覆盖新账号页面');
    const inventory = createInventoryService(pool), actor = { actorId: 'owner', tokenVersion: '1' }, faultKey = `invalid-read-${Date.now()}`;
    const zero = (await inventory.execute({ ...actor, operation: 'lot.create', key: faultKey, payload: { materialId: fixture.material.id, lotNo: 'INVALID-READ', qty: '0' } })).body;
    try {
      await pool.query("UPDATE erp.stock_lots SET balance_status='legacy_invalid',qty_mg=NULL,active=false WHERE id=$1", [zero.id]);
      await tab('模型'); await tab('耗材'); await text('部分历史余额待核对，当前合计不包含无效余额。').waitFor(); await tab('库存'); await text('INVALID-READ').waitFor(); await text('待核对').waitFor(); await page.screenshot({ path: path.join(directory, 'inventory-invalid-read.png') });
      pass('隔离历史无效余额故障注入显示待核对，未把null余额显示为0g');
    } finally {
      await pool.query("UPDATE erp.stock_lots SET balance_status='tracked',qty_mg=0,active=true WHERE id=$1", [zero.id]);
      await inventory.execute({ ...actor, operation: 'lot.delete', key: faultKey + '-cleanup', payload: { id: zero.id, version: zero.version } });
    }
    assert.deepEqual(errors, []);
    const totals = (await pool.query('SELECT count(*)::int AS lots,sum(qty_mg)::text AS mg FROM erp.stock_lots')).rows[0]; assert.equal(totals.lots, 205); assert.equal(totals.mg, fixture.summary.totalQtyMg);
    const ledger = (await pool.query('SELECT count(*)::int AS transactions,sum(delta_qty_mg)::text AS mg FROM erp.inventory_txns')).rows[0]; assert.equal(ledger.transactions, 205); assert.equal(ledger.mg, totals.mg); pass('205个初始余额均有真实入库流水，库存毫克合计与流水增量一致');
    await fs.writeFile(report, JSON.stringify({ result: 'passed', utcTimestamp: new Date().toISOString(), checks, pageErrors: errors, productionUsed: false, totalQty: fixture.summary.totalQty, ledger }, null, 2)); console.log(JSON.stringify({ result: 'passed', checks: checks.length, pageErrors: errors.length }));
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'inventory-read-failure.png') }).catch(() => {});
    await fs.writeFile(path.join(directory, 'inventory-read-failure-body.txt'), await page.locator('body').innerText().catch(() => ''));
    await fs.writeFile(report, JSON.stringify({ result: 'failed', checks, pageErrors: errors, error: error.message }, null, 2)); throw error;
  } finally { await browser.close(); await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
