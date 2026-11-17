@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instaluji zavislosti...
  call npm install --no-audit --no-fund || goto :err
)

set "DO="
set /p DO="Do kdy pocitat (napr. 2026-11-17 13:50, Enter = vse): "
if defined DO goto :withdate
node count-chests.js %*
goto :end

:withdate
node count-chests.js %* --do "%DO%"

:end
pause
exit /b

:err
echo Instalace selhala. Mas nainstalovany Node.js? https://nodejs.org
pause
