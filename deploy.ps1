# ============================================
# 一键部署脚本 - hospital-voice-app
# 用法: .\deploy.ps1
# ============================================

$Server = "118.195.146.26"
$User = "root"
$RemoteDir = "/root/app/hospeech/hospital-voice-app"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  hospital-voice-app 一键部署" -ForegroundColor Cyan
Write-Host ("  目标: " + $User + "@" + $Server) -ForegroundColor Cyan
Write-Host ("  路径: " + $RemoteDir) -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 清理旧的部署包
Write-Host "`n[1/6] 清理旧文件..." -ForegroundColor Yellow
if (Test-Path "deploy.zip") { Remove-Item "deploy.zip" -Force }
if (Test-Path "remote-setup.sh") { Remove-Item "remote-setup.sh" -Force }

# 2. 构建项目
Write-Host "`n[2/6] 构建项目..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "构建失败！退出部署。" -ForegroundColor Red
    exit 1
}

# 3. 打包
Write-Host "`n[3/6] 打包部署文件..." -ForegroundColor Yellow
Compress-Archive -Path ".next", "public", "package.json", "package-lock.json", "server.js", ".env.production", ".cert" -DestinationPath "deploy.zip" -Force
$size = [math]::Round((Get-Item deploy.zip).Length/1MB, 1)
Write-Host ("  打包完成: deploy.zip (" + $size + " MB)") -ForegroundColor Green

# 4. 生成远程安装脚本（逐行写入，避免 here-string 语法冲突）
Write-Host "`n[4/6] 生成远程安装脚本..." -ForegroundColor Yellow
$bashLines = @(
    "#!/bin/bash",
    "set -e",
    "cd " + $RemoteDir,
    "",
    "echo '==> 解压...'",
    "unzip -o deploy.zip",
    "",
    "echo '==> 安装依赖...'",
    "npm install --production",
    "",
    "echo '==> 停止旧进程...'",
    "pkill -f 'node server.js' 2>/dev/null || true",
    "sleep 1",
    "",
    "echo '==> 启动服务...'",
    "NODE_ENV=production nohup node server.js > app.log 2>&1 &",
    "sleep 3",
    "",
    "echo '==> 检查状态...'",
    "if pgrep -f 'node server.js' > /dev/null; then",
    "  echo ''",
    "  echo '========================================'",
    "  echo '  部署成功！'",
    "  echo '  访问: https://" + $Server + ":3000'",
    "  echo '========================================'",
    "else",
    "  echo ''",
    "  echo '! 启动失败，最后 20 行日志:'",
    "  tail -20 app.log",
    "fi"
)
$bashLines -join "`n" | Out-File -FilePath "remote-setup.sh" -Encoding ASCII

# 5. 上传
Write-Host "`n[5/6] 上传到服务器..." -ForegroundColor Yellow
ssh $User@$Server "mkdir -p $RemoteDir"
scp deploy.zip remote-setup.sh ($User + "@" + $Server + ":" + $RemoteDir + "/")
if ($LASTEXITCODE -ne 0) {
    Write-Host "上传失败！" -ForegroundColor Red
    exit 1
}
Write-Host "  上传完成" -ForegroundColor Green

# 6. 远程执行安装脚本
Write-Host "`n[6/6] 远程安装并启动..." -ForegroundColor Yellow
ssh ($User + "@" + $Server) ("cd " + $RemoteDir + " && bash remote-setup.sh")

# 清理本地临时文件
Remove-Item "remote-setup.sh" -Force

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host ("  访问: https://" + $Server + ":3000") -ForegroundColor Cyan
Write-Host ("  查看日志: ssh " + $User + "@" + $Server + " 'tail -f " + $RemoteDir + "/app.log'") -ForegroundColor Cyan
Write-Host ("  停止服务: ssh " + $User + "@" + $Server + " 'pkill -f node\ server.js'") -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
