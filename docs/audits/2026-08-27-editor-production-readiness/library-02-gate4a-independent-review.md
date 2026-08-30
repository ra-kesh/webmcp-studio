# LIBRARY-02 Gate 4A independent review

Date: 2026-08-31

Status: accepted; zero open P0/P1 findings

## Reviewed boundary

- `apps/studio/src/content/library/discovery-controller.ts`
- `apps/studio/src/content/library/library-discovery-adapter.ts`
- `apps/studio/src/content/library/library-discovery-provider.tsx`
- `apps/studio/src/content/library/library-template-actions.ts`
- the matching focused tests and `/_studio` route ownership

The review re-read the Gate 4 migration map and the retained OpenPencil/Loora
reference decisions before inspecting the implementation. It evaluated actual
code rather than rendered screenshots.

## Findings and remediation

1. **P1 — catalog revision refresh:** a same-query replacement rejected a
   legitimate new catalog revision. Replacement now accepts the new revision
   while append remains pinned to its confirmed generation, query identity,
   revision and cursor. A stale old-revision append cannot land.
2. **P1 — search focus ownership:** debounced search and automatic detail
   selection emitted focus intents that could steal focus from the search
   field. Search now preserves focus and item focus is explicit opt-in.
3. **P1 — caller-owned confirmation identity:** confirmation trusted fields on
   the returned action object. Exact identity is now canonicalized and an
   object-identity authority rejects caller-resynthesized actions.
4. **P1 — shared mutable snapshot:** the private pending record shared a nested
   snapshot reference with its returned action. Confirmation now compares the
   current editor against an unexposed immutable scalar fingerprint containing
   document ID/revision, document/source/review generations and quotation-source
   presence.
5. **P1 — lease-only rerenders:** discovery state and lease lifecycle shared a
   changing context. The provider context is now stable; only
   `useLibraryDiscovery` subscribes through `useSyncExternalStore`, while a
   lease-only consumer remains render-stable during query changes.

The adjacent pending-search/filter scheduling inefficiency was also removed:
filter, order and entry-point changes cancel the debounce and fold the raw
search into one replacement request.

## Evidence

- Focused controller, adapter, action, provider and route suite: 33/33.
- StrictMode activation/deactivation/disposal and lease-only render stability
  are mounted regressions.
- Final independent re-review: zero open P0/P1 findings.

The shared Start/editor browser, exact editor cutover and 49-item virtualized
path remain Gate 4B and are not claimed by this acceptance.
