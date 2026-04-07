#!/bin/bash

# 服务器端部署脚本
# 此脚本需要在服务器上执行

set -e

DEPLOY_PATH="/opt/3d-manage-backend"
PACKAGE_FILE="/tmp/backend-deploy.tar.gz"

echo "========================================="
echo "3D打印管理系统 - 服务器端部署"
echo "========================================="
echo ""

# 检查是否有上传的包文件
if [ ! -f "$PACKAGE_FILE" ]; then
    echo "⚠️  警告: 找不到上传的文件 $PACKAGE_FILE"
    echo "请先从本地电脑上传文件:"
    echo "scp backend-deploy.tar.gz root@101.37.28.116:/tmp/"
    exit 1
fi

echo "✅ 找到上传文件"
echo ""

# 创建部署目录
echo "步骤 1/7: 创建部署目录..."
mkdir -p $DEPLOY_PATH
cd $DEPLOY_PATH

# 解压代码
echo "步骤 2/7: 解压代码..."
tar -xzf "$PACKAGE_FILE"
rm "$PACKAGE_FILE"

# 检查解压后的目录结构（可能包含backend/前缀）
if [ -d "backend" ]; then
    echo "检测到backend子目录，移动文件..."
    mv backend/* .
    mv backend/.* . 2>/dev/null || true
    rmdir backend
fi

# 安装Node.js
echo "步骤 3/7: 检查并安装Node.js..."
if ! command -v node &> /dev/null; then
    echo "安装Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "Node.js已安装: $(node -v)"
fi

echo "Node.js版本: $(node -v)"
echo "npm版本: $(npm -v)"

# 安装PM2
echo "步骤 4/7: 安装PM2..."
npm install -g pm2 || echo "PM2可能已安装"

# 创建.env文件
echo "步骤 5/7: 配置环境变量..."
if [ ! -f .env ]; then
    JWT_SECRET=$(openssl rand -base64 32)
    cat > .env << EOF
PORT=3001
FRONTEND_URL=*
JWT_SECRET=$JWT_SECRET
UPLOAD_DIR=./uploads
API_BASE_URL=http://101.37.28.116:3001
EOF
    echo "✅ .env文件已创建"
else
    echo "⚠️  .env文件已存在，跳过创建"
fi

# 创建上传目录
echo "创建上传目录..."
mkdir -p uploads/models uploads/orders/attachments uploads/stock uploads/previews
chmod -R 755 uploads

# 安装依赖
echo "步骤 6/7: 安装依赖..."
npm install --production

# 启动服务
echo "步骤 7/7: 启动服务..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true
pm2 start server.js --name "3d-manage-api"
pm2 save

# 配置开机自启
echo "配置开机自启..."
pm2 startup | tail -1 | bash || echo "⚠️  开机自启配置可能需要手动执行"

# 配置防火墙
echo "配置防火墙..."
if command -v ufw &> /dev/null; then
    ufw allow 3001/tcp 2>/dev/null || true
    ufw reload 2>/dev/null || true
    echo "✅ UFW防火墙已配置"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    echo "✅ firewalld防火墙已配置"
else
    echo "⚠️  未检测到防火墙工具，请手动开放3001端口"
fi

echo ""
echo "========================================="
echo "✅ 部署完成！"
echo "========================================="
echo ""

# 显示服务状态
echo "服务状态:"
pm2 status

echo ""
echo "测试API..."
sleep 3
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ API服务运行正常"
    curl -s http://localhost:3001/health
else
    echo "⚠️  API服务可能正在启动中，请稍候..."
    echo "查看日志: pm2 logs 3d-manage-api"
fi

echo ""
echo "========================================="
echo "部署信息"
echo "========================================="
echo "📱 API地址: http://101.37.28.116:3001"
echo "🔍 健康检查: http://101.37.28.116:3001/health"
echo ""
echo "常用命令:"
echo "  - 查看状态: pm2 status"
echo "  - 查看日志: pm2 logs 3d-manage-api"
echo "  - 重启服务: pm2 restart 3d-manage-api"
echo "  - 停止服务: pm2 stop 3d-manage-api"
echo ""

