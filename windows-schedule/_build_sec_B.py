# -*- coding: utf-8 -*-
import json, datetime

TR = r"C:\Users\dzung\.claude\projects\C--Users-dzung-Workspace-Ohmyhotel\777af7a2-79eb-4baa-ac3f-8db0b37bcab7\tool-results"
SINCE = datetime.datetime.fromisoformat("2026-06-29T02:10:04+00:00")

def keep(created):
    dt = datetime.datetime.fromisoformat(created)
    return dt.astimezone(datetime.timezone.utc) >= SINCE

def url(key, cid):
    return "https://ohmyjira.atlassian.net/browse/%s?focusedCommentId=%s" % (key, cid)

items = []

def add_from_comments(key, comments):
    for c in comments:
        if keep(c["created"]):
            items.append({
                "type": "comment",
                "key": key,
                "id": c["id"],
                "author": c["author"]["displayName"],
                "created": c["created"],
                "url": url(key, c["id"]),
                "text": c["body"],
            })

# ---- large issues read verbatim from disk ----
# ELS-1313 (concatenated text blocks json)
d = json.load(open(TR + r"\toolu_014E76tMUSVC76Xc1yco38bG.json", encoding="utf-8"))
txt = "".join(b.get("text", "") for b in d if isinstance(b, dict))
obj = json.loads(txt)
add_from_comments("ELS-1313", obj["fields"]["comment"]["comments"])

# ELS-2122
obj = json.load(open(TR + r"\mcp-MCP_DOCKER-getJiraIssue-1782785899180.txt", encoding="utf-8"))
add_from_comments("ELS-2122", obj["fields"]["comment"]["comments"])

