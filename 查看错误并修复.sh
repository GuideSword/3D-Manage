#!/bin/bash

# 查看错误并修复 - 在本地电脑执行

echo "========================================="
echo "查看错误日志"
echo "========================================="
echo ""

# 查看错误日志
echo "1. 查看最新错误日志（最后50行）:"
ssh root@101.37.28.116 'pm2 logs 3d-manage-api --err --lines 50 --nostream' 2>&1 | tail -60

echo ""
echo "========================================="
echo "检查文件内容"
echo "========================================="
echo ""

# 检查文件内容
echo "2. 检查 routes/files.js 内容（前15行）:"
ssh root@101.37.28.116 'head -15 /opt/3d-manage-backend/routes/files.js' 2>&1

echo ""
echo "3. 检查语法:"
ssh root@101.37.28.116 'cd /opt/3d-manage-backend && node -c routes/files.js 2>&1 && echo "✅ 语法正确" || echo "❌ 语法错误"' 2>&1

echo ""
echo "4. 检查 server.js 语法:"
ssh root@101.37.28.116 'cd /opt/3d-manage-backend && node -c server.js 2>&1 && echo "✅ 语法正确" || echo "❌ 语法错误"' 2>&1

echo ""
echo "========================================="
echo "临时解决方案：暂时禁用文件路由"
echo "========================================="
echo ""

# 临时解决方案：注释掉文件路由
echo "5. 临时禁用文件路由（测试其他路由是否正常）..."
ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

# 备份 server.js
cp server.js server.js.bak

# 注释掉文件路由
sed -i "s|app.use('/api/files', require('./routes/files'));|// app.use('/api/files', require('./routes/files')); // 临时禁用|g" server.js

# 验证修改
grep -A 1 "api/files" server.js

# 重启服务
pm2 restart 3d-manage-api
sleep 3

# 查看状态
pm2 status

# 测试API
curl -s http://localhost:3001/health
echo ""

ENDSSH

echo ""
echo "========================================="
echo "如果服务正常，说明问题在文件路由"
echo "========================================="


