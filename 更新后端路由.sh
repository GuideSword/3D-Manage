#!/bin/bash

echo "=========================================="
echo "更新后端路由到服务器"
echo "=========================================="

SERVER_IP="101.37.28.116"
SERVER_USER="root"
BACKEND_DIR="/opt/3d-manage-backend"

# 创建临时目录
TMP_DIR="/tmp/backend-update-$(date +%s)"
mkdir -p "$TMP_DIR/backend"

echo "1. 打包后端代码..."
cd /home/huangjianpei/3D-Manage
tar -czf "$TMP_DIR/backend-update.tar.gz" \
  backend/routes/materials.js \
  backend/routes/stock.js \
  backend/routes/orders.js \
  backend/server.js \
  backend/package.json \
  backend/.gitignore \
  backend/config/storage.js

echo "2. 上传到服务器（需要输入密码）..."
scp "$TMP_DIR/backend-update.tar.gz" "$SERVER_USER@$SERVER_IP:/tmp/"

if [ $? -ne 0 ]; then
  echo "❌ 上传失败，请检查网络连接和密码"
  exit 1
fi

echo "3. 在服务器上更新文件（需要输入密码）..."
ssh "$SERVER_USER@$SERVER_IP" bash << 'EOF'
set -e
BACKEND_DIR="/opt/3d-manage-backend"

echo "正在解压文件..."
cd /tmp
tar -xzf backend-update.tar.gz

echo "备份现有文件..."
BACKUP_DIR="$BACKEND_DIR/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r "$BACKEND_DIR/routes" "$BACKUP_DIR/" 2>/dev/null || true
cp "$BACKEND_DIR/server.js" "$BACKUP_DIR/" 2>/dev/null || true
echo "备份完成：$BACKUP_DIR"

echo "更新文件..."
cp -r backend/routes/* "$BACKEND_DIR/routes/"
if [ -f "backend/server.js" ]; then
  cp backend/server.js "$BACKEND_DIR/" || true
fi

echo "重启PM2服务..."
cd "$BACKEND_DIR"
pm2 restart 3d-manage-api || pm2 start server.js --name 3d-manage-api

echo "等待服务启动..."
sleep 3

echo "检查服务状态..."
pm2 status

echo "测试API..."
curl -s http://localhost:3001/api/materials/1 && echo "" || echo "API测试失败"

echo "✅ 更新完成！"
EOF

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
