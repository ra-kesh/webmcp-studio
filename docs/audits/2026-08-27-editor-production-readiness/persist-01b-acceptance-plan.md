# PERSIST-01B executable acceptance plan

Date: 2026-08-28
Status: test contract only; no PERSIST-01B product or test implementation is claimed here

## Acceptance decision

PERSIST-01B is the point where Studio stops treating one browser draft as the whole workspace. It adds an addressable editor route, a real repository-backed recent-document collection, document lifecycle actions, navigation safety, and visible conflict recovery.

The work is accepted only when all P0, P1, and P2 cases in this plan pass at the appropriate layer. Passing fake IndexedDB or mounted React tests is necessary but cannot prove real reload, history, multi-tab, browser storage, or focus behavior. Those claims require the healthy-browser gates below.

PERSIST-01C still owns durable preview production, visibility-bounded preview loading, stale-preview labeling, storage estimates, and retention policy. PERSIST-01B may render a truthful placeholder or an already exact preview. It must not delay metadata or invent a preview.

## Evidence reread

Contracts reread:

- `workflow-and-feature-audit.md`, WF-03
- `production-readiness-backlog.md`, PERSIST-01 and AUTOSAVE-01
- `persist-01-phase-entry.md`, especially start routes, autosave and critical flush, multi-tab, failure modes, and later local slices
- `start-01-phase-entry.md` and `start-01-start-surface-audit.md`, especially the explicit PERSIST-01 deferrals
- `persist-01a-hook-cutover-plan.md` and `persist-01a-independent-code-review.md`

Current code and tests inspected:

- `apps/studio/src/routes/index.tsx`, `routes/__root.tsx`, and `routeTree.gen.ts`
- `apps/studio/src/features/editor/document-draft-repository.ts` and its three repository suites
- `document-draft-save-controller.ts` and its suite
- `use-document-editor.ts`, its mounted persistence/start/StrictMode/history suites, and `studio-shell.tsx`
- `studio-start-model.ts`, `studio-start-surface.tsx`, and their suites
- `use-critical-action-owner.ts`, `use-draft-replacement.ts`, and their suites
- existing Playwright conventions under `apps/studio/test/e2e`

The current repository already has bounded list/get/create/save, stable cursor ordering, canonical rename, duplicate provenance, soft delete, restore, purge, conflict listing and resolution, quarantine, exact expected-version checks, and reasoned repository events. The current tests prove equal-timestamp pagination, two-instance save conflict, deletion resurrection prevention, duplicate identity, restore, purge, blocked/unavailable/quota failures, controller ordering, exact critical flush, and active-document foreign-event handling.

The product layer does not yet expose those capabilities as a multi-document workflow:

- `/` is the only page route. There is no `/documents/$documentId` route.
- `StudioStartModel` and `StudioStartSurface` project one `currentDraft`, not pages of repository summaries.
- Continue opens `startDocumentIdRef`, not a route-owned document identity.
- New, Template, Import, and Sample still use the single-draft replacement contract rather than creating separate repository records.
- Rename, duplicate, trash, restore, permanent purge, and conflict resolution are not document-level product commands.
- No browser test currently proves real multi-document routing, recents, reload, history, or multi-tab behavior.

## Required implementation seams

Tests should target small owners rather than driving every rule through `StudioShell`.

