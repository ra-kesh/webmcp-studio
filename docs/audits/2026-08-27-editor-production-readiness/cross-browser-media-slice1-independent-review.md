# Cross-browser media Slice 1 independent review

Date: 2026-08-30

Reviewer role: independent code-level gate review

Status: accepted after repair

Ledger boundary: row 10, Cross-browser local media — Slice 1 only

## Decision

**Accept Slice 1.** No P0 or P1 findings remain in the reviewed boundary.

This acceptance is deliberately bounded. It establishes the canonical local-to-managed reference extractor, aggregate relink command, shared local-alias contract, and one-step history semantics. It does not claim that upload promotion, D1 alias mappings, the local operation journal, active-document persistence, admission-time recovery, two-browser evidence, or deployed evidence exists. Those remain later slices in `cross-browser-media-phase-entry.md`.

## Scope reviewed

The review began by reading all 675 lines of `cross-browser-media-phase-entry.md`. It then inspected every changed line and the adjacent field, validation, history, local-store, Review, and managed-command-accounting boundaries.

Reviewed product files:

- `packages/document/src/media.ts`
- `packages/document/src/schema.ts`
- `packages/document/src/commands.ts`
- `packages/editor/src/history.ts`
- `apps/studio/src/features/editor/local-asset-store.ts`

Reviewed test files:

- `packages/document/test/media-relink.test.ts`
- `packages/document/test/commands.test.ts`
- `packages/document/test/fields.test.ts`
- `packages/editor/test/history.test.ts`
- `apps/studio/src/features/editor/local-asset-store.test.ts`

Relevant adjacent implementation checked:

- `packages/document/src/fields.ts`
- `packages/document/src/validation.ts`
- `apps/studio/src/features/editor/use-document-editor.ts`
- `apps/studio/src/features/editor/studio-session-history.ts`
- `apps/studio/src/features/editor/managed-asset-command-accounting.ts`
- `apps/studio/src/features/editor/review-journal.ts`
- `packages/webmcp/src/registration.ts`

The review attempted to falsify:

- atomic identity-only mutation;
- stable path extraction after collection reordering;
- local and managed source/ID coherence;
- field-default and field-current migration;
- source-bound image projection;
- preservation of every non-identity property;
- stale-preflight rejection;
- exact replay behavior;
- one-entry history, Undo, and Redo;
- truthful behavior when the history byte budget cannot retain an entry.

## Initial findings and reproductions

### P0 — Canonical field binding could create a local identity the relink command rejected

Initial behavior:

1. Add an asset field whose value is `asset:local/replacement-local`.
2. Bind that field to an existing image's `src` property.
3. The existing `applyValue` implementation changed the image `src` but changed `assetId` only for managed sources.
4. The resulting document remained admitted with:
   - `src: asset:local/replacement-local`
   - the image's previous `assetId`
5. `assetReferenceKeysForSource` correctly found the node, field default, and field current paths.
6. `relink_asset_references` then rejected the document as an incoherent local identity.

This falsified the required bound-field exit gate: a canonical Studio command could create a document that the promotion command could not migrate.

The independent reproduction used `renderConformanceDocument` and the public `add_field`, `bind_field`, and relink commands under Node 24. Before repair it ended with:

```text
boundSrc: asset:local/replacement-local
boundAssetId: asset-conformance-cover
documentStillAdmitted: true
relinkError: Image image-cover has an incoherent local identity
```

Repair:

- `packages/document/src/commands.ts` now derives a projected image identity from either `managedAssetIdFromSource(src)` or `localAssetIdFromSource(src)`.
- Field application updates `assetId` and `src` together for both canonical managed and local sources.
- `packages/document/test/media-relink.test.ts` now covers `set_field` to a local source, exact projection to multiple bound nodes, and successful relinking afterward.

Independent post-repair reproduction:

```text
boundSrc: asset:local/replacement-local
boundAssetId: replacement-local
documentStillAdmitted: true
relinkError: null
relinkedSrc: asset:managed/asset-managedtarget001
```

Status: resolved.

### P1 — Malformed local image references could pass admission and disappear from extraction

