#!/bin/bash
set -e
cd /root/app/hospeech/hospital-voice-app

echo '==> 解压...'
unzip -o deploy.zip

echo '==> 安装依赖...'
npm install --production

echo '==> 停止旧进程...'
pkill -f 'node server.js' 2>/dev/null || true
sleep 1

echo '==> 启动服务...'
NODE_ENV=production nohup node server.js > app.log 2>&1 &
sleep 3

echo '==> 检查状态...'
if pgrep -f 'node server.js' > /dev/null; then
  echo ''
  echo '========================================'
  echo '  部署成功！'
  echo '  访问: https://118.195.146.26:3000'
  echo '========================================'
else
  echo ''
  echo '! 启动失败，最后 20 行日志:'
  tail -20 app.log
fi
