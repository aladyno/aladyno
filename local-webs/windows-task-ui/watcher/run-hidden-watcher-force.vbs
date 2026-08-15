' Chạy watcher --force ẩn (dùng cho nút "Chạy ngay" trên UI)
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = dir
sh.Run """C:\Program Files\nodejs\node.exe"" """ & dir & "watcher.cjs"" --force", 0, False
