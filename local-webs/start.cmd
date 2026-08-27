@echo off
title Windows Task Scheduler UI
echo Starting Task Scheduler UI on http://127.0.0.1:4321 ...
start "" http://127.0.0.1:4321
node "%~dp0server.cjs"
