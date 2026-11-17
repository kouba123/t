@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instaluji zavislosti...
  call npm install --no-audit --no-fund || goto :err
)
if not "%~1"=="" goto :withargs

set "DO="
set /p DO="Do kdy pocitat (napr. 2026-11-17 13:50, Enter = vse): "
if defined DO goto :withdate
node count-chests.js
goto :end

:withdate
node count-chests.js --do "%DO%"
goto :end

:withargs
node count-chests.js %*

:end
pause
exit /b

:err
echo Instalace selhala. Mas nainstalovany Node.js? https://nodejs.org
pause
