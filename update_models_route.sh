#!/bin/bash

# 更新远程服务器上的 models.js 路由文件
# 使用方法: ./update_models_route.sh [服务器用户] [服务器IP] [后端路径]

# 配置变量
SERVER_USER="${1:-root}"  # 默认使用 root 用户
SERVER_IP="${2:-101.37.28.116}"  # 默认服务器IP
BACKEND_PATH="${3:-/root/3D-Manage/backend}"  # 默认后端路径
LOCAL_FILE="backend/routes/models.js"

# SSH连接复用配置（避免多次输入密码）
SSH_SOCKET="/tmp/ssh_socket_${SERVER_USER}_${SERVER_IP}"
SSH_OPTS="-q -o ControlMaster=yes -o ControlPath=${SSH_SOCKET} -o ControlPersist=60 -o StrictHostKeyChecking=no -o LogLevel=ERROR -o UserKnownHostsFile=/dev/null -o BatchMode=no"

echo "=========================================="
echo "更新远程服务器模型路由文件"
echo "=========================================="
echo "服务器: ${SERVER_USER}@${SERVER_IP}"
echo "本地文件: ${LOCAL_FILE}"
echo "=========================================="
echo ""

# 检查本地文件是否存在
if [ ! -f "${LOCAL_FILE}" ]; then
    echo "❌ 错误: 本地文件 ${LOCAL_FILE} 不存在"
    exit 1
fi

# 清理旧的SSH socket（如果存在）
if [ -S "${SSH_SOCKET}" ]; then
    ssh ${SSH_OPTS} -O exit "${SERVER_USER}@${SERVER_IP}" 2>/dev/null
    rm -f "${SSH_SOCKET}"
fi

# 建立SSH连接复用（只需要输入一次密码）
echo "🔐 建立SSH连接（只需输入一次密码）..."
ssh ${SSH_OPTS} -f -N "${SERVER_USER}@${SERVER_IP}"

if [ $? -ne 0 ]; then
    echo "❌ SSH连接失败，请检查网络和认证信息"
    exit 1
fi

# 使用连接复用来查找后端路径（抑制motd输出）
echo "📁 查找后端目录..."

# 使用单个命令查找路径，输出重定向到stderr避免污染
BACKEND_PATH_FOUND=$(ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_IP}" 'bash -c "
    BACKEND_PATH=\"'${BACKEND_PATH}'\"
    
    if [ ! -d \"\$BACKEND_PATH\" ] || [ ! -f \"\$BACKEND_PATH/server.js" ]; then
        POSSIBLE_PATHS=(
            \"/root/3D-Manage/backend\"
            \"/home/root/3D-Manage/backend\"
            \"/opt/3D-Manage/backend\"
            \"/opt/3d-manage-backend\"
            \"/var/www/3D-Manage/backend\"
        )
        
        for path in \"\${POSSIBLE_PATHS[@]}\"; do
            if [ -d \"\$path\" ] && [ -f \"\$path/server.js\" ]; then
                BACKEND_PATH=\"\$path\"
                break
            fi
        done
        
        if [ ! -d \"\$BACKEND_PATH\" ] || [ ! -f \"\$BACKEND_PATH/server.js\" ]; then
            SEARCH_RESULT=\$(find /root /home /opt /var/www -name \"server.js\" -type f 2>/dev/null | head -1)
            if [ ! -z \"\$SEARCH_RESULT\" ]; then
                BACKEND_PATH=\$(dirname \"\$SEARCH_RESULT\")
            fi
        fi
    fi
    
    echo \"\$BACKEND_PATH\"
"' 2>/dev/null | tail -1)

# 清理输出中的换行符和空格
BACKEND_PATH_FOUND=$(echo "$BACKEND_PATH_FOUND" | tr -d '\r\n' | xargs)

if [ ! -z "$BACKEND_PATH_FOUND" ] && [[ "$BACKEND_PATH_FOUND" == /* ]] && [[ ! "$BACKEND_PATH_FOUND" == *"Welcome"* ]] && [[ ! "$BACKEND_PATH_FOUND" == *"Ubuntu"* ]]; then
    BACKEND_PATH="$BACKEND_PATH_FOUND"
    echo "✅ 找到后端目录: ${BACKEND_PATH}"
else
    # 如果提取失败，使用已知的路径（从之前的输出中看到是 /opt/3d-manage-backend）
    BACKEND_PATH="/opt/3d-manage-backend"
    echo "⚠️  使用默认路径: ${BACKEND_PATH}"
fi

echo ""

# 创建 routes 目录
echo "📁 准备远程目录..."
ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_IP}" "mkdir -p ${BACKEND_PATH}/routes" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ 无法创建远程目录，请检查SSH连接和权限"
    ssh ${SSH_OPTS} -O exit "${SERVER_USER}@${SERVER_IP}" 2>/dev/null
    rm -f "${SSH_SOCKET}"
    exit 1
fi

REMOTE_FILE="${BACKEND_PATH}/routes/models.js"

# 使用SSH连接复用上传文件（不需要再次输入密码）
echo "📤 正在上传文件到远程服务器..."
scp ${SSH_OPTS} "${LOCAL_FILE}" "${SERVER_USER}@${SERVER_IP}:${REMOTE_FILE}" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ 文件上传失败"
    ssh ${SSH_OPTS} -O exit "${SERVER_USER}@${SERVER_IP}" 2>/dev/null
    rm -f "${SSH_SOCKET}"
    exit 1
fi

echo "✅ 文件上传成功"
echo ""

# 使用SSH连接复用重启服务（不需要再次输入密码）
echo "🔄 正在重启后端服务..."
ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_IP}" << REMOTE_SCRIPT 2>/dev/null
    BACKEND_PATH="${BACKEND_PATH}"
    cd "\${BACKEND_PATH}"
    
    # 检查是否使用 PM2
    if command -v pm2 &> /dev/null; then
        echo "检测到 PM2，使用 PM2 重启服务..."
        pm2 restart backend || pm2 restart server.js || pm2 restart all || echo "PM2重启失败，请手动检查"
    else
        echo "未检测到 PM2，尝试其他方式重启..."
        # 查找 node 进程
        PID=\$(ps aux | grep '[n]ode.*server.js' | awk '{print \$2}')
        if [ ! -z "\$PID" ]; then
            echo "找到运行中的进程 PID: \$PID"
            kill \$PID
            sleep 2
        fi
        # 启动服务（根据实际情况调整）
        nohup node server.js > server.log 2>&1 &
        echo "服务已启动"
    fi
    
    echo "✅ 服务重启完成"
REMOTE_SCRIPT

if [ $? -ne 0 ]; then
    echo "❌ 服务重启失败，请手动检查"
fi

# 清理SSH连接
ssh ${SSH_OPTS} -O exit "${SERVER_USER}@${SERVER_IP}" 2>/dev/null
rm -f "${SSH_SOCKET}"

echo ""
echo "=========================================="
echo "✅ 更新完成！"
echo "=========================================="
echo ""
echo "请测试以下接口验证更新是否成功："
echo "  - GET http://${SERVER_IP}:3001/api/models (获取列表)"
echo "  - GET http://${SERVER_IP}:3001/api/models/1 (获取详情)"
echo ""
