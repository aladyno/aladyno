Run the `omh-sec-directive` skill headlessly. This is an automated, non-interactive run — never ask questions, complete every step.

Scan window:
- SINCE = {{SINCE}}   (ISO 8601; only Jira items created at/after this moment count)
- NOW   = {{NOW}}     (ISO 8601; this run's reference time)

Instructions:
1. Invoke the Skill `omh-sec-directive`.
2. Use SINCE/NOW above as the scan window (do NOT recompute a default — use these exact values).
3. Scan newly created tasks, sub-tasks, and comments in projects OMH and ELS via the non-cloud Atlassian MCP (`mcp__MCP_DOCKER__*`).
4. Run the local scanner `scan_jira_secrets.py`. Never print any real secret value — masked excerpts only.
5. If there are findings, send the HTML alert email to dung.dt@ohmyhotel.com via `mcp__MCP_DOCKER__sendMessage`. If there are none, send NO email.
6. As the very last line of output, print exactly: `WATERMARK {{NOW}}` so the scheduler can advance its state.

Keep going to completion without confirmation.
