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

    const staffResponse = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({
        name: 'Workshop Staff',
        email: 'staff@example.com',
        password: 'StaffPassword123!',
        role: 'staff',
      }),
    });
    assert.equal(staffResponse.status, 201);
    const staff = await readJson(staffResponse);
    assert.equal(staff.passwordHash, undefined);

    const ownerList = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${bootstrap.token}` },
    });
    assert.equal(ownerList.status, 200);
    const ownerListBody = await readJson(ownerList);
    assert.equal(ownerListBody.items.length, 2);

    const staffLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@example.com', password: 'StaffPassword123!' }),
    });
    assert.equal(staffLoginResponse.status, 200);
    const staffLogin = await readJson(staffLoginResponse);

    const staffList = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${staffLogin.token}` },
    });
    assert.equal(staffList.status, 403);

    const duplicate = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({
        name: 'Duplicate',
        email: 'STAFF@example.com',
        password: 'StaffPassword123!',
        role: 'staff',
      }),
    });
    assert.equal(duplicate.status, 409);

    const forbiddenOwnerCreate = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({
        name: 'Another Owner',
        email: 'another-owner@example.com',
        password: 'OwnerPassword123!',
        role: 'owner',
      }),
    });
    assert.equal(forbiddenOwnerCreate.status, 400);

    const deactivate = await fetch(`${baseUrl}/api/users/${staff.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(deactivate.status, 200);
    assert.equal((await readJson(deactivate)).active, false);

    const deactivatedSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${staffLogin.token}` },
    });
    assert.equal(deactivatedSession.status, 401);

    const reactivate = await fetch(`${baseUrl}/api/users/${staff.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ active: true }),
    });
    assert.equal(reactivate.status, 200);
    const staleAfterReactivation = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${staffLogin.token}` },
    });
    assert.equal(staleAfterReactivation.status, 401);

    const reloginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@example.com', password: 'StaffPassword123!' }),
    });
    assert.equal(reloginResponse.status, 200);
    const relogin = await readJson(reloginResponse);

    const roleChange = await fetch(`${baseUrl}/api/users/${staff.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ role: 'viewer' }),
    });
    assert.equal(roleChange.status, 200);
    assert.equal((await readJson(roleChange)).role, 'viewer');
    const staleAfterRoleChange = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${relogin.token}` },
    });
    assert.equal(staleAfterRoleChange.status, 401);

    const viewerLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@example.com', password: 'StaffPassword123!' }),
    });
    assert.equal(viewerLoginResponse.status, 200);
    const viewerLogin = await readJson(viewerLoginResponse);
    assert.equal(viewerLogin.user.role, 'viewer');

    const resetPassword = await fetch(`${baseUrl}/api/users/${staff.id}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ password: 'ResetPassword123!' }),
    });
    assert.equal(resetPassword.status, 200);
    const staleAfterReset = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` },
    });
    assert.equal(staleAfterReset.status, 401);

    const ownerMutation = await fetch(`${baseUrl}/api/users/${bootstrap.user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(ownerMutation.status, 409);

    const organizationUpdate = await fetch(`${baseUrl}/api/system/organization`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({ organizationName: 'Renamed Workshop' }),
    });
    assert.equal(organizationUpdate.status, 200);

    const viewerReloginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@example.com', password: 'ResetPassword123!' }),
    });
    assert.equal(viewerReloginResponse.status, 200);
    const viewerRelogin = await readJson(viewerReloginResponse);
    const viewerConfirm = await fetch(`${baseUrl}/api/agent/drafts/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerRelogin.token}`,
      },
      body: JSON.stringify({
        draft: {
          customer_name: 'Forbidden Customer',
          items: [{ material_type: 'PLA', qty: 1, unit_price: 10 }],
        },
      }),
    });
    assert.equal(viewerConfirm.status, 403);

    const auditStaffResponse = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({
        name: 'Audit Staff',
        email: 'audit-staff@example.com',
        password: 'AuditStaffPassword123!',
        role: 'staff',
      }),
    });
    assert.equal(auditStaffResponse.status, 201);
    const auditStaff = await readJson(auditStaffResponse);
    const auditStaffLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'audit-staff@example.com', password: 'AuditStaffPassword123!' }),
    });
    assert.equal(auditStaffLoginResponse.status, 200);
    const auditStaffLogin = await readJson(auditStaffLoginResponse);

    const staffRequest = (endpoint, options = {}) => fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditStaffLogin.token}`,
        ...(options.headers || {}),
      },
    });

    const materialResponse = await staffRequest('/api/materials', {
      method: 'POST',
      body: JSON.stringify({ type: 'PLA', brand: 'Verify', color: 'Black' }),
    });
    assert.equal(materialResponse.status, 201);
    const material = await readJson(materialResponse);
    const lotResponse = await staffRequest('/api/stock/lots', {
      method: 'POST',
      body: JSON.stringify({ materialId: material.id, lotNo: 'ACTOR-VERIFY', qty: 0 }),
    });
    assert.equal(lotResponse.status, 201);
    const lot = await readJson(lotResponse);
    const transactionResponse = await staffRequest('/api/stock/inventory/txns', {
      method: 'POST',
      body: JSON.stringify({ lotId: lot.id, type: 'in', qty: 100, actorId: 'forged-user' }),
    });
    assert.equal(transactionResponse.status, 201);
    const transaction = await readJson(transactionResponse);
    assert.equal(transaction.actorId, auditStaff.id);

    const createOrder = (customerName) => staffRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customer: { name: customerName },
        items: [{ materialType: 'PLA', quantity: 1, unitPrice: 20 }],
        status: 'pending_review',
      }),
    });
    const firstOrderResponse = await createOrder('First Customer');
    const secondOrderResponse = await createOrder('Second Customer');
    assert.equal(firstOrderResponse.status, 201);
    assert.equal(secondOrderResponse.status, 201);
    const firstOrder = await readJson(firstOrderResponse);
    const secondOrder = await readJson(secondOrderResponse);

    const directStatus = await staffRequest(`/api/orders/${secondOrder.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    assert.equal(directStatus.status, 400);
    assert.equal((await readJson(directStatus)).code, 'STATUS_REQUIRES_TRANSITION_ENDPOINT');

    const deleteFirst = await staffRequest(`/api/orders/${firstOrder.id}`, { method: 'DELETE' });
    assert.equal(deleteFirst.status, 200);
    const draftConfirm = await staffRequest('/api/agent/drafts/confirm', {
      method: 'POST',
      body: JSON.stringify({
        draft: {
          customer_name: 'AI Customer',
          due_date: '2026-09-30',
          notes: 'Created from verified draft',
          items: [{
            model_asset_id: 'model-1',
            material_type: 'PETG',
            color: 'Blue',
            qty: 2,
            unit_price: 30,
          }],
        },
      }),
    });
    assert.equal(draftConfirm.status, 200);
    const confirmedOrder = (await readJson(draftConfirm)).order;
    assert.notEqual(confirmedOrder.id, secondOrder.id);
    const confirmedDetailResponse = await staffRequest(`/api/orders/${confirmedOrder.id}`);
    assert.equal(confirmedDetailResponse.status, 200);
    const confirmedDetail = await readJson(confirmedDetailResponse);
    assert.equal(confirmedDetail.customer.name, 'AI Customer');
    assert.equal(confirmedDetail.items[0].quantity, 2);

    const actorStore = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'store.json'), 'utf8'));
    assert.equal(actorStore.inventoryTxns.find((item) => item.id === transaction.id).actorId, auditStaff.id);
    const transactionAudit = actorStore.auditLogs.find((item) => (
      item.entity === 'stockLots'
      && item.entityId === lot.id
      && item.action === 'inventory.in'
    ));
    assert.equal(transactionAudit.actorId, auditStaff.id);

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

    const ownerPasswordChange = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`,
      },
      body: JSON.stringify({
        currentPassword: 'OwnerPassword123!',
        newPassword: 'ChangedOwnerPassword123!',
      }),
    });
    assert.equal(ownerPasswordChange.status, 200);
    const staleOwnerSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${bootstrap.token}` },
    });
    assert.equal(staleOwnerSession.status, 401);

    const changedOwnerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: bootstrap.user.email,
        password: 'ChangedOwnerPassword123!',
      }),
    });
    assert.equal(changedOwnerLogin.status, 200);
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
