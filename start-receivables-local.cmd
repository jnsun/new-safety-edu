@echo off
setlocal
cd /d "%~dp0"
set "COREPACK=%ProgramFiles%\nodejs\corepack.cmd"
if not exist "%COREPACK%" (
  echo Corepack was not found. Install Node.js 22 with Corepack first.
  pause
  exit /b 1
)
call "%COREPACK%" pnpm test:receivables:local
if errorlevel 1 pause