| Owner                          | Required responsibility                                                                                                                                                         | Likely file or extraction                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Route codec                    | Validate and generate `/documents/$documentId`; preserve exact identity without decoding surprises                                                                              | `apps/studio/src/features/editor/document-route.ts`                                                                    |
| Session transition coordinator | Settle editor modes, capture synchronously, flush the exact active controller, invalidate stale async opens, load/get/touch/install the route target, and return typed outcomes | `apps/studio/src/features/editor/document-session-controller.ts` or a focused extraction from `use-document-editor.ts` |
| Recent-document controller     | Load one bounded metadata page, append by opaque cursor, refresh after repository events, reject stale completions, and retain prior successful rows during retry               | `apps/studio/src/features/editor/recent-documents-controller.ts`                                                       |
| Recent model                   | Project active and deleted summaries, action capabilities, pending action ownership, errors, and conflict/recovery items without reading document bodies                        | `apps/studio/src/features/editor/recent-documents-model.ts`                                                            |
| Recent view                    | Semantic links/cards, menus, empty/loading/error states, trash view, compact composition, live status, and exact focus return                                                   | `apps/studio/src/features/editor/recent-documents.tsx` and `studio-start-surface.tsx`                                  |
| Document actions               | Rename, duplicate, soft delete, restore, purge, Reload saved, and Save as copy through one typed command owner                                                                  | `apps/studio/src/features/editor/document-lifecycle-actions.ts`                                                        |
| Router integration             | `/` start route, `/documents/$documentId` editor route, blockers, persistent route notice, and history behavior                                                                 | `apps/studio/src/routes/index.tsx`, new `routes/documents/$documentId.tsx`, and generated `routeTree.gen.ts`           |
| Shell integration              | Render the route-provided session only; do not bootstrap or substitute the private starter for a bad route                                                                      | `use-document-editor.ts` and `studio-shell.tsx`                                                                        |

Generated `routeTree.gen.ts` is verification evidence, not the hand-authored owner. Tests must not patch it directly.

The transition coordinator should accept injected repository, navigation, clock, and focus adapters. Its request generation must be observable in tests. The recents controller should accept `list` and `subscribe` dependencies. This keeps stale completion, event, and failure tests deterministic without sleeping.

## Test data and determinism rules

Use fixed IDs and timestamps in every non-browser test:

- documents: `document-a`, `document-b`, `document-c`, and `document-copy`;
- equal activity time: `2026-08-28T10:00:00.000Z`;
- sessions: `tab-a` and `tab-b`;
- explicitly controlled deferred promises for `flush`, `get`, `touchOpened`, `list`, `duplicate`, and navigation;
- fake IndexedDB database names unique to each test and deleted in cleanup;
- no arbitrary timers, polling loops, animation waits, or `setTimeout` races;
- assert exact `document.id`, `draftSnapshotId`, `recordVersion`, source context, route, focused element, and visible error, not only that an action was called.

Browser tests should create records through a checked-in test helper that calls the public repository contract in the page. Do not seed private IndexedDB rows by shape except in tests explicitly proving corrupt or unsupported storage. Use one browser context for reload/history and two pages in one context for shared IndexedDB plus BroadcastChannel tests.

## P0 route and identity matrix

| ID      | Layer   | Contract and deterministic proof                                                                                                                                                                                                                                                                                                                                                                                                                                       | Likely test owner                                 | Host            |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------- |
| P1B-U01 | Unit    | Route codec accepts the repository's nonempty document ID and produces one safely encoded path segment. Simple, whitespace-bearing, slash-bearing, percent-bearing, tilde-bearing, and Unicode IDs round-trip exactly. An empty or malformed encoded route returns a typed invalid-route result without repository access. If the product narrows canonical IDs later, admission, import, repository, and route validation must adopt the same shared schema together. | new `document-route.test.ts`                      | Restricted-safe |
| P1B-M01 | Mounted | Opening `/documents/document-b` calls `get("document-b")`, installs only the returned envelope, creates a controller for `document-b`, then calls `touchOpened("document-b")`. The heading, save owner, publication owner, export owner, and active route all report `document-b`.                                                                                                                                                                                     | new `use-document-editor.routes.mounted.test.tsx` | Restricted-safe |
| P1B-M02 | Mounted | A route target that is missing, deleted between `get` and `touchOpened`, corrupt, quarantined, or unavailable never installs the private starter or the previously active document under the requested URL. It returns to `/` once with a persistent, document-specific notice and focus target.                                                                                                                                                                       | same route suite                                  | Restricted-safe |
| P1B-M03 | Mounted | Deferred open A cannot install after route B has started or completed. Cover `get(A)` late, `touch(A)` late, StrictMode replay, unmount, and Back immediately after forward navigation. Only the latest request generation may install or focus.                                                                                                                                                                                                                       | same route suite                                  | Restricted-safe |
| P1B-M04 | Mounted | New, Template, Import, Sample, and Duplicate each create a distinct repository record before navigation. Created route ID, active controller ID, canonical `document.id`, and source context must match. A create or navigation failure leaves the user on Start with the new record either absent or explicitly recoverable, never hidden as the current workspace.                                                                                                   | new `document-lifecycle-actions.test.tsx`         | Restricted-safe |
| P1B-B01 | Browser | Directly opening `/documents/document-b`, refreshing it, copying the URL to a new tab, and reopening from Start always opens `document-b` with its exact name and content. No starter or other recent document flashes as editable content.                                                                                                                                                                                                                            | new `test/e2e/document-routing-recents.spec.ts`   | Healthy browser |
| P1B-B02 | Browser | Unknown, deleted, and corrupt deep links end on `/` with a persistent error naming the target. Refreshing `/` preserves the notice until dismissed or a successful action replaces it.                                                                                                                                                                                                                                                                                 | same browser suite                                | Healthy browser |

