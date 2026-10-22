'use strict';
const express = require('express');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { createLocalFileStorage, parseByteRange } = require('../files/localStorage');
const { FILE_MIME_TYPES } = require('../files/service');
const { assertDownloadTransport } = require('./transport');

function createModelDownloadsRouter({ service, authenticate, uploadDirectory, allowInsecureTest = false }) {
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const bearer = req => /^Bearer (\S+)$/.exec(req.get('Authorization') || '')?.[1] || '';
  const identity = async req => authenticate(bearer(req));
  function secure(req) {
    // Forwarded headers alone are untrusted; terminate TLS here or explicitly configure a trusted proxy.
    assertDownloadTransport(req, allowInsecureTest);
  }
  router.get('/policy', route(async (req, res) => res.json(await service.status(await identity(req)))));
  router.get('/requirements', route(async (req, res) => res.json(await service.status(await identity(req), req.query.key))));
  router.put('/policy', route(async (req, res) => { secure(req); res.json(await service.configure(await identity(req), req.body)); }));
  router.post('/authorize', route(async (req, res) => { secure(req); res.json(await service.authorize(await identity(req), req.body)); }));
  router.post('/handoff/redeem', route(async (req, res) => {
    secure(req);
    if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.ticket !== 'string') throw Object.assign(new Error('交接参数无效'), { status: 400, code: 'DOWNLOAD_INPUT_INVALID' });
    res.json(await service.redeem(req.body.ticket));
  }));
  router.all('/handoff/file', route(async (req, res) => {
    secure(req);
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).set('Allow', 'GET, HEAD').json({ code: 'METHOD_NOT_ALLOWED', error: '文件仅支持读取' });
    const { key } = await service.transfer(bearer(req)), storage = await createLocalFileStorage({ uploadDirectory });
    const file = await storage.open(key);
    try {
      const range = parseByteRange(req.get('Range'), file.size);
      res.set('Content-Type', FILE_MIME_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream')
        .set('Content-Length', String(range.length)).set('Accept-Ranges', 'bytes')
        .set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(key)).replaceAll("'", '%27')}`);
      if (range.partial) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
      if (req.method === 'HEAD' || !range.length) return res.end();
      await pipeline(file.createReadStream(req.get('Range')), res);
    } finally { await file.close(); }
  }));
  router.use((error, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    const publicError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
    res.status(publicError ? error.status : 503).json({ code: publicError ? error.code : 'DOWNLOAD_SERVICE_UNAVAILABLE', error: publicError ? error.message : '下载授权服务暂不可用' });
  });
  return router;
}
module.exports = { createModelDownloadsRouter };
