'use strict';

// Export first: npx expo export --platform web --output-dir .tmp/web-order-image-fixes
// Set PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE when Playwright is installed outside this repo.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.env.WEB_EXPORT_DIR || '.tmp/web-order-image-fixes');
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const failures = [];
  try {
    for (const relational of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      const writes = [];
      let rejectNext = false;
      let dropNext = false;
      const completedCommands = new Map();
      let order = { id: 'order-fixture', version: '9007199254740993', customer: { name: '通信回归订单' }, status: 'pending_review', total: '10.00', items: [], attachments: [] };
      const model = { id: 'model-fixture', version: '1', name: '缩放回归模型', source: 'original', files: [], images: [{ id: 'image-fixture', fileUrl: '/api/files/zoom.png' }] };
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        let body = { items: [], total: 0 };
        let status = 200;
        if (url.pathname === '/api/system/info') body = { product: '3D Manage', apiVersion: '1', serverId: 'order-image-regression', initialized: true,
          capabilities: relational ? { relationalBusiness: true, businessRulesVersion: 2 } : {} };
        else if (url.pathname === '/api/auth/login') body = { token: 'isolated-fixture-token', user: { id: 'owner', role: 'owner', email: 'test@example.test' } };
        else if (url.pathname === '/api/auth/me') body = { id: 'owner', role: 'owner', email: 'test@example.test' };
        else if (url.pathname === '/api/files/zoom.png') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="teal"/></svg>' });
        else if (/^\/api\/orders\/order-fixture(?:\/status|\/transition)?$/.test(url.pathname) && method !== 'GET') {
          const payload = request.postDataJSON();
          const key = request.headers()['idempotency-key'];
          writes.push({ method, path: url.pathname, payload, headers: request.headers() });
          if (relational && (!payload?.version || request.headers()['x-business-rules-version'] !== '2' || !request.headers()['idempotency-key'])) {
            status = 400; body = { error: '缺少版本或幂等标识' };
          } else if (key && completedCommands.has(key)) body = completedCommands.get(key);
          else if (rejectNext) {
            rejectNext = false; status = 409; body = { code: 'VERSION_CONFLICT', error: '订单已被其他人修改，请重新加载' };
          } else if (method === 'DELETE') { order = null; body = { success: true }; }
          else { order = { ...order, status: payload.status, version: String(BigInt(order.version) + 1n) }; body = order; }
          if (status === 200 && key) completedCommands.set(key, body);
          if (dropNext && status === 200) { dropNext = false; return route.abort('failed'); }
        } else if (url.pathname === '/api/orders') body = { items: order ? [order] : [], total: order ? 1 : 0 };
        else if (url.pathname === '/api/orders/order-fixture') body = order;
        else if (url.pathname === '/api/models') body = { items: [model], total: 1 };
        else if (url.pathname === '/api/models/model-fixture') body = model;
        await route.fulfill({ status, json: body });
      });
      const button = name => page.getByRole('button', { name, exact: true });
      async function check(name, run) {
        try { await run(); console.log(`PASS ${relational ? 'relational' : 'legacy'}: ${name}`); }
        catch (error) { const failure = `${relational ? 'relational' : 'legacy'} ${name}: ${error.message}`; failures.push(failure); console.error(`FAIL ${failure}`); }
      }
      try {
        await page.goto(origin);
        await page.getByPlaceholder('例如 192.168.1.10:5000').fill(origin + '/api');
        await button('测试并保存').click();
        await page.getByPlaceholder('请输入邮箱').fill('test@example.test');
        await page.getByPlaceholder('请输入密码').fill('fixture-password');
        await button('登录').click();
        await page.getByRole('tab', { name: '订单', exact: true }).click();
        await page.getByText('订单中心', { exact: true }).waitFor();
        await page.getByText('通信回归订单', { exact: true }).last().click();
        await button('开始执行').waitFor();
        await check('detail starts execution through API', async () => {
          await button('开始执行').click();
          await page.waitForFunction(() => document.body.innerText.includes('标记完成'), null, { timeout: 3000 });
          assert.equal(order.status, 'in_progress');
          assert.equal(writes.length, 1);
          assert.equal(writes[0].payload.status, 'in_progress');
          if (relational) assert.equal(writes[0].payload.version, '9007199254740993');
        });
        await check('detail cancels and restores through API', async () => {
          await button('取消订单').click();
          await button('恢复为草稿').waitFor();
          assert.equal(order.status, 'cancelled');
          await button('恢复为草稿').click();
          await button('提交审核').waitFor();
          assert.equal(order.status, 'draft');
        });
        await check('detail deletes through API and returns', async () => {
          await button('删除订单').click();
          await page.getByText('订单中心', { exact: true }).waitFor();
          assert.equal(order, null);
          assert.equal(writes.at(-1).method, 'DELETE');
        });
        order = { id: 'order-fixture', version: '1', customer: { name: '通信回归订单' }, status: 'pending_review', total: '10.00', items: [] };
        await page.reload();
        await page.getByRole('tab', { name: '订单', exact: true }).click();
        const openStatus = async () => {
          await page.getByText('通信回归订单', { exact: true }).last().click({ delay: 600 });
          await page.getByText('修改订单状态', { exact: true }).waitFor();
        };
        await check('list status and downgrade call API', async () => {
          await openStatus();
          await page.getByText('执行中', { exact: true }).last().click();
          await page.waitForTimeout(250);
          assert.equal(order.status, 'in_progress');
          await openStatus();
          await page.getByText('草稿', { exact: true }).last().click();
          await page.waitForTimeout(250);
          assert.equal(order.status, 'draft');
        });
        if (relational) {
          await check('conflict is visible and leaves status unchanged', async () => {
            rejectNext = true;
            await openStatus();
            await page.getByText('待审核', { exact: true }).last().click();
            await button('重新加载最新订单').waitFor();
            assert.equal(order.status, 'draft');
            await button('重新加载最新订单').click();
            await button('重新加载最新订单').waitFor({ state: 'hidden' });
          });
          await check('lost response retries original key and payload', async () => {
            dropNext = true;
            await openStatus();
            await page.getByText('待审核', { exact: true }).last().click();
            await button('重试原订单操作').waitFor();
            const first = writes.at(-1);
            await button('重试原订单操作').click();
            await button('重试原订单操作').waitFor({ state: 'hidden' });
            assert.equal(order.status, 'pending_review');
            assert.equal(writes.at(-1).headers['idempotency-key'], first.headers['idempotency-key']);
            assert.deepEqual(writes.at(-1).payload, first.payload);
          });
        }
        await check('list deletion calls API', async () => {
          await page.getByRole('button', { name: '删除订单 order-fixture', exact: true }).click();
          await page.waitForTimeout(250);
          assert.equal(order, null);
          assert.equal(writes.at(-1).method, 'DELETE');
        });
        // A separate navigation resets the failed baseline detail checks too.
        await page.reload();
        await page.getByRole('tab', { name: '模型', exact: true }).click();
        await page.getByText('模型图鉴', { exact: true }).waitFor();
        await page.getByText('缩放回归模型', { exact: true }).last().click();
        await page.getByText('模型详情', { exact: true }).waitFor();
        await button('放大查看模型图片').click();
        await button('关闭图片预览').waitFor();
        await check('wheel zooms image in/out and clamps scale', async () => {
          await page.getByText('滑动鼠标滚轮进行图片的放大和缩小', { exact: true }).waitFor();
          const viewport = page.getByTestId('zoomable-image-viewport');
          const frame = page.getByTestId('zoomable-image-transform');
          await viewport.locator('img').waitFor();
          const box = await viewport.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const scale = () => frame.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
          await page.mouse.wheel(0, -400);
          await page.waitForTimeout(150);
          assert.ok(await scale() > 1, 'wheel up must enlarge image');
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(150);
          assert.ok(await frame.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41) > 0, 'enlarged image remains draggable');
          await page.mouse.wheel(0, -20000);
          await page.waitForTimeout(150);
          assert.equal(await scale(), 4);
          await page.mouse.wheel(0, 20000);
          await page.waitForTimeout(150);
          assert.equal(await scale(), 1);
          assert.equal(await frame.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41), 0);
          await button('关闭图片预览').click();
          await button('放大查看模型图片').click();
          assert.equal(await scale(), 1, 'reopening image resets transform');
        });
        assert.deepEqual(errors, [], 'no browser runtime errors');
      } finally { await context.close(); }
    }
    assert.deepEqual(failures, []);
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
