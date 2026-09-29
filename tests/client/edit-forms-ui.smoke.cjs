'use strict';

// Run against an isolated Expo export; only fixture data is changed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.EDIT_UI_EXPORT || '.tmp/edit-forms-web');
const fixture = () => ({
  order: { id: 'o1', customer: { id: 'c1', name: '编辑测试订单', email: 'old@example.test', phone: '123' },
    status: 'in_progress', total: 30, currency: 'CNY', dueDate: '2026-10-01', notes: '旧订单备注',
    attachments: [{ fileKey: 'orders/original.pdf', originalName: '原图纸.pdf' }],
    items: [{ id: 'line-1', modelId: 'model-1', modelName: '测试模型', materialType: '自定义树脂', color: '湖蓝', quantity: 2, unitPrice: 15, subtotal: 30, layerHeightMm: '0.2' }] },
  model: { id: 'model-1', name: '测试模型', description: '原模型描述', source: 'original', files: [], images: [] },
  material: { id: 'm1', type: '自定义树脂', materialType: '自定义树脂', brand: '测试品牌', diameter: 1.75, color: '湖蓝', unitPrice: 25, unit: 'kg', notes: '旧耗材备注', density: 1.24 },
  lot: { id: 'lot-1', materialId: 'm1', lotNo: 'LOT-1', qty: 500, state: 'in_stock', version: 1, active: true, serialNo: 'SERIAL', location: 'A-1', notes: '批次备注' },
  users: [{ id: 'owner', name: 'Owner', role: 'owner', email: 'owner@example.test' }, { id: 'staff', name: '旧姓名', role: 'staff', email: 'staff@example.test' }],
});
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      const data = fixture();
      const writes = [];
      const checkWidth = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow');
      let failModelSave = false;
      let conflictLot = false;
      await page.route('**/api/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const endpoint = url.pathname.replace(/^\/api/, '');
        let body = { items: [], total: 0 };
        let status = 200;
        const payload = req.postDataJSON();
        if (endpoint === '/system/info') body = { product: '3D Manage', apiVersion: '1', serverVersion: 'test', serverId: `edit-ui-${width}`, initialized: true, organizationName: '编辑测试工坊' };
        else if (endpoint === '/auth/login') body = { token: 'isolated-ui-test-token', user: data.users[0] };
        else if (endpoint === '/auth/me') body = { user: data.users[0] };
        else if (endpoint === '/orders') body = { items: [data.order], total: 1 };
        else if (endpoint === '/models') body = { items: [data.model], total: 1 };
        else if (endpoint === '/materials') body = { items: [data.material], total: 1 };
        else if (endpoint === '/stock/lots') body = { items: [data.lot], total: 1 };
        else if (endpoint === '/users') body = { items: data.users, total: data.users.length };
        else if (endpoint === '/orders/o1') {
          if (req.method() === 'PATCH') { writes.push({ endpoint, payload }); Object.assign(data.order, payload); }
          body = data.order;
        } else if (endpoint === '/models/model-1') {
          if (req.method() === 'PATCH') {
            if (failModelSave) { status = 500; body = { error: '模拟保存失败' }; }
            else { writes.push({ endpoint, payload }); Object.assign(data.model, payload); body = data.model; }
          } else body = data.model;
        } else if (endpoint === '/materials/m1') {
          if (req.method() === 'PATCH') { writes.push({ endpoint, payload }); Object.assign(data.material, payload); }
          body = data.material;
        } else if (endpoint === '/stock/lots/lot-1') {
          if (req.method() === 'PATCH') {
            if (conflictLot) { status = 409; body = { error: '批次版本冲突', code: 'VERSION_CONFLICT' }; conflictLot = false; data.lot.version += 1; }
            else { writes.push({ endpoint, payload }); Object.assign(data.lot, payload, { version: data.lot.version + 1 }); body = data.lot; }
          } else body = data.lot;
        } else if (endpoint === '/users/staff') {
          if (req.method() === 'PATCH') { writes.push({ endpoint, payload }); Object.assign(data.users[1], payload); }
          body = data.users[1];
        }
        await route.fulfill({ status, json: body });
      });

      await page.goto(appUrl);
      await page.getByPlaceholder('例如 192.168.1.10:5000').fill(appUrl);
      await page.getByText('测试并保存', { exact: true }).click();
      await page.getByPlaceholder('请输入邮箱').fill('owner@example.test');
      await page.getByPlaceholder('请输入密码').fill('test-password');
      await page.getByText('登录', { exact: true }).click();
      await page.getByText('欢迎回来！', { exact: true }).waitFor();

      await page.getByRole('tab', { name: '订单', exact: true }).click();
      await page.getByText('编辑测试订单', { exact: true }).last().click();
      await page.getByText('编辑订单', { exact: true }).click();
      await page.getByPlaceholder('请输入客户名称').waitFor();
      assert.equal(await page.getByPlaceholder('请输入客户名称').inputValue(), '编辑测试订单');
      assert.equal(await page.getByPlaceholder('请输入颜色名称').inputValue(), '湖蓝');
      await checkWidth();
      await page.getByPlaceholder('请输入客户名称').fill('已修改订单');
      await page.getByPlaceholder('订单备注信息').fill('');
      await page.getByLabel('截止日期', { exact: true }).fill('');
      await page.getByPlaceholder('数量', { exact: true }).fill('3');
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('已修改订单', { exact: true }).last().waitFor();
      const orderWrite = writes.find((write) => write.endpoint === '/orders/o1').payload;
      assert.equal(orderWrite.notes, ''); assert.equal(orderWrite.dueDate, null);
      assert.equal(orderWrite.total, 45); assert.equal(orderWrite.items[0].id, 'line-1');
      assert.equal(orderWrite.items[0].layerHeightMm, '0.2'); assert.equal(orderWrite.attachments.length, 1);
      assert.equal(Object.hasOwn(orderWrite, 'status'), false);
      await page.getByText('编辑订单', { exact: true }).click();
      await page.getByPlaceholder('请输入客户名称').waitFor();
      await page.getByPlaceholder('请输入客户名称').fill('取消不保存');
      await page.getByText('取消', { exact: true }).click();
      await page.getByText('已修改订单', { exact: true }).last().waitFor();
      assert.equal(writes.filter((write) => write.endpoint === '/orders/o1').length, 1);

      const reset = async () => { await page.goto(appUrl); await page.getByText('欢迎回来！', { exact: true }).waitFor(); };
      await reset();
      await page.getByRole('tab', { name: '模型', exact: true }).click();
      await page.getByText('测试模型', { exact: true }).last().click();
      await page.getByText('编辑模型', { exact: true }).click();
      await page.getByPlaceholder('请输入模型名称').waitFor();
      await checkWidth();
      await page.getByPlaceholder('请输入模型名称').fill('新模型名称');
      failModelSave = true;
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('模拟保存失败', { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder('请输入模型名称').inputValue(), '新模型名称');
      failModelSave = false;
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('新模型名称', { exact: true }).last().waitFor();
      assert.equal(Object.hasOwn(writes.find((write) => write.endpoint === '/models/model-1').payload, 'files'), false);

      await reset();
      await page.getByRole('tab', { name: '耗材', exact: true }).click();
      await page.getByText('自定义树脂', { exact: true }).first().click();
      await page.getByText('编辑耗材', { exact: true }).click();
      await page.getByPlaceholder('请输入材质类型').waitFor();
      assert.equal(await page.getByPlaceholder('请输入材质类型').inputValue(), '自定义树脂');
      await checkWidth();
      await page.getByPlaceholder('请输入品牌名称').fill('新品牌');
      await page.getByPlaceholder('耗材备注信息').fill('');
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('新品牌', { exact: true }).waitFor();
      assert.equal(data.material.notes, ''); assert.equal(data.material.density, 1.24);

      await page.getByText('编辑批次', { exact: true }).click();
      await page.getByRole('textbox').first().waitFor();
      await checkWidth();
      conflictLot = true;
      await page.getByRole('textbox').nth(2).fill('A-2');
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('重新加载最新资料', { exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox').nth(2).inputValue(), 'A-2');
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/api/stock/lots/lot-1') && response.request().method() === 'GET'),
        page.getByText('重新加载最新资料', { exact: true }).click(),
      ]);
      await page.getByText('加载原记录中...', { exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('textbox').nth(2).waitFor();
      await page.getByRole('textbox').nth(2).fill('A-2');
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/api/stock/lots/lot-1') && response.request().method() === 'PATCH' && response.status() === 200),
        page.getByText('保存修改', { exact: true }).click(),
      ]);
      await page.getByRole('heading', { name: '耗材详情', exact: true }).waitFor();
      assert.equal(data.lot.location, 'A-2'); assert.equal(data.lot.qty, 500);
      const lotWrite = writes.find((write) => write.endpoint === '/stock/lots/lot-1').payload;
      assert.equal(lotWrite.version, 2); assert.equal(Object.hasOwn(lotWrite, 'qty'), false);

      await reset();
      await page.getByRole('tab', { name: '耗材', exact: true }).click();
      await page.getByText('库存', { exact: true }).click();
      await page.getByText('LOT-1', { exact: true }).waitFor();
      await page.getByText('编辑批次', { exact: true }).click();
      await page.getByRole('textbox').first().waitFor();
      assert.equal(await page.getByRole('textbox').nth(2).inputValue(), 'A-2');
      await page.getByText('取消', { exact: true }).click();
      await page.getByText('LOT-1', { exact: true }).waitFor();
      await checkWidth();

      await reset();
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      await page.getByText('用户与权限', { exact: true }).click();
      await page.getByText('编辑姓名', { exact: true }).click();
      await checkWidth();
      await page.getByRole('textbox').last().fill('新姓名');
      await page.getByText('保存修改', { exact: true }).click();
      await page.getByText('新姓名', { exact: true }).waitFor();
      assert.equal(data.users[1].name, '新姓名');
      console.log(`${width}px: order/model/material/lot/user editing, cancel, failed save and version conflict passed`);
      await context.close();
    }
    assert.deepEqual(errors, [], 'No page runtime errors');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
