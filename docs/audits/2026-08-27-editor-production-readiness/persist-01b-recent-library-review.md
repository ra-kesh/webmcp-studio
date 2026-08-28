# PERSIST-01B Recent/Trash library review

Date: 2026-08-29
Final verdict: **APPROVE — zero open P0, P1, or P2 findings**

## Scope reviewed

The review covered the production Recent/Trash surface, its controller/model
projection, Start cutover, exact-ID opening, focus ownership, virtualization,
responsive behavior, and mounted interaction evidence. The reviewer read the
implementation and tests; this was not a screenshot-only or model-only review.

## Rejection and remediation history

The first pass rejected these gaps:

- the old one-card durable draft owner still existed beside the new library;
- virtual rows were estimated but not measured;
- disabled/pending state did not gate every mutation and creation surface;
- important keyboard, failure, pagination, and virtual-focus paths lacked
  mounted proof;
- persistence warnings and live announcements had competing owners;
- final-page Load more had no deterministic focus destination;
- more than one Open could claim the surface;
- coarse-pointer targets, reduced-motion pending feedback, and decorative icon
  semantics were incomplete;
- a failed action whose row disappeared lost document identity and recovery.

Those findings were repaired. A second pass then rejected four narrower
interaction defects:

- failed Open could target a disabled or disconnected source;
- failed Download, Move to Trash, or Restore suppressed menu autofocus without
  installing a post-commit failure-focus owner;
- virtual grid presentation wrappers erased list-item semantics;
- virtual and non-virtual grids used different responsive breakpoints.

Those findings were repaired with connected-node checks, explicit post-commit
focus ownership, preserved list/list-item semantics, shared breakpoints, and
mounted regressions.

The third pass found one final P2: persistence could replace the collection
while Open or a menu action was pending, unmounting both the source and the
collection-only fallback heading. The provider-boundary heading now owns the
same stable ref and `tabIndex={-1}`. Two mounted tests defer Open and Download,
preempt the collection with persistence opening, settle failure, and prove
focus reaches the still-mounted heading.

## Final evidence

- component and mounted Recent/Trash tests: **27/27**;
- focused reviewer gate: **146/146** before the final two preemption tests;
- Studio typecheck: pass;
- scoped ESLint and Prettier: pass;
- `git diff --check`: pass;
- final reread: no open P0, P1, or P2 findings.

Healthy-browser acceptance remains separate. This review approves the code gate
and deterministic mounted evidence; it does not claim Back/Forward, compact,
multi-tab IndexedDB, blocked-upgrade, quota, or shutdown proof on a healthy
browser host.
