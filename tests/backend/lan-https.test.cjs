const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHttpTransport } = require('../../backend/config/httpTransport');
const { assertDownloadTransport } = require('../../backend/modules/modelDownloads/transport');

const directory = process.env.LAN_HTTPS_TEST_DIR;
const get = (port, options = {}) => new Promise((resolve, reject) => {
  https.get({ hostname: '127.0.0.1', port, path: '/api/system/info', ...options }, res => {
    res.resume(); res.once('end', () => resolve(res.statusCode));
  }).once('error', reject);
});
test('real LAN certificate validates CA and host, permits secure operations and healthcheck', { skip: !directory }, async t => {
  const env = { ...process.env, TLS_CERT_FILE: path.join(directory, 'server.crt'), TLS_KEY_FILE: path.join(directory, 'server.key'), TLS_CA_FILE: path.join(directory, 'rootCA.crt') };
  const ca = fs.readFileSync(env.TLS_CA_FILE);
  const express = require('../../backend/node_modules/express');
  const app = express();
  app.get('/api/system/info', (req, res) => { assertDownloadTransport(req); res.json({ product: '3D Manage', serverId: 'fixture' }); });
  const server = createHttpTransport(app, env).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const port = server.address().port;
  assert.equal(await get(port, { ca, servername: 'localhost' }), 200);
  assert.equal(await get(port, { ca, servername: 'localhost', checkServerIdentity: (_host, cert) => require('node:tls').checkServerIdentity('192.168.0.33', cert) }), 200);
  await assert.rejects(get(port), e => /CERT|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(e.code));
  await assert.rejects(get(port, { ca, servername: 'wrong.example.test' }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  assert.throws(() => assertDownloadTransport({ secure: false, ip: '192.168.0.33', headers: { 'x-forwarded-proto': 'https' } }), { code: 'DOWNLOAD_HTTPS_REQUIRED' });
  const runHealth = extra => new Promise(resolve => {
    const child = spawn(process.execPath, ['backend/scripts/healthcheck.js'], { env: { ...env, PORT: String(port), DATA_DIR: directory, UPLOAD_DIR: directory, ...extra }, windowsHide: true });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.once('close', code => resolve({ code, stderr }));
  });
  assert.deepEqual(await runHealth({}), { code: 0, stderr: '' });
  assert.equal((await runHealth({ TLS_CA_FILE: path.join(directory, 'missing-ca') })).code, 1);
});

test('HTTP healthcheck remains compatible with installations without TLS', async t => {
  const server = require('node:http').createServer((_req, res) => res.end(JSON.stringify({ product: '3D Manage', serverId: 'fixture' }))).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'http-health-'));
  t.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true }); });
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['backend/scripts/healthcheck.js'], { env: { ...process.env, PORT: String(server.address().port), TLS_CERT_FILE: '', TLS_KEY_FILE: '', DATA_DIR: dir, UPLOAD_DIR: dir }, windowsHide: true });
    child.once('close', resolve);
  });
  assert.equal(code, 0);
});
