#!/bin/bash

# 一键修复路由错误的脚本
# 在服务器上执行：bash 一键修复脚本.sh

echo "开始修复路由错误..."

cd /opt/3d-manage-backend || {
    echo "错误: 找不到部署目录"
    exit 1
}

# 备份原文件
echo "备份原文件..."
cp routes/files.js routes/files.js.bak

# 检查文件是否存在
if [ ! -f "routes/files.js" ]; then
    echo "错误: 找不到 routes/files.js"
    exit 1
fi

# 方法1: 使用 sed 替换（如果支持）
if sed -i "s|router.get('/:filePath(\*)|router.get('/*|g" routes/files.js 2>/dev/null; then
    echo "✅ 已修复路由定义"
else
    echo "⚠️  sed替换失败，需要手动编辑"
fi

# 替换参数获取方式（更简单的方法）
# 创建临时文件
cat > /tmp/files_fix.js << 'ENDFIX'
const express = require('express');
const router = express.Router();
const path = require('path');
const { getFile, getFileInfo, UPLOAD_DIR } = require('../config/storage');

// GET /api/files/* - 下载文件（匹配所有路径）
router.get('/*', async (req, res) => {
  try {
    // Express 5.x 使用 req.params[0] 获取通配符匹配的路径
    const filePath = req.params[0] || req.path.replace(/^\/api\/files\//, '');
    
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
ENDFIX

# 替换文件
echo "替换文件..."
cp /tmp/files_fix.js routes/files.js
rm /tmp/files_fix.js

# 验证修改
echo "验证修改..."
if grep -q "router.get('/\*'" routes/files.js; then
    echo "✅ 路由已修复为 /*"
else
    echo "❌ 路由修复失败"
    exit 1
fi

if grep -q "req.params[0]" routes/files.js; then
    echo "✅ 参数获取已修复"
else
    echo "❌ 参数获取修复失败"
    exit 1
fi

# 重启服务
echo "重启服务..."
pm2 restart 3d-manage-api

# 等待启动
sleep 3

# 查看状态
echo ""
echo "服务状态:"
pm2 status

# 测试API
echo ""
echo "测试API..."
if curl -s --connect-timeout 3 http://localhost:3001/health > /dev/null; then
    echo "✅ API服务正常"
    curl -s http://localhost:3001/health
else
    echo "⚠️  API服务可能还在启动中"
    echo "查看日志: pm2 logs 3d-manage-api --lines 30"
fi

echo ""
echo "✅ 修复完成！"