# ---- inline issues: verbatim bodies embedded ----
INLINE = {
 "ELS-2314": [("18508","Mon","2026-06-29T16:15:42.567+0900",
  "Dear <custom data-type=\"mention\" data-id=\"id-0\">@Harry</custom> ,\n\nPlease help me check my solution for this task and choose one\n\nI think the better we should have an mini meeting\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=aaee81f7-2085-4265-981e-384ffba6676c&&collection=&height=null&occurrenceKey=null&width=null&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)Because the action route from Google into us I don’t know the traffic, but for carefully, we shouldn’t write direct to table BS_VENDOR_TRANSACTION_LOG\n\nMy solution is write to Redis first and have batch every 5 minute pull into that table\n\nThank you\n\nCC: <custom data-type=\"mention\" data-id=\"id-1\">@Joseph</custom> , <custom data-type=\"mention\" data-id=\"id-2\">@Dan</custom> , <custom data-type=\"mention\" data-id=\"id-3\">@Joo</custom> ")],
 "ELS-2241": [("18509","Daniel","2026-06-29T16:16:16.649+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Tracy</custom>  \nI updated, please check again.")],
 "ELS-1427": [("18511","Tracy","2026-06-29T16:27:31.530+0900",
  "checked\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=71c530d7-19d6-4d90-8d9f-d5736737fac9&&collection=&height=991&occurrenceKey=null&width=1458&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=55d747d7-f3ec-447a-b8a6-5e415f5755c4&&collection=&height=1015&occurrenceKey=null&width=1648&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2201": [("18517","Tom","2026-06-29T16:43:16.404+0900",
  "PR opened (oh-api → master): https://github.com/ohmyhotelco/oh-api/pull/865\n\n**Fix:** Added a `SELECT ... FOR UPDATE` row lock on the requested booking items before the duplicate guard in `mergeAdminSettlementInvoice`, so concurrent double-submit / timeout-retry requests serialize and the second one is rejected instead of creating a duplicate invoice (root cause of duplicate billing nos. 768500 & 768501 in ELS-2202).\n\n**Also cherry-picked to** `develop` and `staging`.\n\n**Tests:** 3 unit + 1 integration (FOR UPDATE concurrency) — all passing. Risk: Medium.")],
 "OMH-696": [("18522","Mon","2026-06-29T17:27:15.512+0900",
  "Dear <custom data-type=\"mention\" data-id=\"id-0\">@Holden</custom> ,\n\nWith the case two space character on Dev env by picture below:\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=42cccb8f-57a8-4969-a4d4-95032d7886d2&&collection=&height=1031&occurrenceKey=null&width=1651&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=dbe2e861-2df0-4cd3-8928-d6e7c5c82997&&collection=&height=null&occurrenceKey=null&width=null&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)With all the hotel search, we follow data Hotel Search Name, not just Hotel Name by the Language hotel Avanti Boutique Hotel  \n  \nI found one the bug come from our generate hotelNameSearchLn we generate from the collect all infor hotel name language and this case have the space on the last character so after collect we have the two space character\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=2d0cf5db-b585-40b8-9123-a9232ab04ab9&&collection=&height=955&occurrenceKey=null&width=1561&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\nThe solution for that case, I will update the collect func with clear all the space on the first or last character inside hotelNameByLanguage before collect into hotelNameSearchLn\n\nThank you")],
 "OMH-700": [("18530","Mon","2026-06-29T17:58:43.279+0900",
  "Dear <custom data-type=\"mention\" data-id=\"id-0\">@Holden</custom> ,\n\nThe main reason come from api hotel search response wrong info\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=8f562530-c71e-4ae1-8730-77762b05c122&&collection=&height=97&occurrenceKey=null&width=657&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\nSo, that’s exactly bug, we have to be return all for case USD currency\n\nI will update and let you know later after finish on any env\n\nThank you")],
 "ELS-2302": [("18532","Daniel","2026-06-29T18:12:10.832+0900",
  "Dear <custom data-type=\"mention\" data-id=\"id-0\">@Tracy</custom> ,  \n**Root Cause:** The email delivery status received from AWS SES indicated success.\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=e108cb85-a123-4582-9b7a-0d57f749b190&&collection=&height=162&occurrenceKey=null&width=1332&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n**Action Taken:** Because the user did not receive the email, I switched the implementation to use the Mailjet service for email delivery.  \n**Prevention:** Monitor the email delivery status, and if emails are still not being received, fall back to the SendGrid service.")],
 "OMH-659": [("18533","Justin","2026-06-29T18:22:38.405+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Harry</custom> PR is up for review. OMH-659 foundation shipped: @omh/shared-ui — brand (BrandProvider + OMH/Hana tokens), 12 shadcn v4 primitives, and the user-count domain sample (extracted from legacy Angular via the migration plugin's /fm-extract with strict TDD). 39 unit tests + the web-pc build are green; the built CSS carries the brand tokens (#ef7f29 OMH / #009178 Hana via \\[data-brand\\]).\n\nPR #72 (draft): [https://github.com/ohmyhotelco/ohmyhotel-monorepo/pull/72](https://github.com/ohmyhotelco/ohmyhotel-monorepo/pull/72)\n\nQuality: 3 rounds of dual independent review (Codex + the plugin's quality-reviewer) converged ship-ready (quality-reviewer 4.8/5; Codex SHIP) — findings fixed, reports committed under docs/migration/pc/user-count/.\n\nScope vs the ticket: this PR delivers the FOUNDATION + the user-count sample and meets the acceptance (builds; primitives render in web-pc; BrandProvider scaffolded). The remaining domain/ components listed in scope (major-city-list, city-autocomplete, hotel/room cards — they depend on shared-data query hooks) ship as incremental follow-up PRs; user-count's co-located types/limits/i18n graduate to shared-types/shared-domain/shared-i18n when the hotel-room funnel migrates (see packages/shared-ui/RECONCILE.md). Tailwind v4 was chosen over the plan doc's v3 (CSS-first @theme fits the brand-token design; plan §5 updated). A few web-pc files overlap OMH-653 (in review) — whichever merges second rebases (trivial).")],
 "ELS-2277": [("18474","Daniel","2026-06-29T12:01:19.940+0900",
  "Hi <custom data-type=\"mention\" data-id=\"id-0\">@Tracy</custom> ,  \nBillingNo: 770151")],
 "OMH-342": [("18457","Lexi","2026-06-29T09:34:27.896+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Joseph</custom> Technical review for this project has been completed. Please assign owners for the actual development work, and have them review the OMH-342 description and the spec (HTML file) to create the necessary subtasks. Thank you."),
  ("18476","Joseph","2026-06-29T12:08:44.390+0900",
  "Dear <custom data-type=\"mention\" data-id=\"id-0\">@Lexi</custom> we’re checking and separating tasks for this. Thank you")],
 "OMH-680": [("18466","Lexi","2026-06-29T10:43:18.099+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Mon</custom> Please update the estimated duration and due date of this task. If the progress of this task is delayed due to other work you are handling, please be sure to share it with me. Thank you."),
  ("18479","Mon","2026-06-29T12:25:04.998+0900",
  "Hi <custom data-type=\"mention\" data-id=\"id-0\">@Lexi</custom> ,\n\nI'm sorry by my late, I will update after finish investigate & understand clearly this requirement ticket\n\nThank you")],
 "ELS-2154": [("18482","Tracy","2026-06-29T12:30:04.556+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Daniel</custom> Checked.  \nThx")],
 "ELS-2217": [("18485","Daniel","2026-06-29T13:45:49.456+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Joo</custom> Fixed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=cdcd81c2-f1d6-4d57-a417-d8d548e81317&&collection=&height=800&occurrenceKey=null&width=792&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2315": [("18490","Daniel","2026-06-29T14:44:03.734+0900",
  "![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=e5407d56-3cb8-4d6d-a749-0bf8651cf2c2&&collection=&height=null&occurrenceKey=null&width=null&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=962adbd0-4f17-4d50-a79c-e630dde78926&&collection=&height=null&occurrenceKey=null&width=null&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)‌")],
 "ELS-2232": [("18492","Tracy2","2026-06-29T15:29:17.468+0900",
  "tested on STG => passed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=9867e19b-315d-40b5-9ccd-58aaa0d3703b&&collection=&height=1032&occurrenceKey=null&width=1920&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2038": [("18497","Harry","2026-06-29T15:38:19.240+0900",
  "![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=d6444690-9a48-4ca5-ae16-042a6dc82090&&collection=&height=347&occurrenceKey=null&width=719&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n<custom data-type=\"mention\" data-id=\"id-0\">@Joseph</custom>   \nmapping domain has been work")],
 "ELS-2228": [("18498","Tracy2","2026-06-29T15:45:42.680+0900",
  "Tested on STG => passed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=c9bbb73b-ee05-4d16-bfae-7a7b2a03f370&&collection=&height=310&occurrenceKey=null&width=436&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2230": [("18499","Tracy2","2026-06-29T15:48:19.220+0900",
  "Tested on STG => passed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=bb7cce23-7f70-4bc4-890d-368049f52f08&&collection=&height=1032&occurrenceKey=null&width=1920&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2311": [("18500","Tom","2026-06-29T15:48:52.761+0900",
  "## \U0001f50d Investigation Report — Root Cause Found\n\n### Reproduction\n\nReproduced on staging (`test-admapi.ohmyhotel.com`) with a minimal search — `POST /admin/hotel/code-mapping`, body `{\"condition\":{\"countryCode\":\"JP\",\"limits\":[0,20], ...}}` (no text filter). A **single** request already takes minutes; firing it 3+ times consecutively exhausts the DB pool and the Web API becomes unresponsive.\n\n### Root cause (measured against staging DB)\n\nThe search query's `HO_HOTEL_MASTER` UNION branch contains:\n\n```sql\nAND NOT EXISTS (SELECT 1 FROM VM WHERE VM.VENDOR_COMP_CODE = UCM.COMP_CODE)\n```\n\nwhere `UCM.COMP_CODE` is the constant `110000`. MySQL does **not** materialize the `VM` CTE — it **re-executes the \\~150K-row CTE for every candidate \\`HO_HOTEL_MASTER\\` row (\\~23,070 rows)**.\n\n| Measurement (staging) | Result |\n| --- | --- |\n| `VD_VENDOR_HOTEL_MASTER` total rows | 3,935,034 |\n| JP active rows | 150,677 |\n| **Full search query (JP)** | **\\~191,855 ms (\\~3.2 min)** |\n| VM (vendor) branch alone | \\~3,046 ms |\n| ⇒ cost from the `HO_HOTEL_MASTER` NOT EXISTS | **\\~188 s** |\n| `EXPLAIN` top derived table | `type: ALL`, `rows: 102242`, **Using filesort** |\n\n### Why it \"freezes\" with no error logs\n\n* 1 request ≈ 3 min holding 1 of only **10** HikariCP connections (`maximum-pool-size: 10`).\n* Search button on the FE was **not disabled** during the request → users click repeatedly → duplicate concurrent heavy requests.\n* A few concurrent calls exhaust the pool; further requests block up to `connection-timeout: 60000` (60s) → the API looks frozen. Because requests are **waiting** (not erroring), **no exception is logged**.\n\n### Secondary contributors (also slow, fixed in ELS-2312)\n\n* `COUNT(*) OVER()` forces full materialization before `LIMIT`.\n* `ORDER BY` over a derived/union table ⇒ filesort of the whole set; sort key not unique → unstable paging.\n* Text search built **N! word-permutation REGEXP** for `hotelName`/`addressEn` (6 words = 720 patterns) → full scan, exponential.\n\n### Conclusion\n\nNot an infrastructure issue and **not** Reactor event-loop blocking (ELS-1980 already moved blocking MyBatis off the event loop). It is **SQL query cost (per-row CTE re-execution) + connection-pool exhaustion under duplicate concurrent requests**.\n\n➡️ Fix tracked and implemented in **ELS-2312**.")],
 "ELS-2231": [("18502","Tracy2","2026-06-29T15:49:52.375+0900",
  "Tested on STg => passed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=be81ff44-0152-421a-89a8-2355fb72833f&&collection=&height=1032&occurrenceKey=null&width=1920&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "ELS-2229": [("18503","Tracy2","2026-06-29T15:50:49.619+0900",
  "Tested on STG => passed\n\n![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=3c1ac920-a032-436b-9eeb-128157cae6a5&&collection=&height=731&occurrenceKey=null&width=893&__contextId=null&__displayType=null&__external=false&__fileMimeType=null&__fileName=null&__fileSize=null&__mediaTraceId=null&url=null)\n")],
 "OMH-653": [("18504","Justin","2026-06-29T15:54:01.328+0900",
  "<custom data-type=\"mention\" data-id=\"id-0\">@Harry</custom> PR is up for review — the web-pc test harness (Playwright + Vitest/MSW + ESLint/Prettier + Phase 1 legacy visual baselines + CI). dev-ci is green.\n\nPR #71: [https://github.com/ohmyhotelco/ohmyhotel-monorepo/pull/71](https://github.com/ohmyhotelco/ohmyhotel-monorepo/pull/71)\n\nTwo things worth knowing for review: (1) web-pc-e2e.yml (Playwright + visual) is workflow_dispatch-only — it does NOT auto-run on PR or merge; it only becomes dispatchable once on master. (2) Visual baselines are per-arch; the linux-arm64 bucket is committed (captured locally), and the linux-x64 bucket CI verifies against is captured post-merge via the e2e dispatch.")],
}

for key, lst in INLINE.items():
    for cid, author, created, body in lst:
        if keep(created):
            items.append({
                "type": "comment", "key": key, "id": cid, "author": author,
                "created": created, "url": url(key, cid), "text": body,
            })

out = r"C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\sec-scan-comments-B.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
print("WROTE", len(items), "items")
