# Remaining product work

Date: 2026-08-29

Status: authoritative continuation ledger after the original editor audit

This document reconciles the original audit with the implementation and browser
acceptance recorded in `remediation-progress.md`. The original parity matrix is
retained as historical evidence and must not be read as current product state.

## What is already a real product foundation

- Canonical multi-page documents, pages and outputs, hierarchical Layers,
  typed Inspector controls, direct text editing, text presets, fields,
  templates, reusable media, non-destructive image crop, guides, rulers,
  snapping, menus, command search, adjustable shell, and responsive panels.
- Named transaction history, cancellable transforms, selection-preserving
  Undo/Redo, durable multi-document drafts, Recent/Trash, conflict recovery,
  durable previews, and explicit legacy quotation organization.
- Immutable template publication, local PNG/PDF rendering, durable Review
  provenance/history, complete-document WebMCP queries, capability discovery,
  and canonical command proposal/direct execution policy.
- Real-browser acceptance exists for the highest-risk text, field, template,
  media, crop, Layers, menu, Review, and routed persistence journeys.

## Remaining work, in execution order

| Order | Boundary                  | Current truth                                                                                                                                                                                                            | Required completion                                                                                                                                                                    |
| ----: | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | HIST-01 memory            | **Completed locally.** Undo/Redo now have a measured 16 MiB payload budget in addition to the entry cap; unretained changes form an explicit unified-history barrier; reachable source contexts are pruned with history. | Retained as a regression gate. No further local HIST work is open.                                                                                                                     |
|     2 | Live editor closure       | GUIDE-01A/B, SHELL-01, START-01 and PERF-01 are implemented and code-reviewed, but parts of their breakpoint/pointer/focus/visual matrices remain open.                                                                  | Exercise the real product at 320, 390, 1119, 1280, 1440 and 1920 px; repair every observed defect; retain focused browser regressions and screenshots.                                 |
|     3 | CONFORM-01 / EXPORT-01    | Structural conformance fixtures exist. Local exports work, but Fabric, React preview, PNG and PDF pixel identity is not closed.                                                                                          | Golden documents and pixel thresholds for text, images, masks, crops, rotation, pages and themes; JSON round-trip; exact PNG/PDF artifact checks; deployed Browser Rendering evidence. |
|     4 | PERF-01 scale             | Inactive page thumbnails are rasterized, viewport scheduled, cached and bounded; a 100-page mounted fixture exists.                                                                                                      | Real browser latency/memory/Object-URL profiling, rapid page-churn cancellation, representative visual parity, and explicit budgets.                                                   |
|     5 | FAIL-01                   | Many boundaries have local error handling, but there is no single audited async state model.                                                                                                                             | Loading, timeout, cancel, retry and recovery for Fabric, storage, uploads, import/export, publish, WebMCP and render jobs, with accessible status and injected-failure tests.          |
|     6 | JOB-01                    | The edit→publish→render loop works locally, but render lifecycle is not a durable production job system.                                                                                                                 | Durable queued/running/succeeded/failed/cancelled jobs, leases, attempts, idempotency, timeout, restart recovery, cancellation, artifact expiry and metrics.                           |
|     7 | API-SEC-01 / API-ERR-01   | Strict document validation and several request limits exist; deployed identity and uniform error contracts are incomplete.                                                                                               | Principal/workspace ownership, quotas/rate/concurrency limits, request IDs, safe assets/fonts, stable error codes/paths/retryability, audit records and adversarial tests.             |
|     8 | Deployed storage          | Local media and document repositories are accepted; Worker contracts exist.                                                                                                                                              | Apply/inspect every D1 migration, exercise actual R2 multipart/assets/artifacts, verify workspace isolation and deployed render capacity.                                              |
|     9 | Stuwiz data lifecycle     | Exact quotation snapshots and composition provenance persist. Existing drafts do not reconcile with a changed upstream quotation.                                                                                        | Versioned source refresh, diff/impact preview, preserve-user-edits policy, explicit accept/reject, conflict/recovery, and source audit trail.                                          |
|    10 | Cross-browser local media | Managed media is shared; browser-local IndexedDB assets remain local by definition.                                                                                                                                      | Promotion/relink flow from local bytes to managed shared assets, missing-byte recovery, and safe reference migration across browsers.                                                  |

## Feature-depth work after the production spine

These are real product investments, not prerequisites for calling the current
document/image editor usable:

- Rich text runs, reusable text/paint styles, design tokens and variables.
- Reusable components, instances, variants and controlled overrides.
- Broader template and media library content, organization and permissions.
- Optional background-removal/image services with explicit privacy and failure
  contracts.
- Real-time collaboration, presence, comments and offline reconciliation.
- Organization roles, shared libraries, retention and audit export.

## Gate discipline

Before each boundary, reread its retained audit and the matching OpenPencil and
Loora code. Finish the bounded gate, run only the focused essential evidence,
obtain independent code review for P0/P1 changes, update this ledger and
`remediation-progress.md`, commit, and immediately continue to the next row.
Port 3000 belongs to Stuwiz; every WebMCP Studio browser or server command must
target port 3001 explicitly.
