#!/bin/bash

# 查找远程服务器上的后端路径
# 使用方法: ./find_backend_path.sh [服务器用户] [服务器IP]

SERVER_USER="${1:-root}"
SERVER_IP="${2:-101.37.28.116}"

echo "=========================================="
echo "查找远程服务器后端路径"
echo "=========================================="
echo "服务器: ${SERVER_USER}@${SERVER_IP}"
echo "=========================================="
echo ""

# 查找包含 server.js 或 package.json 的目录
echo "🔍 正在搜索后端目录..."
echo ""

# 搜索常见的路径
POSSIBLE_PATHS=(
    "/root/3D-Manage/backend"
    "/home/root/3D-Manage/backend"
    "/opt/3D-Manage/backend"
    "/var/www/3D-Manage/backend"
    "/home/*/3D-Manage/backend"
    "/root/*/backend"
)

FOUND_PATHS=()

for path in "${POSSIBLE_PATHS[@]}"; do
    if ssh "${SERVER_USER}@${SERVER_IP}" "test -f ${path}/server.js" 2>/dev/null; then
        FOUND_PATHS+=("$path")
        echo "✅ 找到: ${path}"
    fi
done

# 如果没找到，尝试全局搜索
if [ ${#FOUND_PATHS[@]} -eq 0 ]; then
    echo "在常见路径中未找到，尝试全局搜索 server.js..."
    echo "（这可能需要一些时间）"
    echo ""
    
    # 搜索 server.js 文件
    SEARCH_RESULT=$(ssh "${SERVER_USER}@${SERVER_IP}" "find /root /home /opt /var/www -name 'server.js' -type f 2>/dev/null | head -5")
    
    if [ ! -z "$SEARCH_RESULT" ]; then
        echo "找到以下可能的路径："
        echo "$SEARCH_RESULT" | while read -r line; do
            BACKEND_DIR=$(dirname "$line")
            echo "  - ${BACKEND_DIR}"
            FOUND_PATHS+=("$BACKEND_DIR")
        done
    fi
fi

echo ""
echo "=========================================="
if [ ${#FOUND_PATHS[@]} -eq 0 ]; then
    echo "❌ 未找到后端目录"
    echo ""
    echo "请手动连接到服务器查找："
    echo "  ssh ${SERVER_USER}@${SERVER_IP}"
    echo "  find / -name 'server.js' -type f 2>/dev/null"
else
    echo "✅ 找到 ${#FOUND_PATHS[@]} 个可能的路径"
    echo ""
    echo "请使用以下命令更新（使用找到的路径）："
    for path in "${FOUND_PATHS[@]}"; do
        echo "  ./update_models_route.sh ${SERVER_USER} ${SERVER_IP} ${path}"
    done
fi
echo "=========================================="




