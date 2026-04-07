#!/bin/bash

echo "=========================================="
echo "重启后端服务"
echo "=========================================="

SERVER_IP="101.37.28.116"
SERVER_USER="root"
BACKEND_DIR="/opt/3d-manage-backend"

echo "连接到服务器并重启服务（需要输入密码）..."
ssh "$SERVER_USER@$SERVER_IP" << EOF
cd $BACKEND_DIR

echo "1. 停止现有服务..."
pm2 stop 3d-manage-api || pm2 delete 3d-manage-api || true

echo "2. 启动服务..."
pm2 start server.js --name 3d-manage-api

echo "3. 保存PM2配置..."
pm2 save

echo "4. 等待服务启动..."
sleep 3

echo "5. 检查服务状态..."
pm2 status

echo "6. 检查端口..."
netstat -tlnp | grep 3001 || ss -tlnp | grep 3001 || echo "端口未监听，等待中..."
sleep 2
netstat -tlnp | grep 3001 || ss -tlnp | grep 3001 || echo "⚠️  端口仍未监听"

echo "7. 测试本地API..."
curl -s http://localhost:3001/health && echo "" || echo "❌ 本地API测试失败"

echo "8. 查看日志（最后5行）："
pm2 logs 3d-manage-api --lines 5 --nostream || echo "无法获取日志"

echo ""
echo "✅ 重启完成！"
EOF

echo ""
echo "从本地测试远程API..."
sleep 2
curl -s http://$SERVER_IP:3001/health && echo "✅ 远程API可用" || echo "❌ 远程API不可用，请检查防火墙设置"

echo ""
echo "=========================================="
echo "完成！"
echo "=========================================="

