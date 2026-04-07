#!/bin/bash

# 完整修复方案 - 在服务器上执行

echo "========================================="
echo "完整修复服务错误"
echo "========================================="
echo ""

# 连接到服务器并执行修复
ssh root@101.37.28.116 << 'ENDSSH'
set -e

cd /opt/3d-manage-backend

echo "1. 停止服务..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true

echo "2. 检查当前文件..."
echo "--- 当前 routes/files.js 内容（前15行） ---"
head -15 routes/files.js || echo "文件不存在"
echo ""

echo "3. 备份原文件..."
cp routes/files.js routes/files.js.bak.$(date +%Y%m%d_%H%M%S)

echo "4. 创建修复后的文件..."
cat > routes/files.js << 'ENDFILE'
const express = require('express');
const router = express.Router();
const path = require('path');
const { getFile, getFileInfo, UPLOAD_DIR } = require('../config/storage');

// GET /api/files/* - 下载文件（匹配所有路径）
router.get('/*', async (req, res) => {
  try {
    // Express 5.x 使用 req.params[0] 获取通配符匹配的路径
    const filePath = req.params[0] || req.path.replace(/^\/api\/files\//, '');
    
    // 移除开头的斜杠（如果存在）
    const cleanPath = filePath.replace(/^\//, '');
    
    // 安全检查：防止路径遍历攻击
    const resolvedPath = path.resolve(path.join(UPLOAD_DIR, cleanPath));
    const resolvedDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // 获取文件信息
    const fileInfo = await getFileInfo(cleanPath);
    const fileBuffer = await getFile(cleanPath);
    
    const ext = path.extname(cleanPath).toLowerCase();
    
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
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(cleanPath)}"`);
    
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

echo "5. 验证文件内容..."
if grep -q "router.get('/\*'" routes/files.js; then
    echo "✅ 路由已修复"
else
    echo "❌ 路由修复失败"
    exit 1
fi

echo "6. 检查语法..."
if node -c routes/files.js 2>/dev/null; then
    echo "✅ 语法正确"
else
    echo "❌ 语法错误:"
    node -c routes/files.js
    exit 1
fi

echo "7. 检查其他关键文件..."
if [ ! -f "server.js" ]; then
    echo "❌ server.js 不存在"
    exit 1
fi

if [ ! -f "config/storage.js" ]; then
    echo "❌ config/storage.js 不存在"
    exit 1
fi

echo "8. 检查 server.js 语法..."
if node -c server.js 2>/dev/null; then
    echo "✅ server.js 语法正确"
else
    echo "❌ server.js 语法错误:"
    node -c server.js
    exit 1
fi

echo "9. 手动测试启动（5秒）..."
timeout 5 node server.js 2>&1 || true
echo ""

echo "10. 使用PM2启动服务..."
pm2 start server.js --name "3d-manage-api"
sleep 3

echo "11. 查看服务状态..."
pm2 status

echo "12. 查看日志（最后20行）..."
pm2 logs 3d-manage-api --lines 20 --nostream | tail -25

echo "13. 测试API..."
sleep 2
if curl -s --connect-timeout 5 http://localhost:3001/health > /dev/null; then
    echo "✅ API服务正常"
    curl -s http://localhost:3001/health
else
    echo "❌ API服务无法连接"
    echo "查看错误日志:"
    pm2 logs 3d-manage-api --err --lines 10 --nostream
fi

echo ""
echo "========================================="
echo "修复完成"
echo "========================================="

ENDSSH


