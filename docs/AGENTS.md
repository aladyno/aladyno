# AGENTS.md — OhMyHotel Multi-Agent Backend System

> Build specification for Codex. This file defines a **non-linear, blackboard-based** multi-agent system that replaces the old 7-step waterfall matrix. Read the whole file before generating agents. Each agent is divided by **context domain**, not by job title.

---

## 0. Core principles (non-negotiable)

1. **Minimize static handoffs.** Every sequential agent-to-agent handoff increases entropy and dilutes the context window. Agents share state through a central **Blackboard**, not by re-serializing context into each other's prompts.
2. **Inner-loop validation > post-process inspection.** Code, test, and self-review form one atomic unit. An agent must self-test and self-correct *before* emitting output. Human/heavy review (`omh-review`, `omh-security`) are **gates**, not sequential pipeline stages.
3. **The Design Contract is immutable during implementation.** Architectural decisions (interfaces, schema, NFRs) are frozen as structured data and travel **by reference**. No agent may silently violate them; changing them requires routing back to `omh-architect`.
4. **Bounded retries.** Every repair loop has a retry budget. Exceeding it escalates to a human. No infinite handoff loops.
5. **Regression gate.** Contract/golden tests frozen by `omh-architect` must stay green after any fix. Fixing A must never break B.

---

## 1. System architecture

```
                ┌─────────────────────────────────────────┐
                │   ORCHESTRATOR  (state machine)          │
                │   error-class routing · retry budget ·   │
                │   regression gate · token budget         │
                └───────────────────┬─────────────────────┘
                                    │ dispatch / route
                ┌───────────────────▼─────────────────────┐
                │            BLACKBOARD  (shared memory)    │
                │   spec │ design_contract │ decision_log   │
                │   stored ONCE · referenced by ID          │
                └──┬────────┬────────┬────────┬────────┬────┘
                  │        │        │        │        │   read-by-ref / write-delta
            ┌─────▼──┐ ┌───▼────┐ ┌─▼──────┐ ┌▼───────┐ ┌▼────────┐
            │planner │ │architect│ │  dev   │ │review+ │ │ release │
            │        │ │ +devops │ │  pool  │ │security│ │         │
            └────────┘ └─────────┘ └───┬────┘ └────────┘ └─────────┘
                                      └──── feedback (rollback by error-class)
```

- **Blackboard**: the single source of truth. Holds `spec`, `design_contract`, `decision_log`, and per-module `artifacts`. Agents **read the minimal slice they need by reference** and **write deltas/patches** — they never paste the full spec back.
- **Orchestrator**: owns the finite state machine. It decides which agent runs next based on blackboard state and routes failures by error class. It enforces retry budget, token budget, and the regression gate.
- **Agents**: each owns one context domain and runs an internal self-correction loop where applicable.

---

## 2. Tier routing (replaces the old 7-step matrix)

The number of agents scales with task complexity. Do **not** force a sub-task through 4 agents.

| Tier | Trigger | Active agents (in order) | Notes |
|------|---------|--------------------------|-------|
| **Easy** (sub-task) | small, well-scoped change | `omh-dev` → `omh-release` | dev self-runs unit test + SAST + integrate in inner loop. No separate integrator/test agents. |
| **Normally** (task) | feature-level, one domain | `omh-architect` → `omh-dev` → `omh-release` | architect emits Design Contract (incl. data model). dev implements with inner-loop test/SAST. Review folded into dev's automated gate. |
| **Extreme** (epic) | multi-module, high risk | `omh-planner` → `omh-architect(+devops)` → `omh-dev` pool → `omh-review`+`omh-security` (parallel gate) → `omh-release` | Full blackboard orchestration. Review + Security run as a **parallel gate** reading diffs only, not as sequential steps. |

`omh-jira-spec` is the **input/trigger**, not a billed implementation agent — it only normalizes the ticket into a `spec` object on the blackboard.

---

## 3. Blackboard data contracts (JSON)

