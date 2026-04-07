#!/bin/bash

# 部署步骤脚本 - 自动执行服务器部署

SERVER_IP="101.37.28.116"
SERVER_USER="root"
DEPLOY_PATH="/opt/3d-manage-backend"
LOCAL_PACKAGE="backend-deploy.tar.gz"

echo "========================================="
echo "3D打印管理系统 - 服务器部署"
echo "服务器: $SERVER_IP"
echo "========================================="
echo ""

# 检查打包文件是否存在
if [ ! -f "$LOCAL_PACKAGE" ]; then
    echo "❌ 错误: 找不到打包文件 $LOCAL_PACKAGE"
    echo "请先运行打包命令:"
    echo "cd /home/huangjianpei/3D-Manage && tar -czf backend-deploy.tar.gz --exclude='node_modules' --exclude='.git' backend/"
    exit 1
fi

echo "✅ 找到打包文件: $LOCAL_PACKAGE"
echo ""

# 步骤1: 上传文件到服务器
echo "步骤 1/5: 上传代码到服务器..."
echo "请输入服务器密码: huangjianpei123@"
scp -o StrictHostKeyChecking=no "$LOCAL_PACKAGE" "$SERVER_USER@$SERVER_IP:/tmp/"

if [ $? -ne 0 ]; then
    echo "❌ 上传失败，请检查网络连接和服务器信息"
    exit 1
fi

echo "✅ 上传完成"
echo ""

# 步骤2-5: 在服务器上执行部署命令
echo "步骤 2/5: 在服务器上配置环境..."
echo "请输入服务器密码: huangjianpei123@"
ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" << 'ENDSSH'
set -e

DEPLOY_PATH="/opt/3d-manage-backend"
PACKAGE_FILE="/tmp/backend-deploy.tar.gz"

echo "创建部署目录..."
mkdir -p $DEPLOY_PATH
cd $DEPLOY_PATH

echo "解压代码..."
if [ -f "$PACKAGE_FILE" ]; then
    tar -xzf "$PACKAGE_FILE"
    rm "$PACKAGE_FILE"
else
    echo "错误: 找不到上传的文件"
    exit 1
fi

echo "检查并安装Node.js..."
if ! command -v node &> /dev/null; then
    echo "安装Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "Node.js版本: $(node -v)"
echo "npm版本: $(npm -v)"

echo "安装PM2..."
npm install -g pm2 || echo "PM2可能已安装"

echo "创建.env文件..."
if [ ! -f .env ]; then
    cat > .env << EOF
PORT=3001
FRONTEND_URL=*
JWT_SECRET=$(openssl rand -base64 32)
UPLOAD_DIR=./uploads
API_BASE_URL=http://101.37.28.116:3001
EOF
    echo "✅ .env文件已创建"
fi

echo "创建上传目录..."
mkdir -p uploads/models uploads/orders/attachments uploads/stock uploads/previews
chmod -R 755 uploads

echo "步骤 3/5: 安装依赖..."
npm install --production

echo "步骤 4/5: 启动服务..."
# 停止旧服务（如果存在）
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true

# 启动新服务
pm2 start server.js --name "3d-manage-api"
pm2 save

echo "步骤 5/5: 配置防火墙..."
# Ubuntu/Debian
if command -v ufw &> /dev/null; then
    ufw allow 3001/tcp 2>/dev/null || true
    ufw reload 2>/dev/null || true
fi

# CentOS/RHEL
if command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
fi

echo ""
echo "========================================="
echo "✅ 部署完成！"
echo "========================================="
echo "服务状态:"
pm2 status
echo ""
echo "📱 API地址: http://101.37.28.116:3001"
echo "🔍 查看日志: pm2 logs 3d-manage-api"
echo "🔄 重启服务: pm2 restart 3d-manage-api"
echo ""

# 测试服务
echo "测试API..."
sleep 2
curl -s http://localhost:3001/health || echo "⚠️  服务可能正在启动中，请稍候..."

ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "✅ 部署成功！"
    echo "========================================="
    echo ""
    echo "📱 后端API地址: http://101.37.28.116:3001"
    echo "🔍 查看服务状态: ssh $SERVER_USER@$SERVER_IP 'pm2 status'"
    echo "📋 查看日志: ssh $SERVER_USER@$SERVER_IP 'pm2 logs 3d-manage-api'"
    echo ""
    echo "下一步: 更新前端API配置"
    echo "编辑 constants/index.js，将 BASE_URL 改为:"
    echo "'http://101.37.28.116:3001/api'"
else
    echo "❌ 部署失败，请检查错误信息"
    exit 1
fi


