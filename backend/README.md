# 3D打印管理系统 - 后端服务

基于 Node.js + Express 的后端API服务，支持文件本地存储。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库、JWT密钥等
```

### 3. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务将在 `http://localhost:3001` 启动。

## 部署到服务器

### 使用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start server.js --name "3d-manage-api"

# 保存进程列表
pm2 save

# 设置开机自启
pm2 startup

# 查看日志
pm2 logs 3d-manage-api
```

### 使用 Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 文件上传大小限制
    client_max_body_size 500M;
}
```

## 文件存储

- **存储位置**: `backend/uploads/`
- **目录结构**:
  - `models/` - 模型文件（STL/OBJ/3MF）
  - `orders/attachments/` - 订单附件（图片/PDF）
  - `stock/` - 库存批次图片
  - `previews/` - 预览图

- **文件访问**: `GET /api/files/:filePath`
- **文件大小限制**: 模型文件 500MB，附件 50MB

## API 端点

- `GET /health` - 健康检查
- `POST /api/auth/login` - 登录
- `GET /api/orders` - 获取订单列表
- `POST /api/orders` - 创建订单
- `POST /api/orders/upload-attachment` - 上传订单附件
- `GET /api/models` - 获取模型列表
- `POST /api/models/upload` - 上传模型文件
- `GET /api/files/:filePath` - 下载文件

## 注意事项

1. **生产环境**:
   - 修改 JWT_SECRET 为强密钥
   - 配置 HTTPS
   - 设置文件备份策略
   - 定期清理临时文件

2. **存储空间**:
   - 监控 `uploads/` 目录大小
   - 建议设置自动备份
   - 考虑使用云存储（如需要）

3. **性能优化**:
   - 大文件上传建议使用流式处理
   - 配置 Nginx 缓存静态文件
   - 使用 CDN 加速文件下载（可选）


