#!/bin/bash

# 立即修复：暂时禁用文件路由，让服务先正常运行
# 在本地电脑执行

echo "========================================="
echo "立即修复：暂时禁用文件路由"
echo "========================================="
echo ""

ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

echo "1. 停止服务..."
pm2 stop 3d-manage-api 2>/dev/null || true
pm2 delete 3d-manage-api 2>/dev/null || true

echo "2. 备份 server.js..."
cp server.js server.js.bak.$(date +%Y%m%d_%H%M%S)

echo "3. 暂时禁用文件路由..."
sed -i "s|app.use('/api/files', require('./routes/files'));|// app.use('/api/files', require('./routes/files')); // 暂时禁用文件路由|g" server.js

echo "4. 验证修改..."
grep -A 1 "api/files" server.js

echo "5. 检查语法..."
if node -c server.js 2>/dev/null; then
    echo "✅ server.js 语法正确"
else
    echo "❌ server.js 语法错误:"
    node -c server.js
    exit 1
fi

echo "6. 启动服务..."
pm2 start server.js --name "3d-manage-api"
sleep 3

echo "7. 查看状态..."
pm2 status

echo "8. 查看日志（最后20行）..."
pm2 logs 3d-manage-api --lines 20 --nostream | tail -25

echo "9. 测试API..."
sleep 2
echo "测试健康检查:"
curl -s http://localhost:3001/health && echo "" || echo "❌ 健康检查失败"
echo ""

echo "测试订单API:"
curl -s http://localhost:3001/api/orders && echo "" || echo "❌ 订单API失败"
echo ""

if curl -s --connect-timeout 3 http://localhost:3001/health > /dev/null; then
    echo "✅ 服务正常运行！"
    echo ""
    echo "注意：文件路由已暂时禁用"
    echo "如果需要文件下载功能，稍后再修复文件路由"
else
    echo "❌ 服务仍然无法启动"
    echo "查看错误日志:"
    pm2 logs 3d-manage-api --err --lines 20 --nostream
fi

ENDSSH

echo ""
echo "========================================="
echo "修复完成"
echo "========================================="


