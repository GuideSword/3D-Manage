const express = require('express');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { UPLOAD_DIR } = require('../config/storage');
const { requireRoles } = require('../middleware/auth');
const { createLocalFileStorage, parseByteRange } = require('../modules/files/localStorage');
const { FILE_MIME_TYPES } = require('../modules/files/service');
const router = express.Router();
const protectedFileAccess = requireRoles('owner', 'staff', 'viewer');
let pendingStorage;
const sendStoredFile = async (req, res) => {
  let file;
  try {
    const filePath = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (/^agent(?:[\\/]|$)/i.test(filePath)) return res.status(404).json({ error: '文件不存在' });
    await require('../modules/modelDownloads/legacy').checkRequest(req, filePath);
    const storage = await (pendingStorage ||= createLocalFileStorage({ uploadDirectory: path.resolve(UPLOAD_DIR) }));
    file = await storage.open(filePath);
    let range;
    try { range = parseByteRange(req.get('Range'), file.size); }
    catch (error) { if (error.status === 416) res.set('Content-Range', `bytes */${file.size}`); throw error; }
    res.set('Cache-Control', 'private, no-store').set('Accept-Ranges', 'bytes')
      .set('Content-Type', FILE_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
      .set('Content-Length', String(range.length))
      .set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath)).replaceAll("'", '%27')}`);
    if (range.partial) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    if (req.method === 'HEAD' || !range.length) return res.end();
    await pipeline(file.createReadStream(req.get('Range')), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    const publicError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
    const status = error instanceof URIError ? 403 : publicError ? error.status : 500;
    return res.status(status).set('Cache-Control', 'private, no-store').json({ code: error instanceof URIError ? 'FILE_KEY_INVALID' : publicError ? error.code : 'FILE_SERVICE_UNAVAILABLE', error: publicError ? error.message : '文件下载暂不可用' });
  } finally { if (file) await file.close(); }
};
router.get(/.*/, (req, res, next) => protectedFileAccess(req, res, error => error ? next(error) : sendStoredFile(req, res)));
module.exports = router;
