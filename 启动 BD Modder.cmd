@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm >nul 2>&1
if errorlevel 1 goto missing_npm

if not exist "node_modules\electron\dist\electron.exe" goto install_dependencies
if not exist "node_modules\.bin\esbuild.cmd" goto install_dependencies
goto build

:install_dependencies
echo Installing project dependencies...
call npm ci
if errorlevel 1 goto failed

:build
echo Building the renderer...
call npm run build
if errorlevel 1 goto failed

echo Starting BD Modder development version...
call npm start
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js was not found. Install Node.js and try again.
goto failed

:missing_npm
echo npm was not found. Check your Node.js installation and PATH.
goto failed

:failed
echo.
echo BD Modder failed to start. Check the error above.
pause
exit /b 1