P0 failure rule: any path that displays one document while saving through another document's controller, substitutes a sample for a failed route, or loses an in-memory candidate is an immediate rejection.

## P1 recent-document list and pagination matrix

| ID      | Layer      | Contract and deterministic proof                                                                                                                                                                                                                                                                                                            | Likely test owner                                                           | Host            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| P1B-U02 | Repository | Retain the existing equal-`activityAt` ordering proof and extend it across three pages, with inserts both above and below the current cursor. A page contains no duplicates, preserves `(activityAt, documentId)` descending order, and rejects altered, mismatched, or oversized cursors.                                                  | `document-draft-repository.failures.test.ts`                                | Restricted-safe |
| P1B-U03 | Controller | Initial list, Load more, Retry, and repository-event refresh have separate request generations. A late initial page cannot replace a newer refresh. A late Load more cannot append after query, trash filter, or sort context changes.                                                                                                      | new `recent-documents-controller.test.ts`                                   | Restricted-safe |
| P1B-U04 | Controller | A `saved/opened`, `deleted`, `restored`, or `publication_linked` event invalidates metadata only after commit. Self and foreign events produce the same list truth; malformed or unavailable channel delivery does not change repository correctness. Refresh coalesces bursts and does not drop the current successful rows while pending. | same controller suite                                                       | Restricted-safe |
| P1B-C01 | Component  | Opening state, honest empty state, ready collection, loading-more state, retryable error, terminal storage warning, no-results state, and deleted collection render distinct copy and actions. Metadata rows render without body reads or fabricated thumbnails.                                                                            | new `recent-documents.test.tsx` and updated `studio-start-surface.test.tsx` | Restricted-safe |
| P1B-B03 | Browser    | Seed at least 105 records with equal timestamps around the page boundary. Scroll or activate Load more until all are present. Assert stable order, no duplicates, no skipped IDs, and active card continuity after one record is touched from another tab.                                                                                  | `document-routing-recents.spec.ts`                                          | Healthy browser |

Search is accepted only if it is truthful about its scope. The current repository scans metadata in index order until it has one bounded page of matches, without reading bodies. If PERSIST-01B labels this as document search, tests must seed matches beyond the first 50 metadata rows and prove cursor continuation discovers them without duplicates. Search must not be implemented as filtering only the rows already rendered in the client.

## P1 lifecycle action matrix

