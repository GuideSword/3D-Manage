'use strict';

async function createRelationalRuntime({ pool, jwtSecret, uploadDirectory } = {}) {
  const express = require('express');
  const { initStorage, UPLOAD_DIR } = require('../config/storage');
  const { createRelationalRouter } = require('../modules/adapters/http');
  await initStorage();
  const router = express.Router();
  // These surfaces are explicit release blockers until their relational adapters land.
  // Never mount their existing legacy-authenticated routers as a fallback.
  const pending = (_req, res) => res.status(503).json({ code: 'FEATURE_MAINTENANCE', error: '这项功能正在维护，请稍后再试' });
  router.use(['/agent', '/files', '/oss'], pending);
  router.patch('/system/organization', pending);
  router.get('/orders/stats', pending);
  router.use(createRelationalRouter(pool, { jwtSecret, uploadDirectory: uploadDirectory || UPLOAD_DIR }));
  return { router };
}
module.exports = { createRelationalRuntime };
