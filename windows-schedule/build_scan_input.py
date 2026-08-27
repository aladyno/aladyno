# -*- coding: utf-8 -*-
"""Normalize JQL results into sec-scan-input.json (new issues) and list issues needing comment fetch."""
import json, sys, io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

CREATED_FILE = sys.argv[1]
UPDATED_FILE = sys.argv[2]
OUT_FILE = r"C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\sec-scan-input.json"
SINCE = datetime.fromisoformat("2026-07-03T09:10:01+07:00")
NOW = datetime.fromisoformat("2026-07-06T09:10:03+07:00")

def parse_ts(s):
    # Jira format: 2026-07-03T10:22:33.000+0700
    if s is None:
        return None
    s = s.strip()
    if len(s) >= 5 and (s[-5] in "+-") and ":" not in s[-5:]:
        s = s[:-2] + ":" + s[-2:]
    return datetime.fromisoformat(s)

items = []
with open(CREATED_FILE, encoding="utf-8") as f:
    created_data = json.load(f)

for iss in created_data.get("issues", []):
    fl = iss.get("fields", {})
    created = parse_ts(fl.get("created"))
    if created is None or created < SINCE or created > NOW:
        continue
    itype = (fl.get("issuetype") or {}).get("name", "") or ""
    is_sub = (fl.get("issuetype") or {}).get("subtask", False)
    desc = fl.get("description") or ""
    if not isinstance(desc, str):
        desc = json.dumps(desc, ensure_ascii=False)
    creator = (fl.get("creator") or {}).get("displayName", "?")
    items.append({
        "type": "subtask" if is_sub else "task",
        "key": iss["key"],
        "id": iss["id"],
        "author": creator,
        "created": fl.get("created"),
        "url": f"https://ohmyjira.atlassian.net/browse/{iss['key']}",
        "text": (fl.get("summary") or "") + "\n" + desc,
    })

with open(UPDATED_FILE, encoding="utf-8") as f:
    updated_data = json.load(f)

updated_keys = []
for iss in updated_data.get("issues", []):
    fl = iss.get("fields", {})
    upd = parse_ts(fl.get("updated"))
    if upd is None or upd < SINCE:
        continue
    updated_keys.append(iss["key"])

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=1)

print(json.dumps({
    "new_issue_items": len(items),
    "new_issue_keys": [i["key"] for i in items],
    "updated_issue_count": len(updated_keys),
    "updated_keys": updated_keys,
}, ensure_ascii=False, indent=1))
