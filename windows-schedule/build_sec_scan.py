# -*- coding: utf-8 -*-
import json, datetime

SINCE = datetime.datetime.fromisoformat("2026-06-29T11:10:04+09:00")

def C(key, cid, author, created, text):
    return {
        "type": "comment", "key": key, "id": cid, "author": author,
        "created": created,
        "url": f"https://ohmyjira.atlassian.net/browse/{key}?focusedCommentId={cid}",
        "text": text,
    }

raw = [
    C("ELS-2224","18558","Tan","2026-06-30T11:00:14.723+0900","@Tracy2 Please help me test on STG. Thanks!"),
    C("ELS-1700","18557","Dan","2026-06-30T10:59:23.973+0900","@Tracy2 Please verify again. Thanks!"),
    C("ELS-2328","18537","Tan","2026-06-29T19:30:34.159+0900","Deployment Report 2026-06-29 (PRs merged to master; bug fixes + improvements; deploy list of services; contributors; highlights)."),
    C("ELS-2326","18555","Dan","2026-06-30T10:45:25.771+0900","Dear @Naoki @Tracy The fix for this issue has been deployed to the production environment."),
    C("OMH-661","18540","Justin","2026-06-30T09:59:49.743+0900","OMH-661 (TanStack Query provider + SSR hydration) implemented and moved to In Review (PR #73, draft, base master); delivered/verified/deferred details."),
    C("OMH-661","18541","Justin","2026-06-30T10:12:58.297+0900","Independent review round (codex + quality-reviewer); fixes applied in commit (resolveEnvironment mapping, test forward-protection, devtools pin, docs)."),
    C("OMH-661","18545","Justin","2026-06-30T10:22:54.545+0900","Review round 2; fixed resolveEnvironment test-mode and root.tsx comment; deferred peerDependency to OMH-657 and ErrorBoundary to OMH-660."),
    C("OMH-661","18550","Justin","2026-06-30T10:32:06.717+0900","Review round 3; quality-reviewer 5/5 ship; strengthened api-client test to be observable; cross-ticket follow-ups noted."),
    C("OMH-661","18553","Justin","2026-06-30T10:41:45.434+0900","@Harry PR #73 now ready for review (un-drafted); converged over 3 rounds; residuals deferred to OMH-657 / OMH-660."),
    C("OMH-657","18552","Justin","2026-06-30T10:37:44.482+0900","Follow-up from OMH-661 review: promote @tanstack/react-query to a peerDependency in shared-data; rationale on single react-query instance/context."),
    C("ELS-2293","18521","Harry","2026-06-29T17:22:55.416+0900","domain: partners-api.ohmyhotel.com; @Tom add API on FE and add backend security check."),
    C("ELS-2293","18534","Tom","2026-06-29T18:38:42.915+0900","Endpoint list (oh-partners FE) vs BE (oh-api); 7 prefix groups; base URL change to partners-api; routing/security implications."),
    C("ELS-2293","18549","Tom","2026-06-30T10:31:31.161+0900","Auth Filter (screenshot)."),
    C("ELS-2293","18551","Tom","2026-06-30T10:34:50.622+0900","Login (screenshot)."),
    C("ELS-2272","18470","Calvin","2026-06-29T11:17:06.977+0900","@Roy Understood. I'll start working on it now."),
    C("ELS-2272","18486","Roy","2026-06-29T13:45:54.098+0900","@Calvin If it is confirmed that V2-V8 are definitely not being used, please leave a comment."),
    C("ELS-2272","18489","Calvin","2026-06-29T14:03:02.801+0900","@Roy Confirmed. Codebase only references OPEN_API_SEARCH_HOTEL_CONTENTS_V9; no remaining references to V2-V8."),
    C("ELS-2272","18493","Calvin","2026-06-29T15:30:04.727+0900","Finished implementing the cleanup utility for V2-V8 keys; conservative SCAN/UNLINK params; tested on DEV and STAGING Redis; memory metrics and timings."),
    C("ELS-2272","18535","Calvin","2026-06-29T18:41:12.094+0900","@Roy As discussed, this will increase the batch UNLINK delay from 100ms to 300ms."),
    C("ELS-2235","18548","Calvin","2026-06-30T10:30:53.306+0900","@Roy Deployment for removing dual-write and fallback authentication logic completed; logs reviewed, no issues found."),
    C("ELS-1990","18547","Tan","2026-06-30T10:30:42.191+0900","@Tracy @Tracy2 please help me check on PRD. Thanks!"),
    C("OMH-678","18526","Harry","2026-06-29T17:42:25.625+0900","Scope confirmation questions before creating subtasks for 'B. Product Amt' calculation logic (room search only, terminology, stored-data scenario)."),
    C("OMH-678","18539","Lexi","2026-06-30T09:55:24.995+0900","@Harry answers on scope: B2C room search results only; B. Product Amt = B. Net Amt + B. M/U Amt; booking detail direction to be confirmed with Julia."),
    C("OMH-678","18546","Harry","2026-06-30T10:25:55.823+0900","Hi @Lexi Thank you for confirm."),
    C("ELS-2316","18514","Tom","2026-06-29T16:39:29.154+0900","Fixed + verified QA issue: City dropdown not showing city names; root cause field mapping; verified on DEV."),
    C("ELS-2316","18544","Tracy2","2026-06-30T10:22:07.684+0900","@Tom tested on STG => passed (screenshots)."),
    C("ELS-2291","18481","Harry","2026-06-29T12:28:57.593+0900","partners-api.ohmyhotel.com; @Joseph domain partner."),
    C("ELS-2317","18515","Tom","2026-06-29T16:39:34.422+0900","Fixed + verified QA issue: Region Info pop-up 'X' button now goes through discard-confirm guard; verified on DEV."),
    C("ELS-2317","18543","Tracy2","2026-06-30T10:19:38.418+0900","@Tom tested on STG => passed (screenshot)."),
    C("ELS-2299","18542","Calvin","2026-06-30T10:19:25.365+0900","The ticket was created by mistake, please ignore it."),
    C("ELS-2065","18518","Joseph","2026-06-29T16:50:44.537+0900","Amendment: dedicated TL-push DB user at Dev to enable independent rotation; provisioning steps, secret population, reload, scope/rollback."),
    C("ELS-2065","18538","Tan","2026-06-29T19:37:00.718+0900","@Joseph error: HikariPool init exception, 'Could not parse SecretString JSON' (AWS Secrets Manager JDBC driver stack trace)."),
    C("ELS-2051","18520","Joseph","2026-06-29T16:50:59.270+0900","Amendment: secret path corrections superseding omh/{env}/web-api/* paths; per-service vs shared path mapping; Spring import and IAM scope updates."),
    C("ELS-2068","18519","Joseph","2026-06-29T16:50:50.139+0900","Amendment: DB rotation test via dedicated TL-push DB user (Dev); prerequisites, rotate-secret command, verification steps, rollback."),
]

kept = []
for c in raw:
    dt = datetime.datetime.fromisoformat(c["created"])
    if dt >= SINCE:
        kept.append(c)

out_path = r"C:\Users\dzung\Workspace\Ohmyhotel\windows-schedule\sec-scan-comments-1.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(kept, f, ensure_ascii=False, indent=2)

print("TOTAL", len(kept))
for c in kept:
    print(c["key"], "|", c["author"], "|", c["created"])
