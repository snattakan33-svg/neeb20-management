@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org then reopen this file.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=13 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Please install Node.js 24 LTS.
  pause
  exit /b 1
)
echo NEEB20 SERVER DEMO - test data only.
echo Keep this window open. After the server starts, open http://127.0.0.1:3000 in Edge or Chrome.
node server.js
pause