Initial behavior:

- The new bounded alias schema applied to fields and the relink command.
- `sceneNodeSchema` still accepted any string as an image `src`.
- Document validation exempted every string beginning with `asset:local/` from the ordinary source-policy error.
- A node containing `src: asset:local/../escape` therefore passed `documentSchema` while `extractAssetReferences` ignored it because the strict source parser could not identify it.

The independent reproduction reported:

```text
malformedNodeAdmitted: true
extracted: 0
```

That was unsafe because a canonical-looking document could contain an unresolved local reference that neither promotion nor missing-media accounting could see.

Repair:

- `packages/document/src/schema.ts` now rejects malformed strings under both the local and managed identity prefixes.
- It also requires a valid local image's raw `assetId` to equal the ID encoded in `src`.
- Regression tests cover malformed and incoherent local node admission.

Independent post-repair reproduction:

```text
malformedNodeAdmitted: false
```

Status: resolved.

### P1 — The browser-local repository retained a second permissive alias contract

Initial behavior:

- `apps/studio/src/features/editor/local-asset-store.ts` exported a prefix-concatenating `localAssetSource` and a prefix-slicing `localAssetIdFromSource`.
- Stored metadata and `saveLocalAsset` required only a nonempty string ID.
- The repository could therefore persist or interpret `../escape`, while the new document-domain contract rejected it.

This contradicted the phase requirement that document references, the local repository, and future routes use one bounded local alias identity.

Repair:

- The local repository imports and re-exports the document package's canonical local helpers.
- Legacy and current metadata parsing use `localAssetIdSchema`.
- `saveLocalAsset` validates the alias before writing its metadata or Blob.
- Invalid retained legacy aliases enter the existing quarantine store instead of becoming usable document identities.
- Local-store regressions prove strict source construction, invalid-save zero-write behavior, and legacy quarantine.

Status: resolved.

### P1 — Relinking could rewrite an unrelated bound property

Initial behavior:

`applyParsedCommand` runs `applyFieldValues` across the complete document after every command. Canonical semantic validation checks binding references, type compatibility, and required values, but it does not require every bound node to be an exact live projection before command execution.

The independent reproduction created a document that passed `assertValidDocument` with:

- one direct local image to relink; and
- an unrelated text binding whose node text had drifted from the field current value.

Relinking the image succeeded but silently changed the unrelated text to the field value. Before repair:

```text
beforeText: Spacing   stays\nA deliberately long line wraps against the same canonical width.
afterText: Canonical
changed: true
```

That violated the non-negotiable identity-only invariant even though the target image migration itself was correct.

Repair:

- After checking target local identity and target source-binding projection, `relink_asset_references` now checks whether `applyFieldValues(document)` would change any existing bound node.
- If so, the command rejects before constructing or validating a candidate.
- The regression creates unrelated managed-image binding drift, asserts the stable error, and proves the input document remains byte-equal.
- The independent text-binding reproduction now rejects with:

```text
The document has unrelated field projection changes to resolve before relinking this asset
```

The unrelated text remains unchanged.

Status: resolved.

## Final implementation assessment

### Reference extraction

Accepted.

- `extractAssetReferences` inventories canonical local and managed references from image nodes, asset-field defaults, and asset-field current values.
- Keys use stable IDs rather than collection indexes.
- References carry page, output, binding, and projected-node context without placing that mutable context inside the optimistic key.
- Output, page, projected-node, binding, and final reference collections are sorted deterministically.
- Independently reversing node, page, output, and field arrays left the extracted key set unchanged.

### Aggregate command and atomicity

Accepted.

- `relink_asset_references` validates a strict local source and coherent managed target pair.
- It recomputes and compares the exact sorted source-reference key set.
- It rejects an empty source set, stale path set, malformed source, incoherent local node identity, incoherent target pair, stale source-bound projection, and unrelated binding drift.
- It changes matching field defaults and current values, direct image-node `src` and `assetId`, then projects bound image values in the same canonical command.
- It constructs one complete document and performs aggregate validation after the mutation.
- The complex multi-page fixture proves that node IDs, pages, outputs, stacking, groups, bindings, geometry, placement, masks, crop state, opacity, visibility, locking, decorative state, alternative text, and provenance remain unchanged.
- Ordinary `replace_image_source` binding guards remain unchanged.