These schemas are the wire format. Agents exchange these objects (or references to them), never free-form prose dumps.

### 3.1 `spec` (written once by omh-jira-spec)
```json
{
  "spec_id": "string",
  "jira_key": "string",
  "tier": "easy | normally | extreme",
  "goal": "string",
  "acceptance_criteria": ["string"],
  "constraints": ["string"],
  "out_of_scope": ["string"]
}
```

### 3.2 `design_contract` (written by omh-architect, IMMUTABLE during implementation)
```json
{
  "contract_id": "string",
  "spec_ref": "spec_id",
  "version": 1,
  "interfaces": [{ "name": "string", "signature": "string", "idl": "string" }],
  "data_model": { "ddl": "string", "migrations": ["string"] },
  "nfr": { "latency_p99_ms": 50, "target_qps": 5000, "availability": "99.9%" },
  "invariants": ["string"],
  "frozen_tests": ["test_id"]
}
```

### 3.3 `delta_patch` (what agents WRITE back — never full restatements)
```json
{
  "by": "agent_name",
  "contract_ref": "contract_id",
  "module": "string",
  "patch": "unified_diff_or_artifact_pointer",
  "summary": "≤2 sentences"
}
```

### 3.4 `failure_report` (emitted on any test/gate failure)
```json
{
  "stage": "implement | test | review | security | release",
  "error_class": "logic | contract | performance | security | flaky | infra",
  "raw_error": "string (exact exception/message)",
  "expected": "string",
  "actual": "string",
  "contract_ref": "contract_id",
  "attempt": 1
}
```

### 3.5 `decision_log` (append-only)
```json
{ "ts": "iso8601", "by": "agent_name", "event": "string", "rationale": "string" }
```

---

## 4. Orchestrator — state machine

States: `SPEC → PLAN → ARCHITECT → IMPLEMENT → TEST → GATE → RELEASE` plus `FAILED`, `DONE`.
`PLAN` only for Extreme. `ARCHITECT` skipped for Easy. `GATE` (review+security) only for Extreme.

```python
# Pseudo-code the Codex build should turn into the orchestrator.
RETRY_BUDGET = {"logic": 3, "contract": 2, "performance": 2, "security": 2, "flaky": 2, "infra": 1}

def on_failure(report, blackboard):
    cls = report.error_class
    attempts[cls] += 1
    log(blackboard, by="orchestrator", event=f"failure:{cls}", rationale=report.raw_error)

    # --- guard rails first ---
    if attempts[cls] > RETRY_BUDGET[cls] or token_budget_exhausted(blackboard):
        return goto("FAILED", escalate_human=True)

    if cls == "flaky":
        return goto("TEST")                      # just re-run, no routing

    if cls in ("logic", "contract"):
        # backend-domain fix; contract stays immutable, passed by reference
        return goto("IMPLEMENT", payload={
            "failure_report": report,
            "contract_ref": report.contract_ref   # NFRs + invariants ride along
        })

    if cls == "performance":
        # e.g. Redis CommandTimeoutException due to high QPS
        if dev_can_fix_within_nfr(report):        # pipelining/mget, pool size,
            return goto("IMPLEMENT", scope="perf-tune", payload={  # L1 cache, circuit breaker
                "failure_report": report,
                "contract_ref": report.contract_ref
            })
        else:
            # needs new strategy/infra → amend the contract (version bump)
            return goto("ARCHITECT", payload={"failure_report": report})

    if cls == "security":
        return goto("IMPLEMENT", scope="security-fix", payload={"failure_report": report})

    if cls == "infra":
        return goto("ARCHITECT", scope="devops", payload={"failure_report": report})

def after_any_fix(blackboard):
    # REGRESSION GATE — non-negotiable
    assert run_tests(blackboard.design_contract.frozen_tests) == "GREEN", \
        "Regression: a frozen invariant broke. Reject patch, re-route to IMPLEMENT."
```

