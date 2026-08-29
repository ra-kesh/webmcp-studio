# TEMPLATE-01 browser acceptance

Date: 2026-08-29

Status: **complete for the local routed product boundary**

## Phase entry revisited

Before running the browser gate, the phase reread TEMPLATE-01 in the feature
parity matrix and production backlog, WF-02 in the workflow audit, the
reference adopt/avoid matrix, the current template panel and lifecycle code,
and the actual local Canva-clone create-from-template flow. The retained
contract remains:

- Canva supplies the discoverable template-led start pattern.
- The local Canva clone confirms that template choice creates a distinct
  project before navigation.
- Studio retains canonical validation, immutable catalog versions, explicit
  apply impact, source-aware history, and routed durable persistence instead
  of copying raw `loadJSON` replacement.

## Browser evidence

The healthy-host run exercises the actual start surface, canonical document
route, and IndexedDB `draft-body` store rather than the retired single-draft
localStorage path.

1. The start surface exposes five renderer-derived previews before the sample
   document is opened.
2. The editor catalog exposes the same five previews and filters `cinematic`
   to Midnight Film without leaving a false Editorial one-pager result.
3. Applying Bold square announcement shows the exact six-to-one page impact
   and quotation-disconnection warning before mutation.
4. The durable record keeps the current document ID, stores the one-page
   document, clears the quotation snapshot, and records
   `bold-square-announcement@1`.
5. One Undo restores six pages, the quotation snapshot, and
   `quotation-editorial-olive@1`.
6. Create new settles and flushes the current durable document without showing
   the obsolete destructive replacement warning. It creates a remapped
   document and page identity, navigates to the new canonical route, persists
   `editorial-one-pager@1`, clears quotation data, and starts with no inherited
   Undo. The exact prior IndexedDB record remains unchanged. Session-only work
   still receives an explicit warning because no second durable record can be
   promised while storage is unavailable.
7. At 900 by 800, the compact Document dialog exposes the same catalog. A
   source-backed Midnight Film style explains its non-destructive scope and
   remains enabled.
8. The quotation-restyle journey inserts and directly edits a Body text node,
   adds Page 7, and applies Midnight Film. Structure and non-visual content are
   unchanged, visual keys change, revision advances exactly once, and one Undo
   restores the exact prior document and source context.

## Result

- `design-template-catalog.spec.ts`: **2/2 passed**
- `quotation-template-preservation.spec.ts`: **1/1 passed**
- Combined: **3/3 passed** with one worker against `http://localhost:3001`
- Studio TypeScript: passed
- Focused ESLint: passed
- Transition coordinator and WebMCP mutation regressions: **13/13 passed**
- Prettier and `git diff --check`: passed

## Independent review

The independent reviewer rejected two earlier candidates. The first accepted
an obsolete single-draft replacement dialog even though PERSIST-01B creates a
second durable record. The second protected visible editor input but still
allowed registered WebMCP proposal and publication tools to mutate the retiring
document during an awaited create/route handoff.

The accepted repair settles and flushes before creation, installs one mutation
admission before the first await, retains it until route navigation resolves,
replaces the interactive editor with an `aria-busy` handoff surface, and
projects the same disabled reason into live WebMCP snapshots, proposals,
product commands, publication, and rendering. Direct editor proposal and
publication paths also check the admission to cover the pre-render interval.
Deferred failure restores interaction; deferred success remains locked through
navigation. The final independent re-review is **ACCEPT with no P0/P1**.

One nonblocking P2 remains recorded: a rejected client-side route navigation
can leave a non-actionable identity-loading surface even though the newly
created document is safely persisted.

This gate does not claim deployed catalog storage, cached raster previews, or
cross-renderer pixel identity. Those remain PERF-01 and CONFORM-01 boundaries.
