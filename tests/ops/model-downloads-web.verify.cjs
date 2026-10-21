'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
async function main() {
  const root = path.resolve('.tmp/model-downloads'), config = JSON.parse(await fs.readFile(path.join(root, 'private-config.json'), 'utf8')), ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8'));
  assert.equal(config.runId, ready.runId); assert.equal(new URL(ready.origin).hostname, '127.0.0.1');
  const playwright = require(process.env.ERP_02C_PLAYWRIGHT_MODULE || 'C:/Users/sword/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  const checks = [], errors = []; let page, context, sourceReads = 0;
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  const pass = value => { checks.push(value); console.log(value); };
  async function login(role, width = 1440) {
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1100 }, acceptDownloads: true });
    // Self-signed fixture certificate is accepted only in this disposable test context; no OS trust is changed.
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    page.on('request', request => { if (request.url().includes('/api/files/models/')) sourceReads++; });
    await page.goto(ready.origin);
    await page.getByPlaceholder('例如 192.168.1.10:5000').fill(ready.origin + '/api');
    await button('测试并保存').click();
    await page.getByPlaceholder('请输入邮箱').fill(role + '@download-ui.example.test');
    await page.getByPlaceholder('请输入密码').fill(config.password); await button('登录').click();
  }
  async function model() {
    await page.getByText('模型', { exact: true }).filter({ visible: true }).last().click();
    await page.getByText('下载保护验收模型', { exact: true }).click();
    await button('下载').waitFor();
  }
  const consent = () => button('同意将模型拉取至本地').click();
  try {
    await login('owner'); await model();
    let beforeCancel = sourceReads;
    await button('下载').click(); await button('验证并下载').waitFor();
    assert.equal(await button('验证并下载').isDisabled(), true);
    await button('取消').click(); assert.equal(sourceReads, beforeCancel);
    pass('取消本地拉取不读取模型字节，未同意时不能继续');
    await button('下载').click(); await consent();
    const unprotectedDownload = page.waitForEvent('download'); await button('验证并下载').click();
    assert.deepEqual(await fs.readFile(await (await unprotectedDownload).path()), Buffer.from('solid protected_model\nendsolid protected_model'));
    beforeCancel = sourceReads;
    pass('尚未启用下载密码时，同意后仍可正常下载原有模型');
    await page.mouse.click(24, 32); // Observed model-detail header back button.
    await page.getByText('设置', { exact: true }).filter({ visible: true }).last().click();
    await page.getByText('模型下载保护', { exact: true }).waitFor();
    await page.getByRole('switch', { name: '启用模型下载密码', exact: true }).click();
    await page.getByLabel('设置模型下载密码', { exact: true }).fill('web-download-password-123');
    await page.getByLabel('确认模型下载密码', { exact: true }).fill('web-download-password-123');
    const save = page.waitForResponse(response => response.url().endsWith('/model-downloads/policy') && response.request().method() === 'PUT');
    await button('保存下载保护').click(); assert.equal((await save).status(), 200);
    pass('Owner通过实际设置页开启统一下载保护，HTTPS请求成功');
    await model(); await button('下载').click(); await consent();
    await page.getByLabel('模型下载密码', { exact: true }).fill('wrong'); await button('验证并下载').click();
    await page.getByText('模型下载密码错误', { exact: true }).waitFor();
    assert.equal(sourceReads, beforeCancel);
    pass('错误密码只显示错误，不读取或分享源文件');
    await page.getByLabel('模型下载密码', { exact: true }).fill('web-download-password-123');
    const downloading = page.waitForEvent('download'); await button('验证并下载').click();
    const download = await downloading; assert.equal(await download.failure(), null);
    assert.deepEqual(await fs.readFile(await download.path()), Buffer.from('solid protected_model\nendsolid protected_model'));
    pass('正确密码下载实际文件，字节与服务器源文件一致');
    await button('在 Bambu Studio 中打开').click();
    await button('查看助手源码与安装说明').waitFor(); await consent();
    await page.getByLabel('模型下载密码', { exact: true }).fill('web-download-password-123');
    await button('已安装助手，验证并继续').click(); await button('打开 Bambu Studio').waitFor();
    await page.screenshot({ path: path.join(root, 'web-handoff-ready.png'), fullPage: true });
    await button('取消').click();
    pass('Studio交接显示安装/本地副本说明，验证后等待明确打开；测试取消且未唤起软件');
    await context.close(); await login('viewer', 430); await model();
    await button('下载').click(); await consent();
    await page.getByLabel('模型下载密码', { exact: true }).fill('web-download-password-123');
    const viewerDownload = page.waitForEvent('download'); await button('验证并下载').click();
    assert.equal(await (await viewerDownload).failure(), null);
    await page.mouse.click(24, 32); // Observed model-detail header back button.
    await page.getByText('设置', { exact: true }).filter({ visible: true }).last().click();
    assert.equal(await page.getByText('模型下载保护', { exact: true }).count(), 0);
    pass('窄屏Viewer可授权下载，但没有管理员设置入口');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(root, 'web-verification.json'), JSON.stringify({ browser: 'Edge', fixtureRunId: ready.runId, checks, errors, sourceReads, realStudioOpened: false, testCertificateOnly: true }, null, 2));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(root, 'web-failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(root, 'web-failure.txt'), (await page.locator('body').innerText()).slice(0, 12000)); }
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
