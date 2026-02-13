#!/bin/bash
# 自动化 PAI 安装向导的输入脚本

cat <<EOF | bun install.ts
y
y
zephyr
Kai
Asia/Shanghai
n
EOF
