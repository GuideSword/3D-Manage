const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-manage-self-hosted-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.STORE_DRIVER = 'file';
process.env.JWT_SECRET = 'self-hosted-verify-secret-with-at-least-32-characters';
process.env.AGENT_KEY_ENC_SECRET = 'agent-verify-secret-with-at-least-32-characters';
process.env.BOOTSTRAP_TOKEN = 'bootstrap-test-only-32-byte-equivalent-secret';
process.env.NODE_ENV = 'test';
process.env.SKIP_WINDOWS_SHELL_THUMBNAIL = '1';

const app = require('../server');
const { closeStore } = require('../utils/store');

const main = async () => {
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/system/info`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const info = await response.json();
    assert.equal(info.product, '3D Manage');
    assert.equal(info.apiVersion, '1');
    assert.equal(info.initialized, false);
    assert.match(info.serverId, /^[0-9a-f-]{36}$/i);

    const second = await fetch(`${baseUrl}/api/system/info`).then((item) => item.json());
    assert.equal(second.serverId, info.serverId);
    console.log('Self-hosted verification passed');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await closeStore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
