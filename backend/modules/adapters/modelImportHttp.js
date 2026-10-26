'use strict';

const express = require('express');
const multer = require('multer');
const { createRelationalModelImportService } = require('../modelImport/relationalService');

function createModelImportRouter({ pool, uploadDirectory, authentication, downloads }) {
  const router = express.Router();
  const service = createRelationalModelImportService(pool, { uploadDirectory });
  const auth = async (req, res, next) => {
    try {
      const token = String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      req.session = token ? await authentication.authenticate(token) : null;
      if (!req.session && token && downloads) req.session = await downloads.validateImportToken(token);
      if (!req.session) return res.status(401).json({ code: 'AUTHENTICATION_REQUIRED', error: '请重新登录' });
      return next();
    } catch (error) { return next(error); }
  };
  const write = (req, res, next) => {
    if (req.get('X-Business-Rules-Version') !== '2') return res.status(428).json({ code: 'CLIENT_UPGRADE_REQUIRED', error: '请升级客户端后再修改业务资料' });
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(req.get('Idempotency-Key') || '')) return res.status(400).json({ code: 'COMMAND_KEY_INVALID', error: '缺少有效的操作标识' });
    return next();
  };
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(1, Number.parseInt(process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10)) } });

  router.post('/handoff/authorize', auth, route(async (req, res) => res.json(await downloads.authorize(req.session, { key: 'model-import', purpose: 'model-import', consent: true }))));
  router.post('/handoff/redeem', route(async (req, res) => {
    if (!req.body || typeof req.body.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(req.body.ticket)) return res.status(400).json({ code: 'MODEL_IMPORT_TICKET_INVALID', error: '导入凭据无效' });
    const result = await downloads.redeemImport(req.body.ticket);
    const installation = (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0];
    return res.json({ ...result, serverId: installation?.server_id || null });
  }));

  router.use(auth);
  router.post('/jobs', write, route(async (req, res) => res.status(201).json(await service.createJob(req.session, req.body))));
  router.post('/jobs/:jobId/items', write, route(async (req, res) => res.status(201).json(await service.prepareItem(req.session, req.params.jobId, req.body))));
  router.post('/jobs/:jobId/items/prepare', write, route(async (req, res) => res.status(201).json(await service.prepareItem(req.session, req.params.jobId, req.body))));
  router.post('/jobs/:jobId/items/:itemId/file', write, upload.single('file'), route(async (req, res) => res.json(await service.completeFile(req.session, req.params.jobId, req.params.itemId, req.file?.buffer))));
  router.post('/jobs/:jobId/items/:itemId/describe', write, route(async (req, res) => res.json(await service.describe(req.session, req.params.jobId, req.params.itemId, req.body || {}))));
  router.get('/jobs/:jobId', route(async (req, res) => res.json(await service.getJob(req.session, req.params.jobId))));
  router.post('/jobs/:jobId/cleanup', write, route(async (req, res) => res.json(await service.cleanupJob(req.session, req.params.jobId))));
  router.delete('/jobs/:jobId', write, route(async (req, res) => res.json(await service.cleanupJob(req.session, req.params.jobId))));
  return router;
}

module.exports = { createModelImportRouter };
