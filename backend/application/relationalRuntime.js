'use strict';

async function createRelationalRuntime({ pool, jwtSecret, uploadDirectory, files = {} } = {}) {
  const express = require('express');
  const path = require('node:path');
  const { createRelationalFilesRouter } = require('../modules/adapters/files');
  const root = path.resolve(uploadDirectory || path.join(__dirname, '../uploads'));
  const { createRelationalRouter } = require('../modules/adapters/http');

  const router = express.Router();
  const { createModelDownloadService } = require('../modules/modelDownloads/service');
  const { createPostgresDownloadRepository } = require('../modules/modelDownloads/postgresRepository');
  const { createModelDownloadsRouter } = require('../modules/modelDownloads/http');
  const { createUserAuthentication } = require('../modules/users/authentication');
  const downloads = createModelDownloadService(createPostgresDownloadRepository(pool));
  const authentication = createUserAuthentication(pool, { jwtSecret });
  router.use('/model-downloads', createModelDownloadsRouter({ service: downloads, authenticate: authentication.authenticate,
    uploadDirectory: root, allowInsecureTest: files.allowInsecureTest === true }));
  // These surfaces are explicit release blockers until their relational adapters land.
  // Never mount their existing legacy-authenticated routers as a fallback.
  const pending = (_req, res) => res.status(503).json({ code: 'FEATURE_MAINTENANCE', error: '这项功能正在维护，请稍后再试' });
  router.use(['/agent', '/oss'], pending);
  router.use(await createRelationalFilesRouter(pool, { ...files, jwtSecret, uploadDirectory: root, downloads }));
  router.use(createRelationalRouter(pool, { jwtSecret, uploadDirectory: root }));
  return { router };
}
module.exports = { createRelationalRuntime };
