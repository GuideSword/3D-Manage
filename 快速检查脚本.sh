#!/bin/bash

# 快速检查服务器状态的脚本
# 在服务器上执行：bash <(curl -s https://raw.githubusercontent.com/.../check.sh) 
# 或直接复制到服务器执行

echo "========================================="
echo "3D-Manage 服务状态检查"
echo "========================================="
echo ""

# 检查1: PM2服务状态
echo "1. 检查PM2服务状态..."
if command -v pm2 &> /dev/null; then
    pm2 status
else
    echo "   ❌ PM2未安装"
fi
echo ""

# 检查2: 端口监听
echo "2. 检查3001端口..."
if netstat -tulpn | grep -q ":3001"; then
    echo "   ✅ 3001端口正在监听"
    netstat -tulpn | grep ":3001"
else
    echo "   ❌ 3001端口未监听"
fi
echo ""

# 检查3: 服务日志
echo "3. 最近的服务日志（最后20行）..."
if pm2 list | grep -q "3d-manage-api"; then
    echo "   --- PM2日志 ---"
    pm2 logs 3d-manage-api --lines 20 --nostream
else
    echo "   ❌ 服务未运行"
fi
echo ""

# 检查4: 目录和文件
echo "4. 检查部署目录..."
cd /opt/3d-manage-backend 2>/dev/null || {
    echo "   ❌ 部署目录不存在"
    exit 1
}

if [ -f "package.json" ]; then
    echo "   ✅ package.json存在"
else
    echo "   ❌ package.json不存在"
fi

if [ -f "server.js" ]; then
    echo "   ✅ server.js存在"
else
    echo "   ❌ server.js不存在"
fi

if [ -f ".env" ]; then
    echo "   ✅ .env文件存在"
else
    echo "   ❌ .env文件不存在"
fi

if [ -d "node_modules" ]; then
    echo "   ✅ node_modules存在"
else
    echo "   ❌ node_modules不存在（需要运行 npm install）"
fi
echo ""

# 检查5: 测试API
echo "5. 测试本地API..."
if curl -s --connect-timeout 3 http://localhost:3001/health > /dev/null; then
    echo "   ✅ API服务正常"
    curl -s http://localhost:3001/health
else
    echo "   ❌ API服务无法连接"
fi
echo ""

# 检查6: Node.js版本
echo "6. 检查Node.js和npm版本..."
if command -v node &> /dev/null; then
    echo "   Node.js: $(node -v)"
    echo "   npm: $(npm -v)"
else
    echo "   ❌ Node.js未安装"
fi
echo ""

echo "========================================="
echo "检查完成"
echo "========================================="


