' Chạy aladyn_jira_epic_notifier ẩn (không hiện cửa sổ console)
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = dir
sh.Run """node.exe"" """ & dir & "notifier.cjs""", 0, False
