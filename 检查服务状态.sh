#!/bin/bash

# 检查服务状态和网络连接

echo "========================================="
echo "检查服务状态"
echo "========================================="
echo ""

ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

echo "1. PM2服务状态:"
echo "----------------------------------------"
pm2 status
echo ""

echo "2. 检查进程是否在运行:"
echo "----------------------------------------"
ps aux | grep node | grep -v grep || echo "没有node进程"
echo ""

echo "3. 检查端口3001是否在监听:"
echo "----------------------------------------"
netstat -tulpn | grep 3001 || echo "端口3001未监听"
lsof -i :3001 || echo "没有进程监听3001端口"
echo ""

echo "4. 从服务器内部测试健康检查:"
echo "----------------------------------------"
curl -v http://localhost:3001/health 2>&1 || echo "无法连接到localhost:3001"
echo ""

echo "5. 查看服务日志（最后30行）:"
echo "----------------------------------------"
pm2 logs 3d-manage-api --lines 30 --nostream | tail -35
echo ""

echo "6. 查看错误日志（最后20行）:"
echo "----------------------------------------"
pm2 logs 3d-manage-api --err --lines 20 --nostream | tail -25
echo ""

echo "7. 检查防火墙状态:"
echo "----------------------------------------"
ufw status || firewall-cmd --list-all || echo "未检测到防火墙工具"
echo ""

echo "8. 检查服务配置文件:"
echo "----------------------------------------"
echo "PORT in .env:"
grep PORT .env || echo "未找到PORT配置"
echo ""

echo "9. 手动测试启动（5秒超时）:"
echo "----------------------------------------"
timeout 5 node server.js 2>&1 || echo "启动失败或超时"
echo ""

ENDSSH

echo ""
echo "========================================="
echo "检查完成"
echo "========================================="


