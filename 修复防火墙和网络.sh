#!/bin/bash

# 修复防火墙和网络配置

echo "========================================="
echo "修复防火墙和网络"
echo "========================================="
echo ""

ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

echo "1. 检查服务状态..."
pm2 status
echo ""

echo "2. 确保服务在运行..."
pm2 restart 3d-manage-api 2>/dev/null || pm2 start server.js --name "3d-manage-api"
sleep 3
pm2 status
echo ""

echo "3. 检查端口监听..."
netstat -tulpn | grep 3001
echo ""

echo "4. 配置防火墙（UFW）..."
if command -v ufw &> /dev/null; then
    echo "配置UFW..."
    ufw allow 3001/tcp
    ufw reload
    ufw status | grep 3001 || echo "UFW规则可能未生效"
else
    echo "未安装UFW"
fi
echo ""

echo "5. 配置防火墙（firewalld）..."
if command -v firewall-cmd &> /dev/null; then
    echo "配置firewalld..."
    firewall-cmd --permanent --add-port=3001/tcp
    firewall-cmd --reload
    firewall-cmd --list-ports | grep 3001 || echo "firewalld规则可能未生效"
else
    echo "未安装firewalld"
fi
echo ""

echo "6. 检查阿里云安全组..."
echo "⚠️  请手动检查阿里云控制台："
echo "   - 进入ECS实例"
echo "   - 点击 网络和安全 -> 安全组"
echo "   - 添加规则：端口3001，协议TCP，授权对象0.0.0.0/0"
echo ""

echo "7. 从服务器内部测试..."
echo "测试 localhost:"
curl -s --connect-timeout 3 http://localhost:3001/health && echo "✅ 内部连接正常" || echo "❌ 内部连接失败"
echo ""

echo "8. 测试监听地址..."
echo "检查服务器监听地址:"
ss -tulpn | grep 3001 || netstat -tulpn | grep 3001
echo ""

echo "9. 检查进程监听地址..."
if [ -f "/proc/$(pgrep -f 'node.*server.js')/fd" ]; then
    echo "进程已启动"
else
    echo "进程未启动，重新启动..."
    pm2 restart 3d-manage-api
fi

ENDSSH

echo ""
echo "========================================="
echo "重要提醒"
echo "========================================="
echo ""
echo "如果服务器内部可以访问但外部无法访问，可能是："
echo "1. 阿里云安全组未开放3001端口"
echo "2. 服务器防火墙阻止了外部访问"
echo ""
echo "请检查阿里云控制台的安全组设置！"
echo ""