### No-op and replay behavior

Accepted for the Slice 1 boundary.

- A stale direct command after the local source has already been replaced finds no source occurrence and rejects without a revision or history entry.
- This is the command behavior required by the phase contract.
- The later promotion coordinator must recognize the target-only state and skip command dispatch so an operation retry becomes an idempotent coordinator outcome. That coordinator is outside Slice 1.

### History

Accepted.

- The aggregate command receives the stable label `Make image available everywhere`.
- One command produces one history entry.
- Undo restores the exact pre-relink document.
- Redo restores the exact managed document.
- History is document-only and performs no repository or upload work during Undo or Redo.
- With `maxBytes: 1`, the mutation still commits but reports `undoable: false` and retains no false Undo entry.
- Existing mounted editor and session-history coverage already treats an unretained document commit as an Undo/Redo barrier, so the UI contract does not promise unavailable history.

### Shared local alias identity

Accepted.

- IDs are 1 to 128 characters.
- The first character is alphanumeric.
- Remaining characters are restricted to alphanumeric, period, underscore, colon, and hyphen.
- Document nodes, asset fields, relink commands, and the browser-local repository now share the bounded identity.
- Invalid legacy repository rows are retained only through quarantine, not admitted as usable document references.

## Final severity decision

### P0

None remaining.

The initial bound-field P0 was repaired and independently reproduced successfully.

### P1

None remaining.

Malformed node admission, local-store contract divergence, and unrelated binding mutation were repaired and independently retested.

### P2 follow-ons

These do not block Slice 1:

1. The later promotion coordinator must explicitly classify an already-target-only document as complete and skip dispatch. The command intentionally continues to reject an empty source set.
2. `localAssetSourceSchema` currently repeats the allowed-ID grammar used by `localAssetIdSchema`. Both live in the same module and current tests keep them aligned, but deriving both from one shared grammar constant would reduce future drift risk.
3. The later active-document slice still needs mounted-editor proof that the exact aggregate commit result, including `undoable: false`, is surfaced in promotion copy and followed by one critical draft flush.

## Verification evidence

All commands below ran with Node `v24.19.0`.

Focused domain, field, command, and history boundary:

```sh
bunx vitest run \
  packages/document/test/media-relink.test.ts \
  packages/document/test/commands.test.ts \
  packages/document/test/fields.test.ts \
  packages/editor/test/history.test.ts
```

Result: 4 files passed, 78 tests passed.

Local repository boundary, run from `apps/studio`:

```sh
bunx vitest run --config vitest.config.ts \
  src/features/editor/local-asset-store.test.ts
```

Result: 1 file passed, 22 tests passed.

Complete affected package suites:

```sh
bun run --filter @webmcp/document test
bun run --filter @webmcp/editor test
```

Results:

- document: 23 files passed, 211 tests passed;
- editor: 20 files passed, 309 tests passed.

Typechecks:

```sh
bun run --filter @webmcp/document typecheck
bun run --filter @webmcp/editor typecheck
bun run --filter @webmcp/studio typecheck
```

Result: all exited with code 0.

Repository hygiene:

```sh
git diff --check
```

Result: passed.

## Exact bounded claim

Slice 1 now proves that a canonical multi-page document can inventory every exact occurrence of one bounded local alias across direct image nodes, asset-field defaults, asset-field current values, and source-bound image nodes; reject stale, malformed, incoherent, or projection-drifted inputs before mutation; replace the complete reference set with one coherent managed identity without changing any non-identity property; and record that mutation as one truthfully bounded history operation with exact Undo and Redo when retained.

It does not yet prove that any local Blob is uploaded, that any D1 alias mapping exists, that retries are journaled, that a mounted editor flushes the relink durably, or that another browser can recover without IndexedDB bytes. Those claims belong to Slices 2 through 6 and remain open.
