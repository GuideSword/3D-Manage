#!/bin/bash

# 快速诊断脚本 - 在本地电脑执行

echo "========================================="
echo "快速诊断服务器错误"
echo "========================================="
echo ""

# 执行诊断
ssh root@101.37.28.116 << 'ENDSSH'
cd /opt/3d-manage-backend

echo "1. 查看最新错误日志（最后30行）:"
echo "----------------------------------------"
pm2 logs 3d-manage-api --err --lines 30 --nostream 2>&1 | tail -35
echo ""

echo "2. 检查文件内容:"
echo "----------------------------------------"
echo "routes/files.js 第7行:"
sed -n '7p' routes/files.js
echo "routes/files.js 第9-10行:"
sed -n '9,10p' routes/files.js
echo ""

echo "3. 检查语法:"
echo "----------------------------------------"
node -c routes/files.js 2>&1 && echo "✅ files.js 语法正确" || echo "❌ files.js 语法错误"
node -c server.js 2>&1 && echo "✅ server.js 语法正确" || echo "❌ server.js 语法错误"
echo ""

echo "4. 检查依赖:"
echo "----------------------------------------"
if [ -d "node_modules/express" ]; then
    echo "✅ express 已安装"
    node -e "console.log('Express版本:', require('express/package.json').version)"
else
    echo "❌ express 未安装"
fi
echo ""

echo "5. 手动测试启动（5秒超时）:"
echo "----------------------------------------"
timeout 5 node server.js 2>&1 || echo "启动失败或超时"
echo ""

ENDSSH

echo ""
echo "========================================="
echo "诊断完成"
echo "========================================="
echo ""
echo "请查看上面的错误信息，然后执行相应的修复方案"


