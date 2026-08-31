#!/bin/zsh
set -e

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir"

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 Node.js/npm。请先安装 Node.js 22 或更高版本。"
  read -r "?按回车键退出..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次启动：正在安装依赖..."
  npm install
fi

(
  sleep 2
  open "http://localhost:3000"
) &

npm run dev
