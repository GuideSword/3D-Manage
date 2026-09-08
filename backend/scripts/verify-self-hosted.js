const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

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

const readJson = async (response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

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

    const missingToken = await fetch(`${baseUrl}/api/system/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: 'Verify Workshop',
        ownerName: 'Verify Owner',
        email: 'owner@example.com',
        password: 'OwnerPassword123!',
      }),
    });
    assert.equal(missingToken.status, 403);

    const wrongToken = await fetch(`${baseUrl}/api/system/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bootstrap-Token': 'wrong-bootstrap-token',
      },
      body: JSON.stringify({
        organizationName: 'Verify Workshop',
        ownerName: 'Verify Owner',
        email: 'owner@example.com',
        password: 'OwnerPassword123!',
      }),
    });
    assert.equal(wrongToken.status, 403);

    const bootstrapRequest = (email) => fetch(`${baseUrl}/api/system/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bootstrap-Token': process.env.BOOTSTRAP_TOKEN,
      },
      body: JSON.stringify({
        organizationName: 'Verify Workshop',
        ownerName: 'Verify Owner',
        email,
        password: 'OwnerPassword123!',
      }),
    });
    const concurrent = await Promise.all([
      bootstrapRequest('owner@example.com'),
      bootstrapRequest('second@example.com'),
    ]);
    assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 409]);
    const bootstrapResponse = concurrent.find((item) => item.status === 201);
    assert.equal(bootstrapResponse.status, 201);
    const bootstrap = await readJson(bootstrapResponse);
    assert.equal(bootstrap.user.role, 'owner');
    assert.ok(bootstrap.token);
    assert.equal(bootstrap.serverId, info.serverId);

    const repeatedBootstrap = await bootstrapRequest('third@example.com');
    assert.equal(repeatedBootstrap.status, 409);

    const oldVersionToken = jwt.sign(
      { sub: bootstrap.user.id, email: bootstrap.user.email, role: 'owner' },
      process.env.JWT_SECRET,
      {
        algorithm: 'HS256',
        audience: '3d-manage-api-v1',
        issuer: `3d-manage:${info.serverId}`,
      }
    );
    const oldVersionMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${oldVersionToken}` },
    });
    assert.equal(oldVersionMe.status, 401);

    const ownerMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${bootstrap.token}` },
    });
    assert.equal(ownerMe.status, 200);

    const persisted = fs.readFileSync(path.join(process.env.DATA_DIR, 'store.json'), 'utf8');
    assert.equal(persisted.includes(process.env.BOOTSTRAP_TOKEN), false);
    assert.equal(persisted.includes('OwnerPassword123!'), false);

    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Anonymous',
        email: 'anonymous@example.com',
        password: 'AnonymousPassword123!',
        role: 'staff',
      }),
    });
    assert.equal(registration.status, 404);
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