| ID      | Layer      | Contract and deterministic proof                                                                                                                                                                                                                                                                                                                | Likely test owner                                           | Host            |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| P1B-U05 | Repository | Retain canonical rename proof and add unchanged trimmed name, empty name, stale expected version, deleted record, and write failure. Rename changes the document body and content identity; it cannot patch metadata alone.                                                                                                                     | `document-draft-repository.test.ts` and `.failures.test.ts` | Restricted-safe |
| P1B-M05 | Mounted    | Rename opens with the current name selected, keeps the dialog open on validation/CAS/storage failure, announces the error, and updates route heading plus recent row only after commit. Escape is inert. Focus returns to the invoking card/menu button.                                                                                        | new `document-lifecycle-actions.test.tsx`                   | Restricted-safe |
| P1B-U06 | Repository | Retain duplicate proof and add source-context preservation, exact `origin: { kind: "duplicate", sourceDocumentId }`, no publication linkage, reset canonical revision/timestamps, independent document ID, and source deletion after copy. The copy remains readable and independently editable.                                                | `document-draft-repository.test.ts`                         | Restricted-safe |
| P1B-M06 | Mounted    | Duplicate has one synchronous owner. Double activation creates one copy. Navigation waits for successful creation, opens the copy, and marks no conflict resolved until Save as copy has both created and installed the copy. Failure leaves the source selected and reports the error.                                                         | `document-lifecycle-actions.test.tsx`                       | Restricted-safe |
| P1B-M07 | Mounted    | Soft delete from Start removes the row only after repository commit and offers Restore through a persistent status/undo affordance. A failed or stale delete keeps the row and its controls. Deleting the active document first settles and flushes it, commits the tombstone, returns to `/`, and never lets the active controller save again. | same action suite plus route suite                          | Restricted-safe |
| P1B-M08 | Mounted    | Restore uses the tombstone's latest `recordVersion`, reappears in active recents, and opens only after `get` and `touchOpened` succeed. A stale restore exposes conflict/retry, not a phantom card.                                                                                                                                             | same action suite                                           | Restricted-safe |
| P1B-U07 | Repository | Retain atomic purge proof and add unresolved-conflict retention policy, stale expected version, not-deleted precondition if product requires it, and transaction failure. Metadata, body, preview, and permitted conflict records are either all present or all gone.                                                                           | repository suites                                           | Restricted-safe |
| P1B-C02 | Component  | Permanent purge is available only from Trash or explicit recovery. Confirmation names the document, states permanence, and requires a separate confirmation action. Ordinary Delete never calls `purge`.                                                                                                                                        | `recent-documents.test.tsx`                                 | Restricted-safe |
| P1B-B04 | Browser    | Rename, duplicate, delete, undo/restore, open restored copy, delete active document, and permanent purge survive refresh and preserve exact route/focus behavior. Browser Back cannot reopen a purged editor session.                                                                                                                           | new `test/e2e/document-lifecycle.spec.ts`                   | Healthy browser |

If permanent purge UI remains in PERSIST-01C, P1B-U07 remains a required repository regression gate and P1B-C02/P1B-B04's purge segment becomes a named PERSIST-01C prerequisite. PERSIST-01B must not expose an untested purge shortcut.

## P1 flush, navigation, and active-delete race matrix

| ID      | Layer   | Contract and deterministic proof                                                                                                                                                                                                                                                                                             | Likely test owner                                                                 | Host            |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| P1B-M09 | Mounted | Link click, recent-card open, Home, New, Template, Import, Sample, Duplicate-open, active Delete, and Back/Forward transition all settle active crop/text/transform/guide state, synchronously capture the exact canonical envelope, then await `flush`. Navigation and replacement remain uncalled while flush is deferred. | new `document-session-controller.test.tsx`, plus `use-draft-replacement.test.tsx` | Restricted-safe |
| P1B-M10 | Mounted | Failed, conflicted, or deleted flush blocks route change, keeps the exact in-memory document visible, leaves URL/history unchanged, and exposes Retry plus Download my version. Retry must flush the same or a newer synchronous capture, never an older render snapshot.                                                    | same transition suite                                                             | Restricted-safe |
| P1B-M11 | Mounted | Two navigation requests in the same turn have one critical owner. The first owns settlement, flush, navigation, and focus. A late completion from the first cannot release or overwrite a newer accepted transition.                                                                                                         | `use-critical-action-owner.test.tsx` and transition suite                         | Restricted-safe |
| P1B-M12 | Mounted | Tab B soft-deletes active document A while tab A is clean, dirty, flushing, or opening. Clean A closes or reloads according to the stated policy. Dirty/flushing A retains a durable `deleted_elsewhere` candidate and cannot recreate the ID. No route, focus, status, or controller reports completion before CAS settles. | `use-document-editor.persistence.mounted.test.tsx` and route suite                | Restricted-safe |
| P1B-B05 | Browser | Edit text without waiting for debounce, click a different recent document, and observe that the destination does not render until the source flush completes. Navigate Back, reopen the source, and verify the latest text. Repeat with Home and active Delete.                                                              | `document-routing-recents.spec.ts`                                                | Healthy browser |
| P1B-B06 | Browser | When a deterministic save failure is injected, card navigation and Back remain blocked, URL stays on the source, browser reload/unload warning appears only while unsaved memory exists, and Download my version contains the exact live edit.                                                                               | same browser suite                                                                | Healthy browser |

