@echo off
chcp 65001 >nul
set "TMPPS=%TEMP%\~hosp_deploy.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content '%~f0' -Encoding UTF8 | Select-Object -Skip 8) -join \"`r`n\" | Out-File -Encoding UTF8 '%TMPPS%'; & '%TMPPS%' '%~dp0'"
set "ERR=%ERRORLEVEL%"
del "%TMPPS%" 2>nul
if %ERR% neq 0 pause
exit /b %ERR%

# ============================================
# hospital-voice-app one-click deploy
# log: same-dir deploy.log.txt
# ============================================
param([string]$ScriptDir = ".")

$ErrorActionPreference = "Continue"
$RepoUrl = "https://gitee.com/daiyafeigitee/hospital-voice-app.git"
$ProjectDir = "$env:USERPROFILE\hospital-voice-app"
$Port = 3000
$LogFile = Join-Path $ScriptDir "deploy.log.txt"

function Log { param([string]$M, [string]$L="INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$L] $M"
    [System.IO.File]::AppendAllText($LogFile, $line + "`r`n", [System.Text.Encoding]::UTF8)
    $c = switch ($L) { "ERR"{"Red"} "WARN"{"Yellow"} "OK"{"Green"} default{"White"} }
    Write-Host $line -ForegroundColor $c
}
function Fail { param([string]$S)
    Log "!!! $S FAILED !!!" -L "ERR"; Log "Error: $($_.Exception.Message)" -L "ERR"
    Write-Host "Press Enter to exit..." -ForegroundColor Red; Read-Host; exit 1
}

$null = New-Item -Path $LogFile -Force
Log "========== DEPLOY START =========="
Log "ScriptDir: $ScriptDir"
Log "ProjectDir: $ProjectDir"
Log "Repo: $RepoUrl"

# refresh PATH
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

# ---- 1. Node.js ----
Write-Host "[1/7] Check Node.js..." -ForegroundColor Yellow
try {
    $nv = cmd /c "node --version 2>&1"
    Log "node check: $nv"
    if ($nv -match 'v(\d+)') {
        $m = [int]$Matches[1]
        if ($m -ge 18) { Log "Node.js $($nv.Trim()) OK" -L "OK" }
        else { Log "Node.js too old (v$m < 18)" -L "WARN"; throw }
    } else { throw }
} catch {
    Log "Installing Node.js via winget..."
    try {
        & winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
        $nv = cmd /c "node --version 2>&1"
        if ($nv -match 'v(\d+)' -and [int]$Matches[1] -ge 18) {
            Log "Node.js installed: $($nv.Trim())" -L "OK"
        } else { throw "Node.js not available after install" }
    } catch { Fail "Node.js install" }
}

# ---- 2. Git ----
Write-Host "[2/7] Check Git..." -ForegroundColor Yellow
try {
    $gv = cmd /c "git --version 2>&1"
    Log "git check: $gv"
    if ($gv -notmatch 'git version') { throw }
    Log "Git $($gv.Trim()) OK" -L "OK"
} catch {
    Log "Installing Git via winget..."
    try {
        & winget install Git.Git --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
        $gv = cmd /c "git --version 2>&1"
        if ($gv -match 'git version') { Log "Git installed OK" -L "OK" }
        else { throw "Git not available after install" }
    } catch { Fail "Git install" }
}

# ---- 3. Clone / Pull ----
Write-Host "[3/7] Get code..." -ForegroundColor Yellow
if (Test-Path $ProjectDir) {
    Log "Dir exists, pulling..."
    Set-Location $ProjectDir
    $o = cmd /c "git stash 2>&1"; Log "git stash: $o"
    $o = cmd /c "git checkout main 2>&1"; Log "git checkout: $o"
    $o = cmd /c "git pull origin main 2>&1"; Log "git pull: $o"
    if ($LASTEXITCODE -ne 0) { Fail "Git pull" }
    Log "Code updated OK" -L "OK"
} else {
    Log "Cloning..."
    $o = cmd /c "git clone $RepoUrl $ProjectDir 2>&1"; Log "git clone: $o"
    if ((Test-Path (Join-Path $ProjectDir ".git")) -eq $false) { Fail "Git clone" }
    Set-Location $ProjectDir
    Log "Clone OK" -L "OK"
}

# ---- 4. npm install ----
Write-Host "[4/7] Install deps..." -ForegroundColor Yellow
try {
    Set-Location $ProjectDir
    $o = npm install 2>&1 | Out-String
    Log "npm install output (last 10 lines):"
    ($o -split "`n" | Select-Object -Last 10) | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "npm install exit=$LASTEXITCODE" }
    Log "npm install OK" -L "OK"
} catch { Fail "npm install" }

# ---- 5. Video convert (H.265→H.264, browser compatible) ----
Write-Host "[5/7] Check video..." -ForegroundColor Yellow
$videoFile = Join-Path $ProjectDir "public" "respiratory-response.mp4"
if (Test-Path $videoFile) {
    try {
        Log "Video found, converting to H.264..."
        Set-Location $ProjectDir
        $o = node convert-video.mjs 2>&1 | Out-String
        Log "convert output: $($o -replace '\n',' ') "
        if ($LASTEXITCODE -ne 0) { Log "Video convert failed, may still play" -L "WARN" }
        else { Log "Video converted OK" -L "OK" }
    } catch { Log "Video convert error, skip" -L "WARN" }
} else {
    Log "No local video, skip" -L "WARN"
}

# ---- 6. Build ----
Write-Host "[6/7] Build project..." -ForegroundColor Yellow
try {
    Set-Location $ProjectDir
    $env:NODE_ENV = "production"
    $o = npx next build 2>&1 | Out-String
    Log "build output (last 10 lines):"
    ($o -split "`n" | Select-Object -Last 10) | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "build exit=$LASTEXITCODE" }
    Log "Build OK" -L "OK"
} catch { Fail "Build" }


# ---- Done ----
Log "========== DEPLOY COMPLETE =========="
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DEPLOY SUCCESS!" -ForegroundColor Green
Write-Host "  Local:  http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Log:    $LogFile" -ForegroundColor Yellow
Write-Host "  Ctrl+C to stop all services" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

try { while ($true) { Start-Sleep 10 } } finally {
    Log "Cleaning up..."
    try { & taskkill /PID $proc.Id /F 2>&1 | Out-Null } catch {}
    Log "Stopped."
}