**Worked example — `Redis CommandTimeoutException due to high QPS target` at TEST (Normally tier):**
1. `omh-test` (inner loop of `omh-dev`) emits `failure_report{error_class:"performance", raw_error:"Redis CommandTimeoutException...", contract_ref:"C-123"}`.
2. Orchestrator classifies `performance`. `dev_can_fix_within_nfr` checks whether pipelining / `mget` batching / larger connection pool / local L1 cache / circuit breaker can meet `nfr.latency_p99_ms=50 @ target_qps=5000` **without new infra**.
3. If yes → back to `IMPLEMENT` with `scope="perf-tune"`; the `contract_ref` rides along so `omh-dev` cannot "fix" it by setting timeout to infinity (that violates the latency NFR).
4. If no (needs read replica / new cache cluster) → back to `ARCHITECT`, which bumps `design_contract.version`, then `IMPLEMENT`.
5. After the fix, the regression gate re-runs `frozen_tests`. Patch is rejected if anything goes red.

---

## 5. Agent definitions

> Each agent below is a system prompt + I/O contract. Codex should generate one agent module per section. All agents: read blackboard slices **by reference**, write `delta_patch` only, append to `decision_log`. Never echo the full `spec`.

### 5.1 `omh-orchestrator`
- **Context domain:** control flow + state.
- **Responsibility:** run the state machine in §4; route failures by `error_class`; enforce retry budget, token budget, regression gate; pick next agent by tier (§2).
- **Inputs:** blackboard state. **Outputs:** dispatch decisions, `decision_log` entries.
- **Must not:** write code, design, or interpret business logic. It only routes.

### 5.2 `omh-jira-spec`
- **Context domain:** intake.
- **Responsibility:** normalize a Jira ticket into a `spec` object (§3.1); set `tier`; write once to blackboard.
- **Outputs:** `spec`. **Tools:** Jira read.
- **Note:** not counted toward implementation token budget.

