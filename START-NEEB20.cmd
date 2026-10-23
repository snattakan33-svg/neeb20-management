@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ยังไม่พบ Node.js บนเครื่องนี้
  echo ติดตั้ง Node.js 24 LTS จาก https://nodejs.org แล้วดับเบิลคลิกไฟล์นี้ใหม่
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=13 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js รุ่นเก่าเกินไป กรุณาติดตั้ง Node.js 24 LTS
  node --version
  pause
  exit /b 1
)
echo หนีบ20 PREPAID DEMO - ข้อมูลทดสอบ ไม่เชื่อมธนาคาร
echo รอเซิร์ฟเวอร์เริ่ม เบราว์เซอร์จะเปิดให้ กรุณาเปิดหน้าต่างนี้ค้างไว้
node scripts/start-demo.js
echo ถ้าเปิดไม่สำเร็จ ให้ถ่ายภาพข้อความในหน้าต่างนี้เพื่อวิเคราะห์
pause
