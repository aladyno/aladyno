' Hidden launcher for the omh-sec-directive scheduled task.
' Runs the PowerShell script with NO visible console window (window style 0),
' so nothing pops up that could be accidentally closed (which would send
' CTRL_CLOSE and kill the run mid-way).
' Stays in the interactive user session so MCP_DOCKER (Jira + Gmail) works.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\run-sec-directive.ps1""", 0, True
