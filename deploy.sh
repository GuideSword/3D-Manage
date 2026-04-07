#!/bin/bash

# 3D打印管理系统 - 自动化部署脚本
# 服务器信息
SERVER_IP="101.37.28.116"
SERVER_USER="root"
SERVER_PASSWORD="huangjianpei123@"
SERVER_PORT="22"
DEPLOY_PATH="/opt/3d-manage-backend"

echo "🚀 开始部署到服务器 $SERVER_IP..."

# 检查是否安装了sshpass（用于非交互式SSH登录）
if ! command -v sshpass &> /dev/null; then
    echo "⚠️  未找到 sshpass，正在安装..."
    # 尝试安装sshpass（根据系统不同可能需要手动安装）
    sudo apt-get update && sudo apt-get install -y sshpass 2>/dev/null || \
    sudo yum install -y sshpass 2>/dev/null || \
    echo "请手动安装 sshpass: sudo apt-get install sshpass 或 sudo yum install sshpass"
fi

# 创建临时目录并打包后端代码
echo "📦 打包后端代码..."
cd "$(dirname "$0")"
TEMP_DIR=$(mktemp -d)
cp -r backend/* "$TEMP_DIR/"
cd "$TEMP_DIR"

# 创建必要的目录
mkdir -p uploads/models uploads/orders/attachments uploads/stock uploads/previews

# 创建.env文件
cat > .env << EOF
PORT=3001
FRONTEND_URL=*
JWT_SECRET=$(openssl rand -base64 32)
UPLOAD_DIR=./uploads
API_BASE_URL=http://$SERVER_IP:3001
EOF

# 打包
tar -czf backend.tar.gz .
echo "✅ 代码打包完成"

# 上传到服务器
echo "📤 上传代码到服务器..."
sshpass -p "$SERVER_PASSWORD" scp -o StrictHostKeyChecking=no backend.tar.gz "$SERVER_USER@$SERVER_IP:/tmp/"

# 在服务器上执行部署命令
echo "🔧 在服务器上安装和配置..."
sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" << 'ENDSSH'
set -e

DEPLOY_PATH="/opt/3d-manage-backend"

echo "创建部署目录..."
mkdir -p $DEPLOY_PATH
cd $DEPLOY_PATH

echo "解压代码..."
tar -xzf /tmp/backend.tar.gz
rm /tmp/backend.tar.gz

echo "检查Node.js..."
if ! command -v node &> /dev/null; then
    echo "安装Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "Node.js版本: $(node -v)"
echo "npm版本: $(npm -v)"

echo "安装依赖..."
npm install --production

echo "安装PM2..."
npm install -g pm2 || true

echo "停止旧服务（如果存在）..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true

echo "启动服务..."
pm2 start server.js --name "3d-manage-api"
pm2 save

echo "配置防火墙..."
ufw allow 3001/tcp 2>/dev/null || firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
ufw reload 2>/dev/null || firewall-cmd --reload 2>/dev/null || true

echo "服务状态:"
pm2 status

echo "✅ 部署完成！"
echo "📱 API地址: http://$SERVER_IP:3001"
echo "🔍 查看日志: pm2 logs 3d-manage-api"
ENDSSH

# 清理临时文件
rm -rf "$TEMP_DIR"
cd "$(dirname "$0")"

echo ""
echo "✅ 部署完成！"
echo "📱 后端API地址: http://101.37.28.116:3001"
echo "🔍 查看服务状态: ssh $SERVER_USER@$SERVER_IP 'pm2 status'"
echo "📋 查看日志: ssh $SERVER_USER@$SERVER_IP 'pm2 logs 3d-manage-api'"


