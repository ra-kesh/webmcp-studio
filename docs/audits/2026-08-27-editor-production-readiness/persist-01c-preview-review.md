# PERSIST-01C durable preview code review

Date: 2026-08-29

Final verdict: **ACCEPT — no remaining P0/P1 findings**

## Scope

An independent reviewer read the current implementation rather than relying on
the phase map or test names. The review covered:

- summary-bound preview identity and metadata-only repository reads;
- the stateless multi-document renderer producer;
- controller admission, cancellation, retry, invalidation, and object-URL
  ownership;
- local and managed image materialization for live fallback;
- provider lifecycle and repository-event handling;
- grid/list preview composition and Open/Retry/action semantics.

## Rejected first candidate

The first candidate was rejected with five P1 findings:

1. LRU eviction revoked URLs while their entries remained published as ready.
2. Visibility release changed failed previews to deferred and retried them on
   re-entry without an explicit Retry command.
3. Development fallback left managed asset aliases unmaterialized.
4. A later local-asset load failure could leak URLs created for earlier assets.
5. The visual preview well was not an Open target.

Each finding received a production repair and focused regression.

## Accepted repair

The re-review verified that:

- consumed ready URLs are never evicted; inactive eviction downgrades/removes
  the published entry before revocation;
- failed state survives viewport churn and changes only through explicit Retry
  or authoritative invalidation;
- live fallback materializes `asset:local/*` through owned Blob URLs and
  `asset:managed/*` through the validated workspace content route;
- fallback URLs become controller-owned before asynchronous loading and are
  revoked on cancellation, failure, replacement, visibility loss, and disposal;
- preview wells expose dedicated accessible Open buttons without nesting Retry
  or menu actions;
- external preview events reload retained exact identities, while content,
  delete, restore, and quarantine events invalidate them;
- stored hits remain metadata-only and production misses retain the stateless
  authenticated renderer plus final `putPreview()` CAS boundary;
- provider construction and disposal remain StrictMode-safe and inert without
  consumers.

## Evidence

- Complete focused slice: **120/120 across seven files**.
- Controller and mounted library subset: **24/24**.
- Studio typecheck: pass.
- Focused ESLint: pass.
- Prettier and `git diff --check`: pass.
- Live localhost acceptance: actual first-page preview visible; preview Open
  action navigated to the exact canonical document route.

The larger deployed renderer-versus-Artboard conformance matrix and two-tab
browser journey remain separately tracked. They are not blockers for this
bounded persistence preview gate.
