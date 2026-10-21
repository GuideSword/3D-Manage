'use strict';
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createFileService, FILE_MIME_TYPES } = require('../files/service');
const { parseByteRange } = require('../files/localStorage');
const { createUserAuthentication } = require('../users/authentication');
const { limitUploadConcurrency } = require('../../middleware/uploadConcurrency');
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
function originalFilename(value) {
  if (typeof value !== 'string') return value;
  if (/^[\x00-\xff]*$/.test(value) && /[\x80-\xff]/.test(value)) {
    const bytes = Buffer.from(value, 'latin1'), decoded = bytes.toString('utf8');
    if (!decoded.includes('\ufffd') && Buffer.from(decoded, 'utf8').equals(bytes)) return decoded;
  }
  return value;
}
async function createRelationalFilesRouter(pool, options) {
  options = { ...options, downloads: options?.downloads || require('../modelDownloads/service').createModelDownloadService(require('../modelDownloads/postgresRepository').createPostgresDownloadRepository(pool)) };
  const service = await createFileService(pool, options), authentication = createUserAuthentication(pool, options), router = express.Router();
  const route = action => (req, res, next) => Promise.resolve().then(() => action(req, res)).catch(next);
  const identity = async (req, _res, next) => {
    try {
      const bearer = req.get('Authorization') || '';
      req.fileSession = bearer.startsWith('Bearer ') ? await authentication.authenticate(bearer.slice(7)) : null;
      if (!req.fileSession) fail('AUTHENTICATION_REQUIRED', '请重新登录', 401);
      next();
    } catch (error) { next(error); }
  };
  router.post('/uploads/:namespace', identity, async (req, res, next) => {
    try {
      if (req.get('X-Business-Rules-Version') !== '2') fail('CLIENT_UPGRADE_REQUIRED', '请升级客户端后再上传文件', 428);
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(req.get('Idempotency-Key') || '')) fail('COMMAND_KEY_INVALID', '缺少有效的操作标识');
      req.fileLimit = service.limit(req.params.namespace);
      await service.authorizeUpload(req.fileSession);
      next();
    } catch (error) { next(error); }
  }, limitUploadConcurrency, (req, res, next) => {
    const controller = new AbortController(), aborted = () => controller.abort();
    req.once('aborted', aborted);
    const storage = {
      _handleFile(request, file, callback) {
        service.storage.stage(file.stream, { namespace: request.params.namespace, originalName: originalFilename(file.originalname), maxBytes: request.fileLimit, signal: controller.signal })
          .then(staged => { request.fileStage = staged; callback(null, { staged }); }, callback);
      },
      _removeFile(_request, file, callback) {
        if (!file.staged) return callback(null);
        service.storage.discard(file.staged.token).then(() => { req.fileStage = null; callback(null); }, callback);
      },
    };
    const parse = multer({ storage, limits: { fileSize: req.fileLimit, files: 1, fields: 0 } }).single('file');
    parse(req, res, async error => {
      req.removeListener('aborted', aborted);
      if (error) { next(error); return; }
      let failure, result;
      try {
        if (!req.file?.staged || req.file.truncated) fail('FILE_UPLOAD_INVALID', '请选择一个有效文件');
        result = await service.complete(req.fileSession, req.file.staged.token, req.get('Idempotency-Key'));
      } catch (caught) { failure = caught; }
      finally {
        if (req.fileStage) {
          try { await service.storage.discard(req.fileStage.token); req.fileStage = null; }
          catch (cleanupError) { if (failure) failure.cleanupError = true; else failure = cleanupError; }
        }
      }
      if (failure) next(failure);
      else if (!res.destroyed) res.status(result.status).json(result.body);
    });
  });
  router.all('/files/*key', identity, route(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.set('Allow', 'GET, HEAD'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: '文件仅支持读取' }); }
    const key = req.params.key.join('/');
    if (options.downloads) {
      if ((await options.downloads.status(req.fileSession, key)).requiresPassword) require('../modelDownloads/transport').assertDownloadTransport(req, options.allowInsecureTest === true);
    }
    const file = await service.open(req.fileSession, key, req.get('X-Model-Download-Grant'));
    try {
      let range;
      try { range = parseByteRange(req.get('Range'), file.size); }
      catch (error) { if (error.status === 416) res.set('Content-Range', `bytes */${file.size}`); throw error; }
      res.set('Cache-Control', 'private, no-store').set('Accept-Ranges', 'bytes')
        .set('Content-Type', FILE_MIME_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream')
        .set('Content-Length', String(range.length))
        .set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(key)).replaceAll("'", '%27')}`);
      if (range.partial) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
      if (req.method === 'HEAD' || !range.length) return res.end();
      await pipeline(file.createReadStream(req.get('Range')), res);
    } finally { await file.close(); }
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    const limited = error.code === 'LIMIT_FILE_SIZE', multipart = error instanceof multer.MulterError;
    const maintenance = ['BUSINESS_MAINTENANCE', 'MAINTENANCE_STATE_INVALID'].includes(error.code);
    const publicError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && /^[A-Z_]+$/.test(error.code || '');
    const status = limited ? 413 : multipart ? 400 : maintenance ? 503 : publicError ? error.status : 500;
    res.status(status).json({ code: limited ? 'FILE_TOO_LARGE' : multipart ? 'FILE_UPLOAD_INVALID' : maintenance || publicError ? error.code : 'FILE_SERVICE_UNAVAILABLE',
      error: limited ? '上传文件超过大小限制' : multipart ? '上传请求格式无效' : maintenance || publicError ? error.message : '文件服务暂时不可用，请稍后重试' });
  });
  return router;
}
module.exports = { createRelationalFilesRouter };
