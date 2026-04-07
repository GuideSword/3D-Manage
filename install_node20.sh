#!/bin/bash
# 安装 Node.js 20 LTS

# 下载并运行 NodeSource 安装脚本
NODE_MAJOR=20

# 尝试使用 wget 下载
if command -v wget &> /dev/null; then
    wget -qO- https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
elif command -v curl &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
else
    echo "错误: 需要 wget 或 curl"
    exit 1
fi

# 安装 Node.js
sudo apt-get install -y nodejs

# 验证安装
echo "Node.js 版本:"
node --version
echo "npm 版本:"
npm --version

