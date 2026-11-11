@echo off
setlocal
set "D=%APPDATA%\@deepseek-ai\dsh-desktop\desktop"
echo ================================================
echo   DSH cookie autoclean - status and log
echo ================================================
echo.
echo [status file] %D%\dsh-cookie-autoclean.json
type "%D%\dsh-cookie-autoclean.json" 2>nul
if errorlevel 1 echo   file not found yet
echo.
echo [log, last 40 lines] %D%\dsh-cookie-autoclean.log
powershell -NoProfile -Command "Get-Content '%D%\dsh-cookie-autoclean.log' -Tail 40 -Encoding utf8" 2>nul
echo.
echo [backup files]
dir /b "%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies.bak-*" 2>nul
echo.
pause
