# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two things live together in this repo:

1. **A store of generated daily stock-market reports** ("Uptrend Scan") for the Vietnamese equity market (HOSE + HNX) — `stox-daily/data/`.
2. **The Claude Code skills, agents, and Windows pipeline** that produce those reports (and cover broader VN stock-market analysis) — `.claude/skills/`, `.claude/agents/`, `windows-schedule/`.

There is no application code, build system, package manager, or test suite. "Development" here means editing prompt files (`.claude/skills/*/SKILL.md`, `.claude/agents/*.md`), the daily-report prompt/templates, and the PowerShell scheduler script.

## Structure

```
stox-daily/
  data/
    manifest.json                  # JSON index: {"files": [ ...report filenames... ]}
    uptrend-scan-YYYY-MM-DD.html   # one report per trading day

.claude/
  agents/                          # project-local agents (WebSearch/WebFetch/Read/Write/email scoped)
  skills/                          # thin entry points that delegate to agents

windows-schedule/
  run-hidden-stock.vbs             # hidden-window launcher invoked by the Windows Scheduled Task
  run-daily-report-stock.ps1       # orchestrator: runs the scan, writes the report + manifest, commits + pushes
  daily-report-stock-prompt.md     # prompt template ({{DATE}} placeholder) fed to headless `claude -p`
  reports/                         # daily dashboard copies produced by the pipeline
```

## Architecture: skill → agent delegation

Skills in `.claude/skills/` are thin **entry points** (trigger phrases + expected output contract). The actual work is delegated to project-local agents in `.claude/agents/`, which are limited to `WebSearch`/`WebFetch` (plus `Read`/`Write`/email for the scanner):

| Skill (entry point) | Delegates to agent | Scope |
|---|---|---|
| `stock-analyze` | `vn-equity-analyst` | Deep dive on ONE ticker (smart money, technicals, decision matrix) |
| `stock-screen` | `vn-equity-screener` | Market-wide screening by criteria set |
| `stock-news` | `vn-market-news` | 24h news scan + price-impact scoring for a ticker/sector |
| `stock-value` | `vn-valuation-analyst` | Valuation (comps + DCF/RIM, fair-value range) |
| `stock-dd` | all 4 above, **fanned out in parallel** | Full due diligence on one ticker, synthesized into one report |

`vn-uptrend-scanner` is a self-contained agent (no skill wrapper) used by the daily pipeline: scans 2 weeks of HOSE+HNX price/volume for Stage-2 breakout candidates, builds the HTML report, saves it, and sends the email itself. `stock-discover-agent` and `stock-news-analyzer` are earlier standalone variants of the screener/news agents. `aladyn-stx` and `stock-analysis` (US stocks/crypto, Python scripts run via `uv run`) are older standalone skills.

Shared conventions all skills/agents enforce — preserve them when editing:
- Bilingual Vietnamese-English output; capital preservation over returns.
- Never invent numbers: every figure needs a source URL + timestamp, otherwise "N/A — cần xác minh".
- Trade recommendations must include absolute entry/stoploss/target with reward:risk ≥ 2:1.

## Daily report pipeline (windows-schedule/)

A Windows Scheduled Task (name `aladyn_daily-report-stock`, 09:00 daily) drives this chain:

1. `run-hidden-stock.vbs` — launches PowerShell with a hidden window. This matters: a visible console that gets closed sends CTRL_CLOSE (task dies with 0xC000013A), and the task must run in the interactive user session for MCP_DOCKER (Gmail) to work.
2. `run-daily-report-stock.ps1` — fills `{{DATE}}` into `daily-report-stock-prompt.md`, pipes it via stdin to headless `claude -p` with a fixed `--allowedTools` list (Task, WebSearch/WebFetch, Read/Write, `mcp__MCP_DOCKER__sendMessage`…).
3. The prompt is an orchestrator that spawns `vn-uptrend-scanner`, which emails the report (template `msg_daily_report.html` — static fill, **no JS**) and saves a dashboard copy (template `msg_daily_report_dashboard.html`) to `windows-schedule/reports/uptrend-scan-YYYY-MM-DD.html`.
4. The script then copies today's report into `stox-daily/data/` (same repo), updates its `manifest.json`, and commits + pushes — staging only today's report file + manifest so it never accidentally picks up unrelated changes.

Run the pipeline manually:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows-schedule\run-daily-report-stock.ps1
```

When changing the headless run's tool usage, remember there is no interactive permission prompt — any new tool an agent needs must be added to `$allowed` in the .ps1.

## Conventions when adding or editing reports

- **File naming**: `uptrend-scan-YYYY-MM-DD.html`, dated by report day (trading days only — gaps in the sequence are expected for non-trading days).
- **Manifest must stay in sync**: whenever a report file is added, append its filename to the `files` array in `stox-daily/data/manifest.json`. The manifest is what consumers use to discover reports.
- **Reports are fully self-contained**: all CSS is inlined in a `<style>` block in `<head>`; no external scripts, stylesheets, fonts, or network requests. Keep new reports the same way.
- **Language**: report content is Vietnamese (`<html lang="vi">`); section data cites sources (cafef.vn, vietstock.vn, vneconomy.vn, etc.) with a confidence level per claim.
- **Report layout** (match the existing files — copy the most recent report as the template for a new day):
  - Header: title `UPTREND SCAN · HOSE+HNX` + report date and 2-week scan window
  - Summary widgets (4): Market Regime, scan result count, suggested allocation, market breadth
  - Section: macro/sector outlook (`#view-macro`) with per-item confidence + sources
  - Section: potential stock picks (`#view-potential`) with catalyst / technicals / key risk per ticker
  - Section: action principles (`#view-principle`, alert box)
  - Section: eliminated tickers with reasons (`#view-eliminated`) — anti-FOMO list
  - Footer: data-source list and the disclaimer "Báo cáo tự động — không phải khuyến nghị đầu tư" (automated report, not investment advice). Always keep this disclaimer.
- Content elements carry `id="view-*"` attributes (e.g. `view-regime`, `view-passed`, `view-date`) — preserve these IDs so any consumer that extracts fields by ID keeps working.
- Scan scope is HOSE + HNX only; UPCOM-listed tickers are explicitly excluded (listed under eliminated with that reason).
