@echo off
setlocal EnableDelayedExpansion
title Cyber Girlfriend - Dev Launcher
cd /d %~dp0
chcp 65001 >nul

echo ============================================
echo   赛博女友 - 一键启动
echo   Backend : http://localhost:3000
echo   Frontend: http://localhost:5173
echo ============================================
echo.

rem ============================================================
rem  1) 后端（3000）：已在跑则跳过；否则清理残留并启动，等就绪
rem ============================================================
echo [1/4] 检查后端 3000 端口...
curl -s -o NUL -m 2 http://localhost:3000/api/health
if %errorlevel%==0 (
  echo      后端已在运行，跳过启动。
  goto frontend
)

echo [2/4] 清理 3000 残留进程并启动后端 ...
node client/scripts/free-port.cjs 3000
start "cyber-backend" cmd /k "npm run dev"

echo      等待后端就绪（最多 30 秒）...
set /a n=0
:wait_backend
curl -s -o NUL -m 2 http://localhost:3000/api/health
if %errorlevel% neq 0 (
  set /a n+=1
  if !n! lss 30 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
  )
  echo      [警告] 后端 30 秒未就绪，请检查 cyber-backend 窗口
) else (
  echo      后端就绪 OK
)

:frontend
rem ============================================================
rem  2) 前端（5173）：dev server 已内置 free-port，等就绪
rem ============================================================
echo [3/4] 启动前端 dev server (port 5173) ...
start "cyber-frontend" cmd /k "cd client && npm run dev"

echo      等待前端就绪（最多 30 秒）...
set /a n=0
:wait_frontend
curl -s -o NUL -m 2 http://localhost:5173/
if %errorlevel% neq 0 (
  set /a n+=1
  if !n! lss 30 (
    timeout /t 1 /nobreak >nul
    goto wait_frontend
  )
  echo      [警告] 前端 30 秒未就绪，请检查 cyber-frontend 窗口
) else (
  echo      前端就绪 OK
)

rem ============================================================
rem  3) 打开浏览器
rem ============================================================
echo [4/4] 打开 Edge ...
start msedge http://localhost:5173/

echo.
echo 完成！关闭 cyber-backend / cyber-frontend 两个窗口即可停止服务。
echo.
pause
