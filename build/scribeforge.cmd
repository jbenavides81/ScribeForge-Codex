@echo off
rem ScribeForge from the command line. Type "scribeforge help" for the commands.
rem It runs ScribeForge.exe (in this folder) and waits for it, so the exit code comes back here.
"%~dp0ScribeForge.exe" --cli %*
exit /b %ERRORLEVEL%
