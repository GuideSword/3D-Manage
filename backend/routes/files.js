const express = require('express');
const router = express.Router();
const path = require('path');
const { getFile, getFileInfo, UPLOAD_DIR } = require('../config/storage');

// GET /api/files/* - 下载文件（匹配所有路径）
// Express 5.x 兼容：使用正则表达式匹配所有路径
router.get(/.*/, async (req, res) => {
  try {
    // 从请求路径中提取文件路径（移除 /api/files 前缀）
    const filePath = req.path.replace(/^\/api\/files\//, '').replace(/^\//, '') || req.originalUrl.replace(/^\/api\/files\//, '').replace(/^\//, '');
    
    // 安全检查：防止路径遍历攻击
    const resolvedPath = path.resolve(path.join(UPLOAD_DIR, filePath));
    const resolvedDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // 获取文件信息
    const fileInfo = await getFileInfo(filePath);
    const fileBuffer = await getFile(filePath);
    
    const ext = path.extname(filePath).toLowerCase();
    
    // 设置Content-Type
    const mimeTypes = {
      '.stl': 'application/sla',
      '.obj': 'model/obj',
      '.3mf': 'model/3mf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.pdf': 'application/pdf',
      '.csv': 'text/csv',
    };
    
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', fileInfo.size);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    
    // 支持Range请求（断点续传）
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileInfo.size - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.slice(start, end + 1);
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.send(chunk);
    } else {
      res.send(fileBuffer);
    }
  } catch (error) {
    console.error('文件下载失败:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: '文件不存在' });
    } else {
      res.status(500).json({ error: '文件下载失败' });
    }
  }
});

module.exports = router;