The native unload prompt text must not be asserted. Browser tests assert that the dialog occurs only for unsaved memory and accept or dismiss it through Playwright.

## P1 conflict and recovery matrix

| ID      | Layer   | Contract and deterministic proof                                                                                                                                                                                                                                                                               | Likely test owner                                                     | Host            |
| ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- |
| P1B-U08 | Model   | One unresolved conflict item projects document name, reason, candidate time, saved-head state, and exact available actions. `stale_write`, `deleted_elsewhere`, `migration_collision`, corrupt candidate, and resolved conflict are distinct. Private source context is never printed.                         | new `document-conflict-model.test.ts`                                 | Restricted-safe |
| P1B-M13 | Mounted | A CAS conflict pauses autosave and opens a persistent dialog/status with Download my version, Reload saved version, and Save my changes as a copy. Dismissal cannot mark it resolved or hide the recovery entry. Errors use `role="alert"`; progress uses `role="status"`.                                     | new `document-conflict-dialog.test.tsx` and persistence mounted suite | Restricted-safe |
| P1B-M14 | Mounted | Reload saved downloads remain available until confirmation, then installs the exact latest durable record, creates fresh history/controller identity, resolves the matching conflict as `reload_saved`, updates route, and restores canvas focus. Failed get/install/resolve keeps candidate recovery visible. | same conflict suite                                                   | Restricted-safe |
| P1B-M15 | Mounted | Save as copy creates from the exact stored candidate, with a new canonical ID and duplicate provenance pointing to the conflicted document, navigates only after create succeeds, then resolves that exact conflict as `save_copy`. A newer candidate or failed create cannot be accidentally resolved.        | same conflict suite                                                   | Restricted-safe |
| P1B-M16 | Mounted | Quarantine/recovery takes precedence over ordinary recent actions. Download raw/candidate bytes, Retry, Delete quarantined record, and Return Home remain visible across a failed retry. No corrupt body is installed for editing.                                                                             | updated recovery suites and recent component suite                    | Restricted-safe |
| P1B-B07 | Browser | Two tabs edit the same version. One saves, the other receives a visible external-change state and reaches an authoritative CAS conflict on save. Exercise Download, Reload saved, then repeat and Save as copy. Both final documents survive reload with correct identities.                                   | new `test/e2e/document-multitab-conflict.spec.ts`                     | Healthy browser |
| P1B-B08 | Browser | A corrupt stored pair and a migration collision appear as recovery items on Start. Normal recents remain usable, private/sample content is not substituted, and recovery actions survive refresh.                                                                                                              | same conflict browser suite                                           | Healthy browser |

## P1 browser history, reload, and multiple-tab matrix