### 5.3 `omh-planner`  *(Extreme only)*
- **Context domain:** decomposition.
- **Responsibility:** split the epic into independent modules with explicit dependency edges; assign each a module id; define the parallelizable fan-out.
- **Inputs:** `spec` ref. **Outputs:** `plan` (module list + dependency DAG) as a `delta_patch`.
- **Must not:** design interfaces (that's architect).

### 5.4 `omh-architect`  *(absorbs data modeling + devops infra)*
- **Context domain:** design + data + infra topology.
- **Responsibility:** produce the **immutable** `design_contract` (§3.2): interfaces/IDL, **data model (DDL + migrations)**, NFRs, invariants, and the list of `frozen_tests`. For Extreme, also emit infra manifest (devops). On `performance`/`infra` re-route, amend contract and bump `version`.
- **Inputs:** `spec`/`plan` ref, optional `failure_report`. **Outputs:** `design_contract`.
- **Key rule:** data modeling is part of design — there is **no separate `omh-database` agent**. Database decisions live in `design_contract.data_model`.

### 5.5 `omh-dev`  *(absorbs backend + integrator + test + SAST)*
- **Context domain:** implementation (atomic, self-correcting).
- **Responsibility:** implement against the `design_contract` (by reference), then run an **inner loop**: unit/integration tests → static analysis (lint + SAST) → self-fix → repeat until green or local retry budget hit. Integrate into the branch. Emit a `delta_patch`.
- **Inner-loop spec (TDD-style):**
  ```
  while not (tests_green and sast_clean) and local_retries < 3:
      code = implement(contract_slice)
      results = run(unit_tests + integration_tests + sast)
      if failing: code = self_fix(results, contract_slice)   # contract stays binding
  emit delta_patch  # only if green; else emit failure_report to orchestrator
  ```
- **Inputs:** `design_contract` ref + (optional) `failure_report` + `scope` hint. **Outputs:** `delta_patch` or `failure_report`.
- **Must not:** alter the `design_contract`. If it can't satisfy it, it emits a `failure_report` (class `performance`/`contract`) and lets the orchestrator decide.
- **Tools:** repo read/write, test runner, SAST, linter.

### 5.6 `omh-review`  *(Extreme gate, parallel)*
- **Context domain:** correctness/maintainability gate.
- **Responsibility:** review the **diff only** (`delta_patch`) against `design_contract` + invariants. Output pass/block + findings. Runs in parallel with `omh-security`.
- **Inputs:** `delta_patch` + `design_contract` ref (no full spec). **Outputs:** `gate_result{pass|block, findings[]}`.

### 5.7 `omh-security`  *(Extreme gate, parallel)*
- **Context domain:** security gate.
- **Responsibility:** deeper security review beyond dev's inner-loop SAST — authz/authn, data exposure, injection, secrets, supply chain. Reviews diff only. Parallel with `omh-review`.
- **Outputs:** `gate_result{pass|block, findings[]}`. A block routes back to `IMPLEMENT` with `scope="security-fix"`.

### 5.8 `omh-release`
- **Context domain:** deployment + rollback.
- **Responsibility:** deploy, run smoke tests, auto-rollback on failure. The single safety gate present in every tier.
- **Inputs:** integrated branch + `design_contract.nfr` (for post-deploy verification). **Outputs:** release status, `decision_log` entry.
- **Must not:** modify code. On smoke-test failure it emits a `failure_report` (class per symptom) and triggers rollback.

---

## 6. Token budget — Extreme epic (hard cap 60,000 tokens)

The old matrix exploded tokens because ~6 agents each re-sent the full spec. The blackboard removes that.

**How redundancy is cut ~60%:**
- **De-dup spec:** stored once, referenced by `spec_id`. Previously ~6× the spec (≈6N) → now ≈1N + small references.
- **Structured over prose:** schema travels as DDL/IDL/JSON, never re-explained in narrative.
- **Delta passing:** agents output unified diffs / artifact pointers, not full restatements.
- **Diff-only gates:** `omh-review`/`omh-security` read the `delta_patch`, not the spec.
- **Per-domain working memory:** each agent sees only its slice + contract reference, never the full transcript.

**Suggested allocation:**
| Bucket | Budget |
|--------|--------|
| Orchestration / routing | ~8,000 |
| Architect (design contract) | ~12,000 |
| Implement pool (dev) | ~20,000 |
| Governance gate (review + security, diff-only) | ~15,000 |
| Reserve | ~5,000 |

Orchestrator must call `token_budget_exhausted()` before each dispatch and escalate to `FAILED` if the cap would be exceeded.

---

## 7. Build instructions for Codex

1. Generate one agent module per section in §5 (`omh-orchestrator`, `omh-jira-spec`, `omh-planner`, `omh-architect`, `omh-dev`, `omh-review`, `omh-security`, `omh-release`).
2. Implement the **Blackboard** as a shared store keyed by `spec_id` / `contract_id`, exposing `read_slice(ref, fields)` and `write_delta(delta_patch)`. Cache reads.
3. Implement the **Orchestrator** state machine exactly as §4 (error-class routing, retry budget, regression gate, token budget). It is the only component that decides routing.
4. Wire tier selection (§2): Easy = `dev → release`; Normally = `architect → dev → release`; Extreme = full flow with parallel `review`+`security` gate.
5. Enforce: `design_contract` is immutable except via `omh-architect` (version bump); `omh-dev` runs its inner self-correction loop before emitting; gates read diffs only.
6. Every state transition and failure appends a `decision_log` entry.

**Acceptance checks for the generated system:**
- An Easy sub-task touches at most 2 agents.
- A `performance` failure with a fix inside the NFR routes to `omh-dev` (not `omh-architect`); one requiring new infra routes to `omh-architect`.
- After any fix, frozen contract tests are re-run (regression gate) and a red result rejects the patch.
- Exceeding retry or token budget escalates to a human (`FAILED`), never loops forever.
- No agent prompt contains a full copy of the `spec` — only references.
