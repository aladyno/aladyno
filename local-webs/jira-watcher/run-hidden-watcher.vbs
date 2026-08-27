' Chạy aladyn_jira_watcher ẩn (không hiện cửa sổ console)
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = dir
sh.Run """node.exe"" """ & dir & "watcher.cjs""", 0, False