| ID      | Contract and deterministic proof                                                                                                                                                                                                                                                     | Browser file                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| P1B-B09 | Start at `/`, open A, open B through Home, then Back and Forward. URL, active controller ID, document heading, editor body, and recent focus target agree at every step. History traversal is blocked while an exact flush is pending and continues only once.                       | `document-routing-recents.spec.ts`   |
| P1B-B10 | Refresh Start in opening, empty, ready, blocked, unavailable, and conflict/recovery states. Refresh an editor route while autosave is settled and immediately after a committed save. No sample flash, duplicate record, `touchOpened` version bump, or source-context drift occurs. | same browser suite                   |
| P1B-B11 | Open A in two tabs and B in a third. Saving or opening B invalidates only B's recent row. Saving A refreshes A's metadata. Publication-only and opened events do not mark clean A dirty. Closing one tab does not close another tab's channel or repository.                         | `document-multitab-conflict.spec.ts` |
| P1B-B12 | Disable or stub BroadcastChannel, then repeat the two-tab stale-save race. Focus refresh and the repository CAS still expose conflict. This proves the channel is a hint, not authority.                                                                                             | same browser suite                   |

These are healthy-browser-only because jsdom and fake IndexedDB cannot prove real browser history, page lifecycle, independent tabs, native BroadcastChannel delivery, or persisted IndexedDB across reload.

## P1 storage failure matrix

| ID      | Layer      | Contract and deterministic proof                                                                                                                                                                                                                                                                                        | Likely test owner                                | Host            |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------- |
| P1B-U09 | Repository | Retain blocked upgrade, unavailable getter/open, request failure, transaction abort, quota, and rollback tests. Add each lifecycle operation to the failure table: list, get, touch, rename/save, duplicate/create, soft delete, restore, purge, conflict list/resolve. Previous committed state remains authoritative. | repository storage/failure suites                | Restricted-safe |
| P1B-M17 | Mounted    | Start distinguishes opening, blocked, unavailable, quota-after-open, and operation-specific failure. It never renders an empty durable workspace for a failed list. Recoverable in-memory work requires explicit session-only acknowledgement. Retry keeps prior successful rows and focus.                             | recent controller/component and route suites     | Restricted-safe |
| P1B-M18 | Mounted    | Quota during active flush blocks navigation and exposes Retry plus Download. Quota during duplicate, rename, delete, restore, purge, or conflict resolution reports the named failed action and does not optimistically mutate recents.                                                                                 | lifecycle and transition suites                  | Restricted-safe |
| P1B-B13 | Browser    | Hold an old-version IndexedDB connection open to trigger a real blocked upgrade. The new tab shows `Close the other Studio tab and retry`; closing the blocker and activating Retry opens the same records.                                                                                                             | new `test/e2e/document-storage-failures.spec.ts` | Healthy browser |
| P1B-B14 | Browser    | Use a deterministic browser test hook around the repository adapter to produce quota and unavailable outcomes. Verify UI, route blocking, Download, retry, and retained prior record. Do not depend on filling the user's disk or a browser-specific quota estimate.                                                    | same storage browser suite                       | Healthy browser |

A synthetic `QuotaExceededError` proves product handling. It does not prove a browser's platform quota threshold. Any optional real-quota smoke test must run in an isolated browser profile, remain non-gating, and must not write unbounded data.

## P2 compact and accessibility matrix

