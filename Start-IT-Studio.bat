@echo off
cd /d "%~dp0"
setlocal
chcp 65001 >nul

if "%~1"=="" goto prerequisites
if /i not "%~1"=="--data-dir" goto usage
if "%~2"=="" goto usage
if not "%~3"=="" goto usage
set "ITSTUDIO_DATA_DIR=%~2"

:prerequisites
where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm >nul 2>&1
if errorlevel 1 goto missing_node
where cargo >nul 2>&1
if errorlevel 1 goto missing_cargo

echo IT Studio — starting from source. First start compiles the Rust shell (a few minutes).
echo Optional: Start-IT-Studio.bat --data-dir "folder" uses a throw-away data folder.
if defined ITSTUDIO_DATA_DIR echo Data folder: "%ITSTUDIO_DATA_DIR%"

if not exist "node_modules\" goto install
node -e "const fs = require('node:fs'); const marker = 'node_modules/.package-lock.json'; process.exit(!fs.existsSync(marker) || fs.statSync('package-lock.json').mtimeMs > fs.statSync(marker).mtimeMs ? 1 : 0);"
if errorlevel 1 goto install
goto start

:install
echo Installing dependencies / Dang cai dat thu vien...
call npm --cache .npm-cache install
set "ITSTUDIO_EXIT_CODE=%ERRORLEVEL%"
if not "%ITSTUDIO_EXIT_CODE%"=="0" goto install_failed

:start
rem Equivalent to npm run dev, with the repository-local npm cache.
call npm --cache .npm-cache run dev
set "ITSTUDIO_EXIT_CODE=%ERRORLEVEL%"
if not "%ITSTUDIO_EXIT_CODE%"=="0" goto start_failed
exit /b 0

:missing_node
echo Can Node.js va npm tren PATH. / Node.js and npm must be on PATH.
echo Cai dat / Install Node.js 24.19 or newer: https://nodejs.org/en/download
pause
exit /b 1

:missing_cargo
echo Can Rust va cargo tren PATH. / Rust and cargo must be on PATH.
echo Cai dat Rust bang rustup / Install Rust with rustup: https://rustup.rs/
pause
exit /b 1

:install_failed
echo Cai dat that bai / npm install failed. Exit code: %ITSTUDIO_EXIT_CODE%
pause
exit /b %ITSTUDIO_EXIT_CODE%

:start_failed
echo Ung dung dung voi loi / IT Studio exited with code %ITSTUDIO_EXIT_CODE%.
pause
exit /b %ITSTUDIO_EXIT_CODE%

:usage
echo Cach dung / Usage: Start-IT-Studio.bat [--data-dir "folder"]
pause
exit /b 1
