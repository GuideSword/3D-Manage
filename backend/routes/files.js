const express = require('express');
const path = require('path');
const router = express.Router();
const { getFile, getFileInfo, UPLOAD_DIR } = require('../config/storage');
const { requireRoles } = require('../middleware/auth');

const PUBLIC_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const protectedFileAccess = requireRoles('owner', 'staff', 'viewer');

const sendStoredFile = async (req, res) => {
  try {
    const filePath = req.path.replace(/^\/+/, '');
    const resolvedPath = path.resolve(path.join(UPLOAD_DIR, filePath));
    const resolvedDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fileInfo = await getFileInfo(filePath);
    const fileBuffer = await getFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.stl': 'application/sla',
      '.obj': 'model/obj',
      '.3mf': 'model/3mf',
      '.step': 'model/step',
      '.stp': 'model/step',
      '.zip': 'application/zip',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.csv': 'text/csv',
    };

    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', fileInfo.size);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileInfo.size - 1;
      const chunk = fileBuffer.slice(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunk.length);
      return res.send(chunk);
    }

    return res.send(fileBuffer);
  } catch (error) {
    console.error('File download failed:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.status(500).json({ error: 'File download failed' });
  }
};

router.get(/.*/, async (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (PUBLIC_IMAGE_EXTENSIONS.has(ext)) {
    return sendStoredFile(req, res);
  }
  return protectedFileAccess(req, res, (error) => {
    if (error) {
      return next(error);
    }
    return sendStoredFile(req, res);
  });
});

module.exports = router;
