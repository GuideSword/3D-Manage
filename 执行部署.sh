#!/bin/bash

# 部署到服务器 101.37.28.116

SERVER_IP="101.37.28.116"
SERVER_USER="root"
SERVER_PASSWORD="huangjianpei123@"
DEPLOY_PATH="/opt/3d-manage-backend"
PACKAGE_FILE="backend-deploy.tar.gz"

echo "========================================="
echo "开始部署到服务器: $SERVER_IP"
echo "========================================="
echo ""

# 检查打包文件
if [ ! -f "$PACKAGE_FILE" ]; then
    echo "❌ 错误: 找不到打包文件 $PACKAGE_FILE"
    exit 1
fi

echo "✅ 找到打包文件: $PACKAGE_FILE"
echo ""

# 上传文件（使用sshpass）
if command -v sshpass &> /dev/null; then
    echo "📤 上传代码到服务器..."
    sshpass -p "$SERVER_PASSWORD" scp -o StrictHostKeyChecking=no "$PACKAGE_FILE" "$SERVER_USER@$SERVER_IP:/tmp/"
else
    echo "⚠️  sshpass未安装，请手动上传文件:"
    echo "scp $PACKAGE_FILE $SERVER_USER@$SERVER_IP:/tmp/"
    echo "然后连接服务器执行部署命令"
    exit 1
fi

if [ $? -ne 0 ]; then
    echo "❌ 上传失败"
    exit 1
fi

echo "✅ 上传完成"
echo ""

# 在服务器上执行部署命令
echo "🔧 在服务器上配置环境..."
sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" bash << 'ENDSSH'
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
    echo "❌ 错误: 找不到上传的文件"
    exit 1
fi

echo "检查Node.js..."
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
    JWT_SECRET=$(openssl rand -base64 32)
    cat > .env << EOF
PORT=3001
FRONTEND_URL=*
JWT_SECRET=$JWT_SECRET
UPLOAD_DIR=./uploads
API_BASE_URL=http://101.37.28.116:3001
EOF
    echo "✅ .env文件已创建"
fi

echo "创建上传目录..."
mkdir -p uploads/models uploads/orders/attachments uploads/stock uploads/previews
chmod -R 755 uploads

echo "安装依赖..."
npm install --production

echo "启动服务..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true
pm2 start server.js --name "3d-manage-api"
pm2 save

echo "配置开机自启..."
pm2 startup | tail -1 | bash || true

echo "配置防火墙..."
ufw allow 3001/tcp 2>/dev/null || firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
ufw reload 2>/dev/null || firewall-cmd --reload 2>/dev/null || true

echo ""
echo "========================================="
echo "✅ 部署完成！"
echo "========================================="
echo "服务状态:"
pm2 status

echo ""
echo "测试API..."
sleep 3
curl -s http://localhost:3001/health && echo "" || echo "⚠️  服务可能正在启动中"

ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "✅ 部署成功！"
    echo "========================================="
    echo ""
    echo "📱 后端API地址: http://101.37.28.116:3001"
    echo "🔍 测试连接: curl http://101.37.28.116:3001/health"
    echo ""
    echo "前端已自动配置为服务器地址"
else
    echo "❌ 部署失败，请检查错误信息"
fi


