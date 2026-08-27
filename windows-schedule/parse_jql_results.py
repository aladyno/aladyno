# -*- coding: utf-8 -*-
"""Parse saved JQL results for omh-sec-directive run.
Outputs:
  - sec-scan-input.json : normalized items from newly CREATED issues (tasks/subtasks)
  - updated-keys.json   : list of issue keys with updated >= SINCE (candidates for new comments)
"""
import json, sys, io
from datetime import datetime, timezone, timedelta

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

CREATED_FILE = sys.argv[1]
UPDATED_FILE = sys.argv[2]
OUT_ITEMS = r"C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\sec-scan-input.json"
OUT_KEYS = r"C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\updated-keys.json"

SINCE = datetime.fromisoformat("2026-07-06T09:10:03+07:00")

def parse_jira_dt(s):
    # Jira: 2026-07-02T10:15:30.123+0700
    if s is None:
        return None
    s = s.strip()
    if s[-5] in "+-" and s[-3] != ":":
        s = s[:-2] + ":" + s[-2:]
    return datetime.fromisoformat(s)

def desc_to_text(d):
    if d is None:
        return ""
    if isinstance(d, str):
        return d
    # ADF fallback: walk nodes collecting text
    out = []
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text" and "text" in n:
                out.append(n["text"])
            for c in n.get("content", []) or []:
                walk(c)
            if n.get("type") in ("paragraph", "heading", "codeBlock", "listItem"):
                out.append("\n")
        elif isinstance(n, list):
            for c in n:
                walk(c)
    walk(d)
    return "".join(out)

with open(CREATED_FILE, encoding="utf-8") as f:
    created_data = json.load(f)

items = []
for iss in created_data.get("issues", []):
    fl = iss.get("fields", {})
    created = parse_jira_dt(fl.get("created"))
    if created is None or created < SINCE:
        continue
    itype = (fl.get("issuetype") or {}).get("name", "")
    is_sub = (fl.get("issuetype") or {}).get("subtask", False) or itype.lower() in ("sub-task", "subtask")
    creator = (fl.get("creator") or {}).get("displayName") or (fl.get("reporter") or {}).get("displayName") or "?"
    text = (fl.get("summary") or "") + "\n" + desc_to_text(fl.get("description"))
    items.append({
        "type": "subtask" if is_sub else "task",
        "key": iss["key"],
        "id": iss["id"],
        "author": creator,
        "created": created.isoformat(),
        "url": f"https://ohmyjira.atlassian.net/browse/{iss['key']}",
        "text": text,
    })

with open(UPDATED_FILE, encoding="utf-8") as f:
    updated_data = json.load(f)

keys = []
for iss in updated_data.get("issues", []):
    fl = iss.get("fields", {})
    upd = parse_jira_dt(fl.get("updated"))
    if upd is not None and upd >= SINCE:
        keys.append(iss["key"])

with open(OUT_ITEMS, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=1)
with open(OUT_KEYS, "w", encoding="utf-8") as f:
    json.dump(keys, f, ensure_ascii=False)

print(json.dumps({
    "created_issues_total": len(created_data.get("issues", [])),
    "new_items": len(items),
    "new_item_keys": [i["key"] for i in items],
    "updated_issues_total": len(updated_data.get("issues", [])),
    "updated_keys_count": len(keys),
    "updated_keys": keys,
}, ensure_ascii=False, indent=1))
