const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'model-import-http-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
const { initializeStore, closeStore } = require('../../backend/utils/store');
const { closeDb } = require('../../backend/db/agent');
const { createLegacyModelImportService } = require('../../backend/modules/modelImport/legacyService');

const actor = { id: 'owner-1', role: 'owner' };
const service = createLegacyModelImportService();

test.before(async () => initializeStore());
test.after(async () => { await closeStore(); closeDb(); await fs.rm(root, { recursive: true, force: true }); });

test('creates an imported model and is idempotent for the same item', async () => {
  const buffer = Buffer.from('solid model');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const job = await service.createJob(actor, { clientJobId: 'client-1', options: { concurrency: 2 } });
  const item = await service.prepareItem(actor, job.id, { itemId: 'item-1', relativePath: 'nested/model.stl', originalName: 'model.stl', size: buffer.length, sha256 });
  const completed = await service.completeFile(actor, job.id, item.id, { buffer });
  const repeated = await service.completeFile(actor, job.id, item.id, { buffer });
  assert.equal(completed.state, 'completed');
  assert.equal(repeated.modelId, completed.modelId);
  const current = await service.getJob(actor, job.id);
  assert.equal(current.items[0].state, 'completed');
});

test('rejects corrupted bytes and cleans pending items without touching completed items', async () => {
  const buffer = Buffer.from('valid');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const job = await service.createJob(actor, { clientJobId: 'client-2' });
  const item = await service.prepareItem(actor, job.id, { itemId: 'item-2', relativePath: 'bad.stl', originalName: 'bad.stl', size: buffer.length, sha256 });
  await assert.rejects(() => service.completeFile(actor, job.id, item.id, { buffer: Buffer.from('bad!!') }), /文件校验失败/);
  const result = await service.cleanupJob(actor, job.id);
  assert.equal(result.cleaned, 1);
  const current = await service.getJob(actor, job.id);
  assert.equal(current.items[0].state, 'cleaned');
});

test('keeps factual description when optional AI enhancement fails', async () => {
  const job = await service.createJob(actor, { clientJobId: 'client-3' });
  const buffer = Buffer.from('describe');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const item = await service.prepareItem(actor, job.id, { itemId: 'item-3', relativePath: 'describe.obj', originalName: 'describe.obj', size: buffer.length, sha256 });
  await service.completeFile(actor, job.id, item.id, { buffer });
  const described = await service.describe(actor, job.id, item.id, { aiDescription: true, generate: () => { throw new Error('provider down'); } });
  assert.match(described.descriptionFacts, /describe\.obj/);
  assert.equal(described.descriptionAi, null);
});
