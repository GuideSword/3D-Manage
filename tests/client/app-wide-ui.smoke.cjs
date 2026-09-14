'use strict';

// Representative full-app visual smoke against an isolated Expo Web export.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('.tmp/xiaoli-export');
const output = path.resolve('docs/ui-concepts');

const material = {
  id: 'material-001',
  type: 'PLA',
  materialType: 'PLA',
  brand: '小鲤精选',
  color: '星云紫',
  diameter: 1.75,
  density: 1.24,
  unit: 'g',
  unitPrice: 0.12,
  notes: '适合精细模型与展示件',
};

const lot = {
  id: 'lot-001',
  materialId: material.id,
  lotNo: 'PLA-260913',
  serialNo: 'XL-001',
  qty: 860,
  status: 'in_stock',
  createdAt: '2026-09-13T02:00:00Z',
};

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

const apiBody = (url) => {
  if (url.pathname.endsWith('/system/info')) {
    return { product: '3D Manage', apiVersion: '1', serverVersion: 'test', serverId: 'xiaoli-app-ui', initialized: true, organizationName: '小鲤测试工坊' };
  }
  if (url.pathname.endsWith('/auth/login')) {
    return { token: 'ui-test-fixture-token', user: { id: 'test-owner', name: '测试 Owner', email: 'ui@example.test', role: 'owner' } };
  }
  if (url.pathname.endsWith('/auth/me')) {
    return { user: { id: 'test-owner', name: '测试 Owner', email: 'ui@example.test', role: 'owner' } };
  }
  if (url.pathname.endsWith(`/materials/${material.id}`)) return material;
  if (url.pathname.endsWith('/materials')) return { items: [material], total: 1 };
  if (url.pathname.endsWith('/stock/lots')) return { items: [lot], total: 1 };
  if (url.pathname.endsWith('/users')) return { items: [], total: 0 };
  if (url.pathname.endsWith('/orders')) return { items: [], total: 0 };
  if (url.pathname.endsWith('/models')) return { items: [], total: 0 };
  return { items: [], total: 0 };
};

const login = async (page, appUrl, mode) => {
  await page.goto(appUrl);
  await page.screenshot({ path: path.join(output, `xiaoli-app-wide-server-${mode}.png`) });
  await page.getByPlaceholder('例如 192.168.1.10:5000').fill(appUrl);
  await page.getByText('测试并保存', { exact: true }).click();
  await page.getByPlaceholder('请输入邮箱').waitFor();
  await page.screenshot({ path: path.join(output, `xiaoli-app-wide-login-${mode}.png`) });
  await page.getByPlaceholder('请输入邮箱').fill('ui@example.test');
  await page.getByPlaceholder('请输入密码').fill('fixture-password');
  await page.getByText('登录', { exact: true }).click();
  await page.getByText('欢迎回来！', { exact: true }).waitFor();
};

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [];

  try {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 1240 }, deviceScaleFactor: 2, colorScheme: mode });
      const page = await context.newPage();
      page.on('pageerror', (error) => failures.push(`${mode}: ${error.message}`));
      await page.route('**/api/**', async (route) => {
        await route.fulfill({ json: apiBody(new URL(route.request().url())) });
      });

      await login(page, appUrl, mode);
      await page.getByRole('tab', { name: '耗材', exact: true }).click();
      await page.getByText('耗材仓库', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).count(), 1);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-materials-${mode}.png`) });

      await page.getByText('PLA', { exact: true }).first().click();
      await page.getByText('耗材详情', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-material-detail-${mode}.png`) });
      await page.goto(appUrl);
      await page.getByText('欢迎回来！', { exact: true }).waitFor();

      await page.getByRole('tab', { name: '耗材', exact: true }).click();
      await page.getByRole('button', { name: '新建耗材', exact: true }).click();
      await page.getByRole('heading', { name: '新建耗材', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-create-material-${mode}.png`) });
      await page.goto(appUrl);
      await page.getByText('欢迎回来！', { exact: true }).waitFor();

      await page.getByRole('tab', { name: '耗材', exact: true }).click();
      await page.getByText('库存', { exact: true }).first().click();
      await page.getByText('库存操作', { exact: true }).waitFor();
      await page.getByText('入库', { exact: true }).first().click();
      await page.getByRole('heading', { name: '入库操作', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-inbound-${mode}.png`) });
      await page.goto(appUrl);
      await page.getByText('欢迎回来！', { exact: true }).waitFor();

      await page.getByRole('tab', { name: '设置', exact: true }).click();
      await page.getByText('设置中心', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-settings-${mode}.png`) });

      await page.setViewportSize({ width: 320, height: 740 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${mode} settings has no horizontal overflow`);
      await page.setViewportSize({ width: 390, height: 1240 });

      await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).click();
      await page.getByText('小鲤已就位', { exact: true }).waitFor();
      assert.equal(await page.getByText('ฅ^•ﻌ•^ฅ', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '打开小鲤 AI 助手', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, `xiaoli-app-wide-agent-${mode}.png`) });

      console.log(`${mode}: app-wide primary, detail, settings and agent contract passed`);
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
