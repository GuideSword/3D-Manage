'use strict';

async function createLegacyRuntime() {
  // All legacy imports and initialization stay behind the selected factory.
  const { initializeStore, closeStore } = require('../utils/store');
  const { initStorage } = require('../config/storage');
  const { getDb, closeDb } = require('../db/agent');
  const closeResources = async () => { try { await closeStore(); } finally { closeDb(); } };
  try {
    await initializeStore();
    await initStorage();
    getDb().prepare('SELECT 1').get();
    const { retryPendingAttachmentCleanup } = require('../agent/attachmentStore');
    const cleanup = await retryPendingAttachmentCleanup({ limit: 25 });
    if (cleanup.failed) console.warn(`[agent-attachments] ${cleanup.failed} cleanup item(s) still pending`);
    const router = require('express').Router();
    for (const name of ['system', 'auth', 'users', 'orders', 'models', 'materials', 'stock', 'files', 'oss', 'agent']) {
      router.use('/' + name, require('../routes/' + name));
    }
    return { router, close: closeResources };
  } catch (failure) {
    try { await closeResources(); } catch (cleanupError) { failure.cleanupError = cleanupError; }
    throw failure;
  }
}
module.exports = { createLegacyRuntime };
