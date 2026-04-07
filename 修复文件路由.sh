#!/bin/bash

echo "=========================================="
echo "修复后端文件路由"
echo "=========================================="

SERVER_IP="101.37.28.116"
SERVER_USER="root"
BACKEND_DIR="/opt/3d-manage-backend"

echo "1. 打包修复文件..."
cd /home/huangjianpei/3D-Manage
tar -czf /tmp/files-fix.tar.gz backend/routes/files.js

echo "2. 上传到服务器（需要输入密码）..."
scp /tmp/files-fix.tar.gz "$SERVER_USER@$SERVER_IP:/tmp/"

if [ $? -ne 0 ]; then
  echo "❌ 上传失败"
  exit 1
fi

echo "3. 在服务器上应用修复（需要输入密码）..."
ssh "$SERVER_USER@$SERVER_IP" bash << 'EOF'
set -e
BACKEND_DIR="/opt/3d-manage-backend"

echo "解压文件..."
cd /tmp
tar -xzf files-fix.tar.gz

echo "备份原文件..."
cp "$BACKEND_DIR/routes/files.js" "$BACKEND_DIR/routes/files.js.backup-$(date +%Y%m%d-%H%M%S)" || true

echo "更新文件..."
cp backend/routes/files.js "$BACKEND_DIR/routes/files.js"

echo "重启PM2服务..."
cd "$BACKEND_DIR"
pm2 restart 3d-manage-api

echo "等待服务启动..."
sleep 3

echo "检查服务状态..."
pm2 status

echo "查看日志（最后10行）..."
pm2 logs 3d-manage-api --lines 10 --nostream || echo "无法获取日志"

echo "测试本地API..."
curl -s http://localhost:3001/health && echo "" || echo "❌ 本地API测试失败"
EOF

echo ""
echo "从本地测试远程API..."
sleep 2
curl -s http://$SERVER_IP:3001/health && echo "✅ 远程API可用" || echo "❌ 远程API不可用"

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="

