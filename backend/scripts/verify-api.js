const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-manage-api-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.JWT_SECRET = 'verify-secret';
process.env.STORE_DRIVER = 'file';
process.env.NODE_ENV = 'test';
process.env.SKIP_WINDOWS_SHELL_THUMBNAIL = '1';

const app = require('../server');

const readJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
};

const main = async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  let authToken = '';

  const request = async (endpoint, options = {}) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(`${options.method || 'GET'} ${endpoint} failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  };

  try {
    const root = await request('/');
    if (root.status !== 'OK' || root.apiBase !== '/api') {
      throw new Error('Root endpoint did not return API metadata');
    }

    const health = await request('/health');
    if (health.status !== 'OK') {
      throw new Error('Health check did not return OK');
    }

    const anonymousRead = await fetch(`${baseUrl}/api/models`);
    if (anonymousRead.status !== 401) {
      throw new Error(`Anonymous business read should require auth, got ${anonymousRead.status}`);
    }

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'Admin123456' }),
    });
    if (!login.token || login.user.role !== 'owner') {
      throw new Error('Login did not return the default owner token');
    }
    authToken = login.token;

    const viewer = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'viewer@example.com',
        password: 'Viewer123456',
        name: 'Verify Viewer',
        role: 'viewer',
      }),
    });

    const forbiddenWrite = await fetch(`${baseUrl}/api/materials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewer.token}`,
      },
      body: JSON.stringify({ type: 'PLA', brand: 'Viewer', color: 'Nope' }),
    });
    if (forbiddenWrite.status !== 403) {
      throw new Error(`Viewer write should be forbidden, got ${forbiddenWrite.status}`);
    }

    const [initialOrders, initialModels, initialMaterials, initialLots, initialTransactions] = await Promise.all([
      request('/api/orders'),
      request('/api/models'),
      request('/api/materials'),
      request('/api/stock/lots'),
      request('/api/stock/inventory/txns'),
    ]);
    for (const [name, result] of [
      ['orders', initialOrders],
      ['models', initialModels],
      ['materials', initialMaterials],
      ['stock lots', initialLots],
      ['inventory transactions', initialTransactions],
    ]) {
      if (result.total !== 0) {
        throw new Error(`Clean store should start with no ${name}, got ${result.total}`);
      }
    }

    const model = await request('/api/models', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Verify Model',
        description: 'verify model description',
        source: 'original',
      }),
    });

    const modelUploadForm = new FormData();
    modelUploadForm.append('originalName', '手机支架.stl');
    modelUploadForm.append('file', new Blob(['solid verify\nendsolid verify\n'], { type: 'application/sla' }), 'verify.stl');
    const modelUploadResponse = await fetch(`${baseUrl}/api/models/${model.id}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: modelUploadForm,
    });
    const modelUpload = await readJson(modelUploadResponse);
    if (!modelUploadResponse.ok || !modelUpload.file?.fileKey) {
      throw new Error(`Model upload failed: ${JSON.stringify(modelUpload)}`);
    }
    if (modelUpload.file.name !== '手机支架.stl') {
      throw new Error(`Model upload did not preserve UTF-8 filename: ${JSON.stringify(modelUpload.file)}`);
    }

    const threeMfUploadForm = new FormData();
    threeMfUploadForm.append('originalName', '彩色模型.3mf');
    threeMfUploadForm.append('file', new Blob(['not-a-real-zip'], { type: 'model/3mf' }), 'verify.3mf');
    const threeMfUploadResponse = await fetch(`${baseUrl}/api/models/${model.id}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: threeMfUploadForm,
    });
    const threeMfUpload = await readJson(threeMfUploadResponse);
    if (!threeMfUploadResponse.ok || !threeMfUpload.file?.fileKey) {
      throw new Error(`3MF upload failed: ${JSON.stringify(threeMfUpload)}`);
    }

    const stepUploadForm = new FormData();
    stepUploadForm.append('originalName', '装配结构.step');
    stepUploadForm.append('file', new Blob(['ISO-10303-21; END-ISO-10303-21;'], { type: 'model/step' }), 'verify.step');
    const stepUploadResponse = await fetch(`${baseUrl}/api/models/${model.id}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: stepUploadForm,
    });
    const stepUpload = await readJson(stepUploadResponse);
    if (!stepUploadResponse.ok || !stepUpload.file?.fileKey) {
      throw new Error(`STEP upload failed: ${JSON.stringify(stepUpload)}`);
    }

    const imageUploadForm = new FormData();
    imageUploadForm.append('type', 'cover');
    imageUploadForm.append('originalName', '封面图.png');
    imageUploadForm.append('file', new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'verify.png');
    const imageUploadResponse = await fetch(`${baseUrl}/api/models/${model.id}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: imageUploadForm,
    });
    const imageUpload = await readJson(imageUploadResponse);
    if (!imageUploadResponse.ok || !imageUpload.image?.fileKey) {
      throw new Error(`Model image upload failed: ${JSON.stringify(imageUpload)}`);
    }
    if (imageUpload.image.name !== '封面图.png') {
      throw new Error(`Model image upload did not preserve UTF-8 filename: ${JSON.stringify(imageUpload.image)}`);
    }

    const publicImageResponse = await fetch(`${baseUrl}${imageUpload.image.fileUrl}`);
    if (!publicImageResponse.ok) {
      throw new Error(`Public model image should be readable without auth, got ${publicImageResponse.status}`);
    }

    const protectedModelFileResponse = await fetch(`${baseUrl}${modelUpload.file.fileUrl}`);
    if (protectedModelFileResponse.status !== 401) {
      throw new Error(`Model file should still require auth, got ${protectedModelFileResponse.status}`);
    }

    const modelDetail = await request(`/api/models/${model.id}`);
    if (modelDetail.files.length !== 3 || modelDetail.images.length < 1) {
      throw new Error(`Model detail did not include uploaded files/images: ${JSON.stringify(modelDetail)}`);
    }

    const material = await request('/api/materials', {
      method: 'POST',
      body: JSON.stringify({
        type: 'PLA',
        brand: 'VerifyBrand',
        diameter: 1.75,
        color: 'Blue',
        unitPrice: 28,
        unit: 'kg',
      }),
    });

    const lot = await request('/api/stock/lots', {
      method: 'POST',
      body: JSON.stringify({
        materialId: material.id,
        lotNo: 'VERIFY-LOT-001',
        location: 'VERIFY',
        qty: 0,
      }),
    });

    await request('/api/stock/inventory/txns', {
      method: 'POST',
      body: JSON.stringify({ lotId: lot.id, type: 'in', qty: 250, notes: 'verify inbound' }),
    });

    await request('/api/stock/inventory/txns', {
      method: 'POST',
      body: JSON.stringify({ lotId: lot.id, type: 'adjust', qty: 200, notes: 'verify count' }),
    });

    const transactions = await request(`/api/stock/inventory/txns?lotId=${lot.id}`);
    if (transactions.total !== 2) {
      throw new Error('Inventory transaction ledger did not record both transactions');
    }

    const order = await request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customer: { name: 'Verify Customer', email: 'verify@example.com' },
        status: 'pending_review',
        items: [
          {
            modelId: model.id,
            modelName: model.name,
            materialType: material.type,
            color: material.color,
            quantity: 1,
            unitPrice: 99,
          },
        ],
        currency: 'CNY',
      }),
    });

    const attachmentForm = new FormData();
    attachmentForm.append('file', new Blob(['%PDF-verify'], { type: 'application/pdf' }), 'verify.pdf');
    const attachmentResponse = await fetch(`${baseUrl}/api/orders/upload-attachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: attachmentForm,
    });
    const attachment = await readJson(attachmentResponse);
    if (!attachmentResponse.ok || !attachment.fileKey) {
      throw new Error(`Attachment upload failed: ${JSON.stringify(attachment)}`);
    }

    const started = await request(`/api/orders/${order.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    if (started.status !== 'in_progress') {
      throw new Error('Order did not move to in_progress');
    }

    const completed = await request(`/api/orders/${order.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    if (completed.status !== 'completed') {
      throw new Error('Order did not move to completed');
    }

    const [ordersExport, modelsExport, materialsExport, stockExport] = await Promise.all([
      request('/api/orders/export'),
      request('/api/models/export'),
      request('/api/materials/export'),
      request('/api/stock/export'),
    ]);
    for (const item of [ordersExport, modelsExport, materialsExport, stockExport]) {
      if (!item.content || !item.filename) {
        throw new Error(`Export response is incomplete: ${JSON.stringify(item)}`);
      }
    }

    const oss = await request('/api/oss/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        accessKeyId: 'verify-key',
        secretAccessKey: 'verify-secret',
        bucket: 'verify-bucket',
        region: 'oss-cn-hangzhou',
        skipNetwork: true,
      }),
    });
    if (!oss.success || oss.buckets[0] !== 'verify-bucket' || !oss.uploadUrl) {
      throw new Error('OSS config validation failed');
    }

    const signedUpload = await request('/api/oss/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        objectKey: 'verify/model.stl',
        expire: 60,
        accessKeyId: 'verify-key',
        secretAccessKey: 'verify-secret',
        bucket: 'verify-bucket',
        region: 'oss-cn-hangzhou',
      }),
    });
    if (signedUpload.method !== 'PUT' || !signedUpload.url.includes('verify/model.stl')) {
      throw new Error('OSS upload signature did not include the expected object key');
    }

    const signedDownload = await request('/api/oss/download-url', {
      method: 'POST',
      body: JSON.stringify({
        objectKey: 'verify/model.stl',
        expire: 60,
        accessKeyId: 'verify-key',
        secretAccessKey: 'verify-secret',
        bucket: 'verify-bucket',
        region: 'oss-cn-hangzhou',
      }),
    });
    if (signedDownload.method !== 'GET' || !signedDownload.url.includes('verify/model.stl')) {
      throw new Error('OSS download signature did not include the expected object key');
    }

    const storePath = path.join(process.env.DATA_DIR, 'store.json');
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!persisted.orders.some((item) => item.id === order.id)) {
      throw new Error('Created order was not persisted to store.json');
    }

    console.log('API verification passed');
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
