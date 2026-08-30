# Cross-browser media managed-Recent receipt independent review

Date: 2026-08-30

Reviewer: independent code-review agent

Scope: row 10, Slice 4 managed-Recent server/client seam only. This covers
migration `0013`, the D1 use receipt, `MediaAssetRepository.markUsed`, the
`POST /v1/studio/assets/:assetId/used` HTTP contract, shared response schemas,
the browser repository client, route audit normalization, and their focused
tests.

Final verdict: **ACCEPT — no remaining P0/P1 in the reviewed seam.**

This verdict does not accept the rest of Slice 4. Mounted-editor anchoring,
relink history, the critical draft flush, durable journal progression, UI and
session races remain separate work and review gates.

## Material reread

Before reviewing implementation, I reread the complete frozen
`cross-browser-media-editor-relink-phase-map.md`, the complete cross-browser
phase entry and its Slice 1 through Slice 3B exit records,
`api-sec-error-01-phase-entry.md`, and the prior Slice 2 independent server
review. I also retrieved the current Cloudflare Workers best-practices and D1
binding documentation. The D1 documentation confirms that `batch()` executes
the prepared statements as one transactional sequence and rolls the sequence
back when a statement fails.

The review inspected the actual migration, verifier, shared schemas,
repository, HTTP handler, route normalization test, browser client and focused
tests. It did not rely on the implementation summary.

## Accepted contract

- `media_asset_use_requests` uses the workspace-global primary key
  `(workspace_id, idempotency_key)`. Its composite restricted foreign key keeps
  each receipt attached to an asset in the same workspace. The supporting
  index is exactly `(workspace_id, asset_id, used_at DESC)`.
- The repository derives the request hash as
  `sha256("media-used\0" + assetId)`. A key replay for the same asset returns
  the stored `used_at` and `result_revision`, even after another key advances
  the asset. Reusing the key for another asset returns the canonical conflict.
- One D1 batch updates `last_used_at`, `updated_at` and the asset revision, then
  inserts the receipt from the updated row. Both ready and archived assets are
  accepted. The update never changes status, and archived assets remain absent
  from selectable Recent results.
- Same-key races rely on D1 transaction rollback and reconcile through the
  workspace-scoped durable receipt. A committed mutation whose batch response
  is lost, and a committed receipt accompanied by misleading result counts,
  both return the stored receipt without a second revision increment.
- Authentication runs before the idempotency header or repository access. The
  endpoint requires the bounded shared key, returns a strict three-field
  receipt, carries the canonical request ID in `X-Request-Id`, and uses
  `private, no-store`. API audit normalization hides the concrete asset ID.
- The public schema rejects private fields. No R2 key, object URL, signed URL,
  content hash, byte count or asset bytes cross this response.
- The browser client distinguishes a generated ordinary-use key from a caller
  retained key. It rejects malformed retained keys before dispatch. A
  pre-aborted signal is definitive cancellation; any rejection after dispatch,
  408, 425, 5xx, malformed successful receipt, missing or invalid request ID,
  or wrong-asset receipt is an unknown outcome that retains the exact key.
- Canonical error identity requires a valid `X-Request-Id` equal to
  `error.requestId`. Missing, malformed or mismatched identities are not
  trusted as deterministic errors. A verified deterministic 409 retains its
  request ID for the journal.
- Managed-media listeners are notified only after the client validates the
  authoritative receipt. A throwing view subscriber cannot turn that durable
  success into an operation failure.

## P1 findings found and repaired during review

### 1. The required use-time index was built on creation time

Initial `migrations/0013_media_asset_use_requests.sql:28-29` indexed
`created_at DESC`, while the frozen contract requires `used_at`. This made the
declared receipt chronology and the supporting query order diverge.

Repair: `migrations/0013_media_asset_use_requests.sql:28-29` now indexes
`(workspace_id, asset_id, used_at DESC)`. The real SQLite verifier asserts
column order and descending direction at
`scripts/verify-media-asset-use-requests-migration.sh:58-59`.

### 2. Post-dispatch client failures could be reported as definite cancellation

The first client implementation treated an aborted fetch as
`media_use_cancelled`, and malformed or request-ID-invalid 2xx responses did
not preserve an unknown-commit identity. The Worker may already have committed
the receipt in each case.

Repair: `managed-media-repository.ts:290-382` checks a pre-aborted signal before
`fetch`, then classifies every transport rejection after dispatch, 408, 425,
5xx, malformed success and invalid success identity as
`media_use_status_unknown`. The error carries the retained idempotency key and
the verified request ID when available.

### 3. A valid-shaped receipt for another asset was accepted

Strict schema parsing alone did not prove that the response belonged to the
asset in the request path. The client could notify Recent and resolve with a
receipt for another managed asset.

Repair: `managed-media-repository.ts:359-382` now requires the receipt asset ID
to equal the parsed requested ID before notification. The wrong-asset
regression proves no listener is called.

### 4. Error request identity was not retained or parity-checked

Ambiguous errors discarded the server request ID, so the promotion journal
could not retain the trace required by the phase contract. A deterministic
error could also be trusted when its header and body identities disagreed.

Repair: `managed-media-repository.ts:69-178` carries a validated request ID and
explicit identity-validity bit. The `/used` path requires a valid header and a
matching canonical body ID before trusting a deterministic error. The active
owner checkpoints the resulting ID at
`active-local-asset-promotion.ts:500-504`.

### 5. Advisory listener failure could overwrite authoritative success

`notifyManagedMediaMutation` called listeners without isolation. A subscriber
exception after a valid receipt rejected the repository promise and made a
committed use look failed.

Repair: `managed-media-repository.ts:50-59` isolates each subscriber. Focused
coverage proves a throwing listener does not block other listeners or change
the successful receipt result.

## Verification rerun

Using Node 24.19.0:

- Focused Studio seam: **85/85 passing** across repository, HTTP, API-boundary
  and browser managed-media tests.
- Shared media schema: **9/9 passing**.
- Real SQLite migration verifier: passed after applying every migration through
  `0013`; it checks the primary key, required columns, exact index order,
  composite restricted foreign key, cross-workspace rejection, malformed-key
  rejection, asset-delete restriction and `foreign_key_check`.
- Scoped ESLint for every changed Studio server/client seam file: passed.
- Document package typecheck: passed.
- `git diff --check`: passed for the shared worktree.

The full Studio typecheck was also attempted. It reached the shared concurrent
Slice 4 work and reported one literal-widening error in
`active-local-asset-promotion.test.ts:213`, outside this receipt seam. It
reported no type error in the files accepted here. The parent Slice 4 gate must
rerun Studio typecheck after the concurrent active-editor implementation
settles.

## Evidence still outside this verdict

- Real Cloudflare D1 same-key races and committed-but-response-lost behavior
  remain part of the already frozen deployed evidence gate.
- This review does not prove the mounted editor calls `/used` only after exact
  durable draft read-back. That ordering belongs to the active-editor review.
- Browser crash injection after server commit and before journal completion
  belongs to the Slice 4 integration/browser gate.
- Migration `0013` was not applied to production during this review.
