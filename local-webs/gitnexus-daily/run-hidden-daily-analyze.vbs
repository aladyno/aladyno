' Chạy daily-analyze.ps1 ẩn (không hiện cửa sổ console)
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = dir
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "daily-analyze.ps1""", 0, False
