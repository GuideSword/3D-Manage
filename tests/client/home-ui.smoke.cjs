// Run against a fresh Expo web export. All API responses are isolated fixtures.
// NODE_PATH may point to a separately installed Playwright runtime.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('.tmp/xiaoli-export');
const output = path.resolve('docs/ui-concepts');
const orders = [
  { id: 'demo-001', customer: { name: '创意花瓶订单' }, status: 'in_progress', createdAt: '2026-09-11T10:00:00Z', items: [] },
  { id: 'demo-002', customer: { name: '机械齿轮组件' }, status: 'pending_review', createdAt: '2026-09-10T10:00:00Z', items: [] },
];
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
  res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [];
  try {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 1240 }, deviceScaleFactor: 2, colorScheme: mode });
      const page = await context.newPage();
      let failPending = false;
      const requests = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        requests.push(url.pathname + url.search);
        let body;
        if (url.pathname.endsWith('/system/info')) body = { product: '3D Manage', apiVersion: '1', serverVersion: 'test', serverId: 'xiaoli-ui-fixture', initialized: true, organizationName: 'UI 测试工坊' };
        else if (url.pathname.endsWith('/auth/login')) body = { token: 'ui-test-fixture-token', user: { id: 'test-owner', email: 'ui@example.test', role: 'owner' } };
        else if (url.pathname.endsWith('/auth/me')) body = { user: { id: 'test-owner', email: 'ui@example.test', role: 'owner' } };
        else if (url.pathname.endsWith('/orders')) {
          if (failPending && url.searchParams.get('status') === 'pending_review') {
            await route.fulfill({ status: 500, json: { error: 'fixture unavailable' } }); return;
          }
          const status = url.searchParams.get('status');
          const items = status ? orders.filter(o => o.status === status) : orders;
          body = { items, total: status === 'pending_review' ? 0 : items.length };
        } else if (url.pathname.includes('/orders/')) body = orders[0];
        else if (url.pathname.includes('/stock')) body = [];
        else body = { items: [], total: 0 };
        await route.fulfill({ json: body });
      });
      await page.goto(appUrl);
      await page.getByPlaceholder('例如 192.168.1.10:5000').fill(appUrl);
      await page.getByText('测试并保存', { exact: true }).click();
      await page.getByPlaceholder('请输入邮箱').fill('ui@example.test');
      await page.getByPlaceholder('请输入密码').fill('fixture-password');
      await page.getByText('登录', { exact: true }).click();
      await page.getByText('欢迎回来！', { exact: true }).waitFor();
      await page.getByText('创意花瓶订单', { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `xiaoli-home-${mode}-implemented.png`) });
      assert.equal(await page.getByRole('button', { name: '待审核订单 0', exact: true }).count(), 2);
      assert.equal(await page.getByRole('button', { name: '执行中订单 1', exact: true }).count(), 2);
      await page.setViewportSize({ width: 320, height: 740 });
      await page.screenshot({ path: path.join(output, `xiaoli-home-${mode}-narrow.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal page overflow');
      await page.getByRole('button', { name: '生产进度', exact: true }).click();
      await page.getByText('订单中心', { exact: true }).waitFor();
      assert.ok(requests.some(url => /orders\?.*status=in_progress/.test(url)), 'Production shortcut passes status');
      await page.getByRole('tab', { name: '首页', exact: true }).click();
      await page.getByRole('button', { name: '全部订单', exact: true }).click();
      await page.getByText('订单中心', { exact: true }).waitFor();
      await page.getByText('机械齿轮组件', { exact: true }).last().waitFor();
      await page.getByRole('tab', { name: '首页', exact: true }).click();
      await page.getByRole('button', { name: '库存风险', exact: true }).click();
      await page.getByText('库存批次', { exact: true }).first().waitFor();
      await page.getByRole('tab', { name: '首页', exact: true }).click();
      failPending = true;
      await page.reload();
      await page.getByText('部分数据加载失败 · 点击重试', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '待审核订单 —', exact: true }).count(), 2);
      await page.getByText('创意花瓶订单', { exact: true }).waitFor();
      failPending = false;
      await page.getByText('部分数据加载失败 · 点击重试', { exact: true }).click();
      await page.getByRole('button', { name: '待审核订单 0', exact: true }).first().waitFor();
      console.log(`${mode}: rendered, counts and production navigation passed`);
      await context.close();
    }
    assert.deepEqual(failures, [], 'No runtime errors');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
