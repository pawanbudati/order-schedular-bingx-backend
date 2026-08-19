@echo off
echo ===================================================
echo   Setting up BingX Order Scheduler Backend Service
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/3] Installing NPM Dependencies...
call npm install

echo.
echo [2/3] Building TypeScript...
call npm run build

echo.
echo ===================================================
echo   Setup Complete! Starting Dev Server on Port 8445...
echo ===================================================
call npm run dev
