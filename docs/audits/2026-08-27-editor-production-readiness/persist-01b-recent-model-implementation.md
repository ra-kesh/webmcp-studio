# PERSIST-01B Recent and Trash model implementation

Date: 2026-08-29

## Scope

Added the pure Recent and Trash projection in
`apps/studio/src/features/editor/recent-documents-model.ts` and its deterministic
test suite. This pass did not change the controller, provider, routes, Start
model, shell, or React components.

The projection consumes the approved provider and controller unions. It does
not read storage, schedule work, own timers, or generate previews.

## What the model owns

- Persistence opening, recovery-required, blocked, and unavailable states
  preempt collection state.
- Ready collection states retain the provider's migration status and storage
  warning. The list projection cannot erase migration cleanup information.
- Collection opening, empty Recent, empty Trash, recovery-only, no-results,
  ready, refreshing, loading-more, load-more failure, retained error, and
  terminal error remain separate union members.
- Retained pages keep their confirmation timestamp, age label, revision,
  staleness, rows, and pagination fact. Replacement and failed-refresh pages
  are explicitly stale until a new page is confirmed.
- Rows contain only `DocumentDraftSummary` facts. They preserve the full name
  and project origin, source, page count, output count, first-page dimensions,
  export formats, and activity time. Invalid activity timestamps produce
  `Activity date unavailable` with no `dateTime` value.
- Recent rows expose Open, Rename, Duplicate, Download JSON, and Move to Trash.
  Trash rows expose Restore only. No permanent-delete capability exists.
- Per-document editing, submitting, and failure state stays attached to the
  owning collection. The model also reports failures whose row is not visible
  so the shared alert region can remain truthful.
- Rename dialog state has its own document-keyed projection. A list refresh can
  remove the row without losing the typed input, captured record version,
  submitting state, or inline error. Different documents remain independent.
- Sticky recovery descriptors, persistent undo, captured announcements, and
  captured focus intents pass through without creating another UI state owner.
- A confirmed query miss remains `no_results` even when sticky recovery
  warnings exist. The same model retains those warnings beside the result
  state.
- Quarantine keys use the controller's stable quarantine identity. Replacing a
  generic recovery message with the exact repository failure does not remount
  the item.
- Virtualization becomes active at 49 rows. The threshold remains 48.

Formatting accepts an explicit locale, time zone, and current time. Activity
timestamps must be valid ISO date-times with a real calendar date. Valid offset
times normalize to the same canonical UTC instant used by the localized label.
Arbitrary fractional precision accepted by the repository normalizes to
JavaScript's millisecond precision. Repository-valid year 0000 stays valid, but
uses its canonical ISO value as the visible label because `Intl` otherwise
renders it as year 1 without an era. Tests do not depend on the machine locale
or wall clock.

One date formatter and one number formatter are constructed for a collection
projection, then shared by page age and every row. A 100-row projection does
not create formatters per row.

## Verification

- Focused Vitest: 1 file, 41 tests passed.
- Studio TypeScript check: passed.
- Scoped ESLint: passed.
- Scoped Prettier check: passed.
- Scoped `git diff --check`: passed.

The tests cover every collection union state with provider migration and
warning retention, provider precedence, long names, every origin and source
label, singular and plural facts, strict and offset timestamps, another locale,
arbitrary fractional precision, year 0000, invalid confirmation time, retained
page age, stable sticky recovery identity, query misses with and without
recovery, pagination, visible and hidden action failures, every submitting
action kind, concurrent rename reservations, Trash capabilities, undo, focus,
announcements, the 48 versus 49 row boundary, and formatter construction count
for 100 rows.

## Deliberate boundary

This model contains no body, envelope, thumbnail, preview URL, object URL,
cursor decoding, storage action, or component callback. React composition,
focus execution, semantic markup, keyboard flow, and virtual row measurement
remain in the collection component phase.
