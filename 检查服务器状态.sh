#!/bin/bash

echo "=========================================="
echo "检查后端服务器状态"
echo "=========================================="

SERVER_IP="101.37.28.116"
SERVER_USER="root"

echo "1. 检查服务器PM2服务状态（需要输入密码）..."
ssh "$SERVER_USER@$SERVER_IP" << 'EOF'
echo "PM2状态："
pm2 status

echo ""
echo "PM2日志（最后10行）："
pm2 logs 3d-manage-api --lines 10 --nostream 2>/dev/null || echo "无法获取日志"

echo ""
echo "检查端口3001是否监听："
netstat -tlnp | grep 3001 || ss -tlnp | grep 3001 || echo "端口3001未监听"

echo ""
echo "测试本地API："
curl -s http://localhost:3001/health || echo "本地API测试失败"
EOF

echo ""
echo "2. 从本地测试远程API..."
curl -v http://$SERVER_IP:3001/health 2>&1 | head -10

echo ""
echo "=========================================="
echo "检查完成！"
echo "=========================================="

