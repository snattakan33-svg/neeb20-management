@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo ติดตั้ง Node.js 24 LTS จาก https://nodejs.org ก่อนเปิดข้อมูลตัวอย่าง
 pause
 exit /b 1
)
if not exist ".data\reconciliation-sample.sqlite" (
 node scripts/seed-reconciliation-demo.js
 if errorlevel 1 (
  pause
  exit /b 1
 )
)
set "NEEB20_DEMO_DB=%~dp0.data\reconciliation-sample.sqlite"
set "PORT=3001"
call START-NEEB20.cmd
