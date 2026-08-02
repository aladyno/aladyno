' Hidden launcher for daily-report-stock.
' Runs the PowerShell script with NO visible console window (window style 0),
' so nothing pops up that could be accidentally closed (which would send
' CTRL_CLOSE / 0xC000013A and kill the run mid-way).
' Stays in the interactive user session so MCP_DOCKER (Gmail) works.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\dzung\Workspace\Github\aladyno\windows-schedule\run-daily-report-stock.ps1""", 0, True
