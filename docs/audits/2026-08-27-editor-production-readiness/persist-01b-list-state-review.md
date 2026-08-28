# PERSIST-01B list-state independent code review

Date: 2026-08-28
Scope: bounded `active | deleted | all` repository list-state slice only
Final re-review: 2026-08-28
Verdict: **APPROVE, no P0, P1, or P2 remains in this bounded slice**

## Resolved finding

### Prior P1: `list()` did not validate its complete runtime input before storage

Status: **resolved**.

Current evidence:

- `apps/studio/src/features/editor/document-draft-repository.ts:2890-2908`
  accepts the options value intact, validates it with the non-array `isRecord`
  guard, and returns a typed `validation_failed` result for `null` instead of
  rejecting during parameter destructuring.
- `apps/studio/src/features/editor/document-draft-repository.ts:2909-2957`
  derives defaults and validates state, query, limit, and any supplied cursor
  before `#open()` is reachable. A non-string query can no longer become a
  false `storage_unavailable`, and a falsy non-string cursor can no longer
  reset pagination.
- `apps/studio/src/features/editor/document-draft-repository.ts:2958-2973`
  maps malformed string cursor syntax to typed `validation_failed` before
  storage.
- `apps/studio/src/features/editor/document-draft-repository.test.ts:1811-1824`,
  `:1896-1916`, and `:1918-1954` cover malformed limits, state, top-level
  options, query, and cursor. The injected IndexedDB factory proves none of
  those paths opens storage. Awaited equality also proves the malformed options
  call resolves rather than rejects.

The repaired code distinguishes invalid caller input from browser-storage
failure and preserves omitted-cursor behavior without accepting runtime type
violations.

## Verified behavior

No other P0, P1, or P2 finding was found inside this bounded slice.

- `DraftListState` is an explicit `active | deleted | all` union with a runtime
  state guard.
- `cursorSummaries()` applies the state and normalized-name predicates before a
  row increments the `limit + 1` healthy-match count. Active and Trash pages do
  not filter a mixed limited page afterward.
- The `activityAt + documentId` compound index and exclusive upper-bound cursor
  produce stable descending traversal, including equal timestamps.
- Focused tests traverse every page for active, deleted, all, and normalized
  query modes. They cover the tie boundary at limits 1 and 2.
- Default `list({ limit: 50 })` remains active-only, preserving the mounted
  `useDocumentEditor` bridge behavior. The two mounted inspection call sites
  that need deleted rows now request `state: "all"` explicitly.
- Repository-wide source search found no remaining `includeDeleted` call site.
- Corruption recovery items and atomic conflict save-copy remain explicitly
  separate repository-gap slices. Their absence is not counted again here.

## Final gates

Using Node `v24.19.0`:

- `document-draft-repository.test.ts`: **1 file, 30 tests passed**.
- Studio `tsc --noEmit`: **passed**.
- This report's Prettier and diff checks: **passed**.

The prior broader gate also remains recorded as 2 files and 55 tests passed,
including the mounted persistence caller adaptations. The final focused gate
directly exercises the repaired repository boundary. This bounded list-state
slice is approved.
