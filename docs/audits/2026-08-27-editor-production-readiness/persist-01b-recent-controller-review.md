# PERSIST-01B RecentDocumentsController independent review

Date: 2026-08-29
Scope: `recent-documents-controller.ts` and its pure deterministic suite
Reviewer role: independent code review; no product or test implementation edits

## Verdict

**APPROVE — zero open P0, P1, or P2 findings in the pure controller.**

This approval is deliberately narrow. It covers the framework-independent Recent
and Trash controller, not the React provider, collection model/components,
canonical document route, or healthy-browser acceptance.

## Evidence read

The review started from the written contract rather than from the implementation
summary:

- `persist-01b-recent-trash-phase-map.md`, including the complete controller
  contract, concurrency rules, mutation semantics, recovery rules, non-goals,
  and pure-controller test matrix;
- the relevant Recent controller matrix in `persist-01b-acceptance-plan.md`;
- the actual OpenPencil workspace controller at
  `outputs/reference-repos/editors/open-pencil/packages/vue/src/document/workspace/use.ts`,
  especially inert setup, one active refresh, one queued invalidation,
  disposal, and source-event ownership;
- `document-draft-repository.ts`, including exact summary, list, cursor,
  recovery, event, read, rename, duplicate, soft-delete, and restore contracts;
- `studio-persistence-provider.tsx`, confirming that the controller dependency
  is provider fanout rather than a second repository subscription;
- every line of the final `recent-documents-controller.ts` and
  `recent-documents-controller.test.ts`.

## Findings raised and repaired

The initial green suite was not accepted. Adversarial review found the following
issues, each of which received a deterministic regression test before approval:

| Severity | Initial finding                                                                                                            | Final disposition                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Restore searched cached Recent before visible Trash, so a stale active summary could suppress the visible tombstone CAS.   | Summary lookup is collection-owned; Trash Restore submits the visible tombstone version.                                                                |
| P1       | Trash-first Restore could switch and focus Recent without a retained returned summary.                                     | The exact committed summary is retained while the authoritative Recent refresh is pending or failed.                                                    |
| P1       | Rename re-read a newer cached version at submit time and could overwrite an external edit.                                 | Rename reserves and submits the version captured when editing began.                                                                                    |
| P1       | A refresh could remove the row while Rename remained open, making Submit silently do nothing.                              | Submit is driven by the reserved ID/version and retains the typed repository failure.                                                                   |
| P1       | Same-context Refresh calls could start concurrent replacement reads.                                                       | Refreshes coalesce into one active request plus one queued rerun.                                                                                       |
| P1       | Corrupt action results and external quarantine events could remove a card without leaving recovery inventory.              | Exact local quarantine results and external event descriptors enter the sticky inventory; an exact later descriptor replaces the generic event message. |
| P1       | A successful action that completed after disposal returned a value that an unmounted caller could use for navigation.      | Disposed action completions return `null`/`false` and publish no state, focus, or announcement.                                                         |
| P1       | Rename/Delete/Download completion could focus a card in a collection the user had already left.                            | Action ownership travels with the operation and completion selects an existing document target or the visible collection heading.                       |
| P1       | Rename could leave a nonmatching row in retained search results, or omit a known committed row that entered a newer query. | Committed projection applies collection and query truth before the post-commit refresh and survives refresh failure.                                    |
| P1       | Undo Restore could focus a document hidden by a query changed after deletion.                                              | The current query is preserved; hidden restores announce that fact and focus the collection heading.                                                    |
| P1       | An older replacement completion could discard a committed duplicate or resurrect a committed deletion.                     | Mutations invalidate older replacement and append generations before applying the committed projection and starting the authoritative refresh.          |
| P2       | Final-page append targeted a Load more control that no longer existed.                                                     | Exhausted pagination targets the stable collection heading.                                                                                             |
| P2       | Rename editing did not reserve the document, and repeated Begin could reset typed input.                                   | Rename has a synchronous reservation; same-document actions/re-entry are rejected while different documents remain independent.                         |
| P2       | Delimiter-joined recovery keys could collide for imported IDs and failure text containing colons.                          | Recovery descriptors use structural tuple encoding.                                                                                                     |

## Final invariant review

The final code satisfies the controller boundary:

- construction is inert; activation installs one retained fanout listener;
  deactivate retains pages/recovery while canceling query, request, and focus
  ownership; dispose is terminal and rejects late publication;
- Recent and Trash have independent slots/cursors and call only `active` and
  `deleted` repository states;
- replacement generations reject old query, collection, refresh, retry,
  deactivate, and disposed completions; same-context invalidations are bounded
  to one queued rerun;
- append captures the exact lifetime, replacement generation, query, base page
  revision, and opaque cursor; it rejects state mismatches, repeated IDs, and
  descending-order violations without silently repairing data;
- search is scheduled through the injected 180 ms scheduler and always reaches
  repository metadata search rather than filtering loaded cards;
- events remain invalidation hints. No incomplete event payload is patched into
  a canonical document summary;
- recovery inventory is session-sticky, structurally deduplicated, and survives
  a later clean page;
- every mutation has synchronous per-document ownership, exact CAS where the
  repository supports it, committed-result projection, refresh without relying
  on event delivery, operation-local failure retention, and disposed guards;
- Move to Trash calls only `softDelete`; Restore uses the returned tombstone
  version; no purge shortcut exists;
- list/search/render paths never call `get()`. Only explicit Download reads a
  body, verifies both summary and envelope identity, and serializes the canonical
  envelope;
- focus and announcement acknowledgements are captured-ID guarded, preventing
  an older React effect from clearing a newer intent.

## Independent gates

Run with Node 24.19.0 from the repository workspace:

- focused Vitest: **1 file, 45 tests passed**;
- Studio typecheck: **exit 0**;
- scoped ESLint on controller and suite: **exit 0**;
- scoped Prettier check: **clean**;
- `git diff --check` on controller and suite: **clean**.

No Vite, Workerd, Wrangler, build, Playwright, or browser process was started on
the restricted host.
