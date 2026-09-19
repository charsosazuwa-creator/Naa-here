@echo off
echo Starting the Naa here demo...
echo This window will show live server logs - including verification codes
echo during sign-up, since the mock email/SMS sender just logs them here.
echo.
cd /d "%~dp0launcher"
node start.js
pause
