# 手动部署指南（服务器: 101.37.28.116）

如果自动部署脚本无法运行，可以按照以下步骤手动部署。

## 一、连接到服务器

```bash
ssh root@101.37.28.116
# 密码: huangjianpei123@
```

## 二、准备服务器环境

```bash
# 1. 更新系统
apt-get update && apt-get upgrade -y

# 2. 安装Node.js（如果未安装）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. 验证安装
node -v
npm -v

# 4. 安装PM2（进程管理器）
npm install -g pm2
```

## 三、上传代码

### 方法1：使用SCP（在本地电脑执行）

```bash
# 在本地项目目录执行
cd /home/huangjianpei/3D-Manage

# 打包后端代码
tar -czf backend.tar.gz backend/

# 上传到服务器
scp backend.tar.gz root@101.37.28.116:/tmp/

# 连接服务器并解压
ssh root@101.37.28.116
cd /opt
mkdir -p 3d-manage-backend
cd 3d-manage-backend
tar -xzf /tmp/backend.tar.gz
rm /tmp/backend.tar.gz
```

### 方法2：使用Git（如果代码在Git仓库）

```bash
# 在服务器上执行
cd /opt
git clone your-repo-url 3d-manage-backend
cd 3d-manage-backend/backend
```

## 四、配置环境变量

```bash
cd /opt/3d-manage-backend

# 创建.env文件
cat > .env << EOF
PORT=3001
FRONTEND_URL=*
JWT_SECRET=$(openssl rand -base64 32)
UPLOAD_DIR=./uploads
API_BASE_URL=http://101.37.28.116:3001
EOF

# 创建上传目录
mkdir -p uploads/models uploads/orders/attachments uploads/stock uploads/previews
chmod -R 755 uploads
```

## 五、安装依赖并启动

```bash
cd /opt/3d-manage-backend

# 安装依赖
npm install --production

# 启动服务（使用PM2）
pm2 start server.js --name "3d-manage-api"

# 保存进程列表
pm2 save

# 设置开机自启
pm2 startup
# 执行输出的命令（如果有提示）
```

## 六、配置防火墙

```bash
# Ubuntu/Debian
ufw allow 3001/tcp
ufw reload

# 或者 CentOS/RHEL
firewall-cmd --permanent --add-port=3001/tcp
firewall-cmd --reload
```

## 七、验证部署

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs 3d-manage-api

# 测试API
curl http://localhost:3001/health
# 应该返回: {"status":"OK","timestamp":"..."}
```

## 八、更新前端配置

编辑前端 `constants/index.js`：

```javascript
export const API_CONFIG = {
  BASE_URL: 'http://101.37.28.116:3001/api',
  TIMEOUT: 30000,
};
```

## 常用命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs 3d-manage-api

# 重启服务
pm2 restart 3d-manage-api

# 停止服务
pm2 stop 3d-manage-api

# 查看实时日志
pm2 logs 3d-manage-api --lines 100
```

## 故障排查

1. **服务无法启动**：
   ```bash
   pm2 logs 3d-manage-api
   # 查看错误信息
   ```

2. **端口被占用**：
   ```bash
   netstat -tulpn | grep 3001
   # 或
   lsof -i :3001
   ```

3. **防火墙阻止**：
   ```bash
   ufw status
   # 确保3001端口已开放
   ```