| ID      | Layer     | Contract and deterministic proof                                                                                                                                                                                                                                                                             | Likely test owner                                                  | Host                               |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| P1B-C03 | Component | Every document card uses a real link for navigation or a button with equivalent route semantics. Rename, Duplicate, Move to trash, Restore, and Delete permanently have text labels in menus. Icon-only triggers have accessible names. No nested interactive control sits inside a link.                    | `recent-documents.test.tsx`                                        | Restricted-safe                    |
| P1B-C04 | Component | Keyboard order follows visual order. Menu, dialog, and conflict actions are reachable without pointer input. Escape closes only the topmost layer. Focus returns to the exact opener after rename/delete cancellation, action failure, dialog close, or route failure.                                       | component suites                                                   | Restricted-safe                    |
| P1B-C05 | Component | Loading uses status semantics without repeated announcements. Errors use alerts. Pagination, mutation, external change, deletion undo, and conflict completion announce concise results. Storage warnings are not color-only.                                                                                | component suites                                                   | Restricted-safe                    |
| P1B-C06 | Component | Rename has a visible label and stable `name`; destructive confirmations name the document; permanent purge is visually and semantically distinct from Move to trash; disabled actions retain an accessible reason.                                                                                           | component suites                                                   | Restricted-safe                    |
| P1B-C07 | Component | Compact Start keeps feature parity. Recents, Load more, all lifecycle actions, recovery, storage warning, template/new/import/sample entry, and trash remain reachable. Controls are at least 44 by 44 CSS pixels on compact/touch layouts. No text input auto-focus summons the software keyboard on entry. | updated `studio-start-surface.test.tsx` and recent component suite | Restricted-safe for markup/classes |
| P1B-C08 | Component | Long names, localized timestamps, 200 percent text zoom, reduced motion, and high-contrast focus styles do not hide actions or meaning. A list with 100 rows remains bounded and does not read bodies.                                                                                                       | recent component/model suites                                      | Restricted-safe for semantics      |
| P1B-B15 | Browser   | Keyboard-only flow at 320, 390, 1280, and 1440 pixels covers Start, Load more, open, Home, menus, rename, duplicate, trash, restore, conflict dialog, and storage retry. Capture screenshots for empty, ready, trash, blocked, conflict, and compact action menu states.                                     | new `test/e2e/document-recents-accessibility.spec.ts`              | Healthy browser                    |
| P1B-B16 | Browser   | At 320 and 390 pixels plus 200 percent browser zoom, no action is clipped, overlapped, or available only by hover. Dialog/sheet focus is trapped, background is inert, Escape closes, and focus returns. Test prefers-reduced-motion and coarse-pointer/touch emulation.                                     | same accessibility suite                                           | Healthy browser                    |

Automated semantics do not replace a short manual screen-reader check. Before release, verify recent count/list updates, external-change notice, delete undo, and conflict choices in VoiceOver or NVDA without reading duplicate or stale announcements.

## Existing tests to retain unchanged

PERSIST-01B must not weaken these established proofs:

- `document-draft-repository.test.ts`
- `document-draft-repository.failures.test.ts`
- `document-draft-repository.storage-failures.test.ts`
- `document-draft-save-controller.test.ts`
- `use-document-editor.persistence.mounted.test.tsx`
- `use-document-editor.strict-mode.persistence.mounted.test.tsx`
- `use-document-editor.start.mounted.test.tsx`
- `use-document-editor.history-commit.mounted.test.tsx`
- `use-critical-action-owner.test.tsx`
- `use-draft-replacement.test.tsx`
- `studio-start-model.test.ts`
- `studio-start-surface.test.tsx`
- `draft-recovery.test.ts` and existing recovery browser tests
- publication branch identity and document validation suites

Tests that expect exactly one `currentDraft` should be replaced only when the repository-backed collection test proves the stronger contract. Do not simply loosen the assertions to accept either shape.

## Suggested test file map

New non-browser files:

```text
apps/studio/src/features/editor/document-route.test.ts
apps/studio/src/features/editor/document-session-controller.test.ts
apps/studio/src/features/editor/recent-documents-controller.test.ts
apps/studio/src/features/editor/recent-documents-model.test.ts
apps/studio/src/features/editor/recent-documents.test.tsx
apps/studio/src/features/editor/document-lifecycle-actions.test.tsx
apps/studio/src/features/editor/document-conflict-model.test.ts
apps/studio/src/features/editor/document-conflict-dialog.test.tsx
apps/studio/src/features/editor/use-document-editor.routes.mounted.test.tsx
```

New healthy-browser files:

```text
apps/studio/test/e2e/document-routing-recents.spec.ts
apps/studio/test/e2e/document-lifecycle.spec.ts
apps/studio/test/e2e/document-multitab-conflict.spec.ts
apps/studio/test/e2e/document-storage-failures.spec.ts
apps/studio/test/e2e/document-recents-accessibility.spec.ts
```

Keep repository invariants in repository suites, controller order and races in pure or mounted suites, semantic rendering in component suites, and only browser-owned behavior in Playwright. A single large Playwright journey is not an acceptable substitute for deterministic failure tests.

