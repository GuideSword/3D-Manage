# 更新远程服务器模型路由文件说明

## 问题描述
前端应用在查看模型详情时出现 "Route not found" 错误，因为远程服务器缺少 `GET /api/models/:id` 路由。

## 解决方案

### 方法一：使用自动更新脚本（推荐）

1. **使用默认配置运行脚本**（服务器IP: 101.37.28.116，用户: root）
   ```bash
   ./update_models_route.sh
   ```

2. **自定义配置运行脚本**
   ```bash
   ./update_models_route.sh [用户名] [服务器IP] [后端路径]
   ```
   
   示例：
   ```bash
   ./update_models_route.sh root 101.37.28.116 /root/3D-Manage/backend
   ```

3. **脚本功能**
   - ✅ 自动上传 `backend/routes/models.js` 文件到远程服务器
   - ✅ 自动检测并重启后端服务（支持 PM2 和普通 node 进程）
   - ✅ 显示更新状态和验证信息

### 方法二：手动更新

#### 步骤 1: 上传文件
```bash
scp backend/routes/models.js root@101.37.28.116:/root/3D-Manage/backend/routes/models.js
```

#### 步骤 2: 连接到服务器并重启服务
```bash
ssh root@101.37.28.116
cd /root/3D-Manage/backend
```

**如果使用 PM2：**
```bash
pm2 restart backend
# 或者
pm2 restart server.js
# 或者
pm2 restart all
```

**如果没有使用 PM2：**
```bash
# 查找并停止当前进程
ps aux | grep node
kill <PID>

# 重新启动
nohup node server.js > server.log 2>&1 &
```

### 方法三：直接编辑远程文件

1. **连接到服务器**
   ```bash
   ssh root@101.37.28.116
   cd /root/3D-Manage/backend/routes
   ```

2. **编辑 models.js 文件**
   ```bash
   nano models.js
   # 或
   vim models.js
   ```

3. **在 `POST /api/models/:id/versions` 路由之后，添加以下路由：**
   ```javascript
   // GET /api/models/:id - 获取单个模型详情
   router.get('/:id', async (req, res) => {
     try {
       const model = mockModels.find(m => m.id === req.params.id);
       if (!model) {
         return res.status(404).json({ error: '模型不存在' });
       }
       res.json(model);
     } catch (error) {
       res.status(500).json({ error: '获取模型详情失败' });
     }
   });
   ```

4. **确保路由顺序正确**（重要！）
   - `GET /` - 列表
   - `POST /` - 创建
   - `POST /upload` - 上传（必须在 `/:id` 之前）
   - `POST /:id/versions` - 版本（必须在 `/:id` 之前）
   - `GET /:id` - 详情（新增）
   - `DELETE /:id` - 删除

5. **保存文件并重启服务**

## 验证更新

更新完成后，可以通过以下方式验证：

### 1. 使用 curl 测试
```bash
# 测试获取模型列表
curl http://101.37.28.116:3001/api/models

# 测试获取单个模型（假设模型ID为1）
curl http://101.37.28.116:3001/api/models/1
```

### 2. 在前端应用测试
- 打开模型管理页面
- 点击任意模型卡片
- 应该能正常显示模型详情页面

## 注意事项

1. **路由顺序很重要**：`/upload` 和 `/:id/versions` 必须在 `/:id` 之前定义，否则会被 `/:id` 路由拦截。

2. **服务重启**：更新代码后必须重启后端服务才能生效。

3. **备份**：建议在更新前备份原文件：
   ```bash
   ssh root@101.37.28.116
   cp /root/3D-Manage/backend/routes/models.js /root/3D-Manage/backend/routes/models.js.backup
   ```

4. **权限问题**：如果遇到权限问题，确保：
   - SSH 密钥已配置
   - 有文件写入权限
   - 有服务重启权限

## 故障排查

### 问题：脚本执行失败
- 检查 SSH 连接是否正常
- 确认服务器路径是否正确
- 检查文件权限

### 问题：服务重启失败
- 检查 PM2 是否安装：`pm2 --version`
- 检查服务名称是否正确
- 查看服务器日志：`pm2 logs` 或 `tail -f server.log`

### 问题：路由仍然不工作
- 确认文件已正确上传
- 确认服务已重启
- 检查服务器日志是否有错误
- 验证路由顺序是否正确

## 文件位置

- **本地文件**: `backend/routes/models.js`
- **远程文件**: `/root/3D-Manage/backend/routes/models.js`（根据实际情况调整）
- **更新脚本**: `update_models_route.sh`




