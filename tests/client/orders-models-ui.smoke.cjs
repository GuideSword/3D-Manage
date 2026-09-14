'use strict';

// Run against a fresh Expo web export. API responses are isolated fixtures.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('.tmp/xiaoli-export');
const output = path.resolve('docs/ui-concepts');

const orders = [
  {
    id: 'demo-001',
    customer: { name: '创意花瓶订单' },
    status: 'in_progress',
    total: 368,
    dueDate: '2026-09-18',
    createdAt: '2026-09-11T10:00:00Z',
    items: [{ modelName: '流线花瓶', materialType: 'PLA', color: '珠光白', quantity: 2 }],
  },
  {
    id: 'demo-002',
    customer: { name: '机械齿轮组件' },
    status: 'pending_review',
    total: 520,
    dueDate: '2026-09-20',
    createdAt: '2026-09-10T10:00:00Z',
    items: [{ modelName: '齿轮组', materialType: 'PETG', color: '深灰', quantity: 4 }],
  },
];

const models = [
  {
    id: 'model-001',
    name: '流线花瓶 v2',
    source: 'original',
    description: '参数化曲面花瓶，适合 PLA 丝绸材料。',
    files: [{ id: 'file-1' }],
    images: [],
    updatedAt: '2026-09-12T10:00:00Z',
  },
  {
    id: 'model-002',
    name: '机械齿轮组',
    source: 'imported',
    description: '高精度啮合组件，包含三种齿数。',
    files: [{ id: 'file-2' }, { id: 'file-3' }],
    images: [],
    updatedAt: '2026-09-10T10:00:00Z',
  },
];

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  res.setHeader('Content-Type', contentTypes[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});

const waitUntil = async (predicate, message, timeout = 5000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const fixtureList = (items, url, field) => {
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const filter = url.searchParams.get(field);
  const filtered = items.filter((item) => {
    const matchesSearch = !search || JSON.stringify(item).toLowerCase().includes(search);
    const matchesFilter = !filter || item[field] === filter;
    return matchesSearch && matchesFilter;
  });
  return { items: filtered, total: filtered.length };
};

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [];

  try {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 1240 },
        deviceScaleFactor: 2,
        colorScheme: mode,
      });
      const page = await context.newPage();
      const requests = [];
      page.on('pageerror', (error) => failures.push(`${mode}: ${error.message}`));

      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.pathname + url.search);
        let body;

        if (url.pathname.endsWith('/system/info')) {
          body = { product: '3D Manage', apiVersion: '1', serverVersion: 'test', serverId: 'xiaoli-list-ui', initialized: true, organizationName: 'UI 测试工坊' };
        } else if (url.pathname.endsWith('/auth/login')) {
          body = { token: 'ui-test-fixture-token', user: { id: 'test-owner', email: 'ui@example.test', role: 'owner' } };
        } else if (url.pathname.endsWith('/auth/me')) {
          body = { user: { id: 'test-owner', email: 'ui@example.test', role: 'owner' } };
        } else if (/\/orders\/[^/]+$/.test(url.pathname)) {
          body = orders.find((order) => url.pathname.endsWith(`/${order.id}`)) || orders[0];
        } else if (url.pathname.endsWith('/orders')) {
          body = fixtureList(orders, url, 'status');
        } else if (/\/models\/[^/]+$/.test(url.pathname)) {
          body = models.find((model) => url.pathname.endsWith(`/${model.id}`)) || models[0];
        } else if (url.pathname.endsWith('/models')) {
          body = fixtureList(models, url, 'source');
        } else if (url.pathname.includes('/stock')) {
          body = { items: [], total: 0 };
        } else {
          body = { items: [], total: 0 };
        }

        await route.fulfill({ json: body });
      });

      await page.goto(appUrl);
      await page.getByPlaceholder('例如 192.168.1.10:5000').fill(appUrl);
      await page.getByText('测试并保存', { exact: true }).click();
      await page.getByPlaceholder('请输入邮箱').fill('ui@example.test');
      await page.getByPlaceholder('请输入密码').fill('fixture-password');
      await page.getByText('登录', { exact: true }).click();
      await page.getByText('欢迎回来！', { exact: true }).waitFor();

      await page.getByRole('tab', { name: '订单', exact: true }).click();
      await page.getByText('订单中心', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).count(), 1);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `xiaoli-orders-${mode}-implemented.png`) });
      await page.setViewportSize({ width: 320, height: 740 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${mode} orders has no horizontal overflow`);
      await page.screenshot({ path: path.join(output, `xiaoli-orders-${mode}-narrow.png`) });
      await page.setViewportSize({ width: 390, height: 1240 });

      await page.getByPlaceholder('搜索客户、订单号或备注').fill('机械');
      await waitUntil(() => requests.some((url) => /orders\?.*search=/.test(url)), 'Orders search request was not sent');
      await page.getByText('机械齿轮组件', { exact: true }).last().waitFor();
      await page.getByRole('button', { name: '待审核', exact: true }).click();
      await waitUntil(() => requests.some((url) => /orders\?.*status=pending_review/.test(url)), 'Orders status request was not sent');

      await page.getByRole('tab', { name: '模型', exact: true }).click();
      await page.getByText('模型图鉴', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).count(), 1);
      await page.getByText('流线花瓶 v2', { exact: true }).last().click();
      await page.getByText('模型详情', { exact: true }).waitFor();
      await page.goBack();
      await page.getByText('模型图鉴', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `xiaoli-models-${mode}-implemented.png`) });
      await page.setViewportSize({ width: 320, height: 740 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${mode} models has no horizontal overflow`);
      await page.screenshot({ path: path.join(output, `xiaoli-models-${mode}-narrow.png`) });
      await page.setViewportSize({ width: 390, height: 1240 });

      await page.getByPlaceholder('搜索模型名称、描述或文件名').fill('齿轮');
      await waitUntil(() => requests.some((url) => /models\?.*search=/.test(url)), 'Models search request was not sent');
      await page.getByText('机械齿轮组', { exact: true }).last().waitFor();
      await page.getByRole('button', { name: '导入', exact: true }).click();
      await waitUntil(() => requests.some((url) => /models\?.*source=imported/.test(url)), 'Models source request was not sent');
      await page.getByRole('button', { name: '切换为列表视图', exact: true }).click();
      await page.getByText('机械齿轮组', { exact: true }).last().waitFor();

      console.log(`${mode}: orders and models UI contract passed`);
      await context.close();
    }

    assert.deepEqual(failures, [], 'No runtime errors');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
