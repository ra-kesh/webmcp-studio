# PERSIST-01B canonical document route review

Date: 2026-08-29
Final verdict: **APPROVE — zero open P0, P1, or P2 findings**

## Scope reviewed

The review covered canonical document-path encoding, typed route notices,
generation-safe admission, provider and StrictMode ownership, route-keyed
session installation, browser-history navigation blocking, deterministic
failure focus, library-to-document navigation, and mounted router evidence.
The reviewer read the production code, tests, phase audits, Loora route/client
patterns, and OpenPencil workspace/open-coordination source.

## Rejection and remediation history

The first review rejected four findings:

- Back/Forward could unmount the editor before a failed or conflicted flush
  settled, losing the only live candidate owner;
- a late route-A `touchOpened` could mutate recency after route B owned the UI;
- the route proof read source strings instead of mounting the router, provider,
  admission path, and session boundary;
- admission failure did not receive deterministic focus.

The repairs added a TanStack async navigation guard, a provider-owned FIFO
admission controller, real mounted router tests, and focused error-heading
ownership. Those mounted tests exposed an additional production race: the
document component derived identity from global location, so its own redirect
to `/` remounted it with an empty segment and replaced a precise missing notice
with `invalid_document_route`. Route identity now comes from `Route.useParams()`
and is validated by the canonical path codec.

The second review rejected two deeper lifecycle defects:

- React StrictMode effect replay permanently disposed the provider-owned
  admission controller before the retained mount could use it;
- route preparation called `returnToStart()`, destructively retiring the real
  editor session before router navigation was irrevocably committed.

Final cleanup is now generation-delayed so StrictMode replay cannot dispose the
retained controller, while real provider unmount still does. Route preparation
is non-destructive: crop/review block, active text commits, and
`flushActiveDraft()` drains the latest exact candidate. Session/controller
retirement remains owned by committed route unmount. Routed Home delegates to
the same blocker rather than clearing session identity before navigation.

## Final contract

- `/documents/$documentId` admits one exact durable record before mounting an
  editor session.
- Route parameter, admitted summary, canonical document, editor session, and
  shell route identity remain the same exact document ID, including encoded
  slash, percent, whitespace, and Unicode IDs.
- A stale admission cannot install. Final touches are FIFO, so if A is already
  mutating when B wins, B touches last and owns Recent ordering.
- Missing, deleted, corrupt/recovery-required, invalid, and unavailable targets
  never expose bootstrap content. They return to `/` with a fixed typed notice.
- SPA history stays on the current URL and keeps its editor owner mounted until
  the latest candidate is durably flushed. False or rejected preparation keeps
  the exact session alive.
- Native unload prompting is enabled only for live text/crop/review or a local
  save state that is not `saved`; `pagehide` remains best-effort drain.
- Admission and session failures have deterministic programmatic focus.

## Final evidence

- mounted production-route suite: direct deep link, encoded ID, A → B → Back,
  persistent missing notice, and dismissal;
- mounted navigation-guard suite: deferred success retains URL/owner until
  resolution; false and rejected exits retain URL/owner;
- StrictMode provider suite: exact create/admit remains live after replay and
  final unmount disposes the controller;
- mounted editor integration: an already admitted record becomes the exact
  workspace, controller, and canonical document owner;
- focused reviewer rerun: **14/14**;
- complete Studio suite: **890/890 across 116 files**;
- complete all-package suite: **1,463/1,463**;
- root format, lint, all-package typecheck, and production build: pass;
- `git diff --check`: pass;
- final independent verdict: no open P0, P1, or P2 findings.

Healthy-browser reload/Back/Forward evidence remains a separate acceptance
gate. A focused Chrome pass did prove blank creation navigates to its canonical
route, direct reload restores the same exact document, Home returns it to
Recent, browser Back reopens the same route, and the final console is clean.
That pass exposed and repaired an unbound browser `queueMicrotask` receiver in
runtime finalization; a unit regression now exercises the global receiver.
The code approval does not mark visible conflict recovery, multi-tab
conflict resolution, quota/blocked-upgrade behavior, PERSIST-01C previews, or
cloud synchronization complete.