## Environment split and commands

### Safe on the restricted host

These gates use Node, Vitest, jsdom where requested per file, and fake IndexedDB. They must not start Vite, Workerd, Wrangler, a browser, or a build.

```bash
PATH="/Users/rakesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  bun --filter @webmcp/studio test -- \
  src/features/editor/document-draft-repository.test.ts \
  src/features/editor/document-draft-repository.failures.test.ts \
  src/features/editor/document-draft-repository.storage-failures.test.ts \
  src/features/editor/document-draft-save-controller.test.ts \
  src/features/editor/document-route.test.ts \
  src/features/editor/document-session-controller.test.ts \
  src/features/editor/recent-documents-controller.test.ts \
  src/features/editor/recent-documents-model.test.ts \
  src/features/editor/recent-documents.test.tsx \
  src/features/editor/document-lifecycle-actions.test.tsx \
  src/features/editor/document-conflict-model.test.ts \
  src/features/editor/document-conflict-dialog.test.tsx \
  src/features/editor/use-document-editor.routes.mounted.test.tsx \
  src/features/editor/use-document-editor.persistence.mounted.test.tsx

PATH="/Users/rakesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  bun --filter @webmcp/studio typecheck

PATH="/Users/rakesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  bun --filter @webmcp/studio lint
```

Run scoped Prettier check and `git diff --check` on every changed file. Run the full Studio suite before independent code review.

### Mandatory healthy-browser gates

Run on a host without the known unreaped Workerd problem, using one canonical server on port 3000 and the checked-in Playwright config:

```bash
bun --filter @webmcp/studio test:e2e -- \
  test/e2e/document-routing-recents.spec.ts \
  test/e2e/document-lifecycle.spec.ts \
  test/e2e/document-multitab-conflict.spec.ts \
  test/e2e/document-storage-failures.spec.ts \
  test/e2e/document-recents-accessibility.spec.ts
```

Retain traces and screenshots on failure. Rerun the existing draft recovery, responsive shell accessibility, publication identity, and document validation browser suites because route ownership changes their bootstrap assumptions.

## Risk-ranked delivery order

1. **P0, route/session identity.** Add the route codec and transition coordinator. Prove exact controller/document/URL identity and stale-open rejection before rendering real recents.
2. **P0, flush boundary.** Put every route or destructive transition behind synchronous capture plus exact controller flush. Prove failure blocks URL/history changes.
3. **P1, recent metadata controller.** Replace the single card with repository pages, stable cursor append, refresh invalidation, and truthful states.
4. **P1, lifecycle commands.** Add rename, duplicate, trash, restore, and permanent purge only where the repository and confirmation rules are fully exercised.
5. **P1, conflict recovery.** Add durable candidate UI, Reload saved, and Save as copy with exact resolution ordering.
6. **P2, compact and accessibility.** Finish parity, focus, announcements, touch metrics, long-content behavior, and screenshots before declaring the feature complete.
7. **Healthy-browser acceptance.** Reload, Back/Forward, two-tab CAS, real blocked upgrade, compact focus, and accessibility evidence are the release gate.

## Final acceptance rule

PERSIST-01B is approved only when:

- no P0, P1, or P2 finding remains in independent code review;
- all restricted-host unit, mounted, component, typecheck, lint, formatting, and full Studio gates pass;
- every mandatory healthy-browser route, reload, Back/Forward, multi-tab, blocked-upgrade, failure, compact, and focus gate passes on a healthy host;
- Start never presents a storage failure as an empty durable repository;
- route, canonical document, active save controller, and visible heading always share one document identity;
- no navigation or destructive action outruns the exact active-draft flush;
- a stale or deleted tab cannot resurrect a document, and its candidate remains recoverable;
- ordinary Delete is recoverable, while permanent purge is separate and explicit;
- no sample, bootstrap document, or fabricated recent/preview is substituted for missing, deleted, corrupt, or unavailable data.

Until the browser gates pass, the accurate status is: **PERSIST-01B statically verified; browser acceptance pending**.
