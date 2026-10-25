'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'model-import-e2e-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
const { initializeStore, closeStore } = require('../../backend/utils/store');
const { closeDb } = require('../../backend/db/agent');
const { createLegacyModelImportService } = require('../../backend/modules/modelImport/legacyService');

const actor = { id: 'e2e-owner', role: 'owner' };
const service = createLegacyModelImportService();
const fixture = n => {
  const buffer = Buffer.from(`fixture-${n}`);
  return { buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), itemId: `item-${n}`, relativePath: `fixtures/model-${n}.stl`, originalName: `model-${n}.stl`, size: buffer.length };
};

test.before(async () => initializeStore());
test.after(async () => { await closeStore(); closeDb(); await fs.rm(root, { recursive: true, force: true }); });

test('cancellation preserves completed items and cleans the in-flight item', async () => {
  const job = await service.createJob(actor, { clientJobId: 'cancel-five', options: { concurrency: 2 } });
  for (const n of [1, 2]) {
    const item = await service.prepareItem(actor, job.id, fixture(n));
    await service.completeFile(actor, job.id, item.id, { buffer: fixture(n).buffer });
  }
  const inFlight = await service.prepareItem(actor, job.id, fixture(3));
  await service.prepareItem(actor, job.id, fixture(4));
  await service.prepareItem(actor, job.id, fixture(5));
  await service.cancelJob(actor, job.id);
  const result = await service.cleanupJob(actor, job.id);
  assert.equal(result.cleaned, 3);
  const current = await service.getJob(actor, job.id);
  assert.deepEqual(current.items.map(item => item.state), ['completed', 'completed', 'cleaned', 'cleaned', 'cleaned']);
  assert.equal(current.items.find(item => item.id === inFlight.id).state, 'cleaned');
});

test('a cancelled job retains its terminal state for later resume decisions', async () => {
  const job = await service.createJob(actor, { clientJobId: 'cancel-retry' });
  const item = await service.prepareItem(actor, job.id, fixture(6));
  await service.cancelJob(actor, job.id);
  await service.cleanupJob(actor, job.id);
  const current = await service.getJob(actor, job.id);
  assert.equal(current.state, 'cancelled');
  assert.equal(current.items[0].state, 'cleaned');
});
