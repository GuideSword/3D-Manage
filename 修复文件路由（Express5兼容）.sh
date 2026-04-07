#!/bin/bash

# Express 5.x 兼容的文件路由修复

echo "修复文件路由（Express 5.x 兼容版本）..."

ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

echo "1. 停止服务..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true

echo "2. 备份文件..."
cp routes/files.js routes/files.js.bak.$(date +%Y%m%d_%H%M%S)
cp server.js server.js.bak.$(date +%Y%m%d_%H%M%S)

echo "3. 创建Express 5.x兼容的文件路由..."
# 使用更安全的路由方式：不使用通配符，而是使用路径参数
cat > routes/files.js << 'ENDFILE'
const express = require('express');
const router = express.Router();
const path = require('path');
const { getFile, getFileInfo, UPLOAD_DIR } = require('../config/storage');

// Express 5.x 兼容的文件路由
// 使用多个路由来处理不同情况

// GET /api/files - 列表（可选）
router.get('/', async (req, res) => {
  res.json({ message: '文件服务', usage: 'GET /api/files/:path' });
});

// GET /api/files/:path - 下载文件（单层路径）
router.get('/:path', async (req, res) => {
  try {
    let filePath = req.params.path;
    
    // 如果有查询参数 path，使用它（支持多层路径）
    if (req.query.fullPath) {
      filePath = req.query.fullPath;
    }
    
    // 解码路径
    filePath = decodeURIComponent(filePath);
    
    // 移除开头的斜杠
    filePath = filePath.replace(/^\//, '');
    
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
      res.status(500).json({ error: '文件下载失败: ' + error.message });
    }
  }
});

module.exports = router;
ENDFILE

echo "4. 更新 storage.js 的 getFileUrl 函数..."
# 修改 getFileUrl 以使用查询参数
cat >> /tmp/update_storage.sh << 'UPDATEEND'
# 这个脚本会更新 getFileUrl 函数
# 暂时先不改，使用当前版本
UPDATEEND

echo "5. 检查语法..."
if node -c routes/files.js 2>/dev/null; then
    echo "✅ files.js 语法正确"
else
    echo "❌ files.js 语法错误:"
    node -c routes/files.js
    exit 1
fi

if node -c server.js 2>/dev/null; then
    echo "✅ server.js 语法正确"
else
    echo "❌ server.js 语法错误:"
    node -c server.js
    exit 1
fi

echo "6. 恢复文件路由（如果被禁用）..."
# 取消注释文件路由
sed -i "s|// app.use('/api/files', require('./routes/files'));|app.use('/api/files', require('./routes/files'));|g" server.js
sed -i "s|// 临时禁用||g" server.js

echo "7. 启动服务..."
pm2 start server.js --name "3d-manage-api"
sleep 3

echo "8. 查看状态..."
pm2 status

echo "9. 查看日志（最后30行）..."
pm2 logs 3d-manage-api --lines 30 --nostream | tail -35

echo "10. 测试API..."
sleep 2
echo "测试健康检查:"
curl -s http://localhost:3001/health || echo "健康检查失败"
echo ""

echo "测试文件路由:"
curl -s "http://localhost:3001/api/files" || echo "文件路由失败"
echo ""

echo "========================================="
echo "修复完成"
echo "========================================="
echo ""
echo "注意：文件路径需要使用查询参数传递"
echo "例如: /api/files/model.stl?fullPath=models/123/model.stl"

ENDSSH


