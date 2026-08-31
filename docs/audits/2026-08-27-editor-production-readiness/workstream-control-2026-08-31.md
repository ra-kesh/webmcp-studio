# Workstream control ledger

Date: 2026-08-31

Status: active orchestration ledger

Baseline: `main` at `6265561`

This file records the remaining product work and its task ownership. It is the
first document to read after a context compaction. A workstream is not merged
merely because its task reports completion.

## State vocabulary

- `dispatched`: the task exists but has not returned an accepted commit.
- `implemented`: code is committed on the task branch and focused checks pass.
- `accepted`: the required independent review has no open P0 or P1 finding.
- `merged`: the accepted commit is integrated into current `main` and the
  relevant product ledger is reconciled.
- `blocked`: a named external dependency prevents the remaining acceptance
  evidence; nonblocked implementation must continue.

Every status report must include the task ID, branch or commit, and one of the
states above.

## Active workstreams

| Priority | Workstream | Task ID | Entry truth | Required exit | Current state |
| ---: | --- | --- | --- | --- | --- |
| 1 | TEXT-02 closure integration | `01a058d6-ea4b-7653-ae23-b9879054208d` | Final hardening exists as unmerged `dbb71f4`; current main contains the earlier `a116d03` repair and later conflicting mask/conformance work. | Port only the missing rich-text closure onto current main, preserve later work, pass focused checks and review, reconcile the ledgers, then merge. | dispatched |
| 2 | ASSET-02 masks M4C through M5 | `01a058d6-efa8-7332-9081-00bb8c0b40d3` | M4C C0/C1 is merged at `6265561`; C2-C5 and M5 remain. M3, M4A and M4B have named retained-evidence gaps. | Commit and accept C2-C5 and M5 without reopening M0-M2; record any healthy-host evidence blocker precisely. | dispatched |
| 3 | LIBRARY-02 Gate 8 | `01a058d6-f4c4-7770-9658-a68d1f702fe3` | Gates 1-6E and Gate 7 Assets workspace are merged. The existing catalog contains 21 templates and 37 media items. | Pass the complete desktop/compact, scale, workflow and independent-review closure; reconcile all library ledgers. | dispatched |
| 4 | ASSET-02 background removal B1-B4 | `01a058d6-fb14-7472-9cfa-15b9ca7d694d` | B0 durable repository and provenance contract is merged. No provider call or user workflow exists. | Accept B1 API/dispatch, B2 immutable output asset, B3 editor workflow and B4 WebMCP/evidence without unauthorized provider or cloud writes. | dispatched |
| 5 | Full editor sophistication | `01a058d7-0b96-7bd0-8ee9-4cb5d3625209` | The bounded EDITOR-POLISH-01 Gates 1-7 are merged; full OpenPencil-level refinement remains a later product pass. | Produce and accept concrete visual/interaction gates with retained before/after evidence without changing accepted command semantics. | dispatched |
| 6 | GEN-01 WebMCP generation | `01a058d7-17fa-76f3-84de-371e57716b6c` | Assessment and four-gate plan are merged; implementation has not started. | A supplied external `SKILL.md` can create a reviewed, editable blank or exact-template document through bounded Studio WebMCP contracts. | dispatched |
| 7 | Production evidence reconciliation | `01a058d7-0278-7d40-b1f6-53ee2f75b05e` | Local hardening is substantial; deployment and healthy-host evidence are mixed with stale migration counts in older ledgers. | Produce current read-only/local truth, exact authorization checklist and safe ledger/verifier corrections without remote writes. | dispatched |

## Integration rules

1. Tasks work in isolated branches or worktrees and do not edit `main`
   directly.
2. A task must report its exact base, commits, changed files, checks, review
   verdict and integration risks.
3. The controller compares every returned commit with current `main`; it does
   not trust branch ancestry or a textual final answer alone.
4. Conflicting work is ported deliberately. Old branches are never blindly
   merged over newer schema, renderer or audit changes.
5. After integration, update this file and the workstream's authoritative audit
   in the same checkpoint.
6. Port 3000, persisted browser data and the known untracked capture directories
   remain untouched.

## Scheduling

Tasks may perform audit, implementation and focused checks independently. Broad
browser suites, production builds and Cloudflare-backed runs must be scheduled
so they do not compete for the same host resources. Remote deployment, paid
Browser use, provider calls and production migrations require explicit user
authorization.
