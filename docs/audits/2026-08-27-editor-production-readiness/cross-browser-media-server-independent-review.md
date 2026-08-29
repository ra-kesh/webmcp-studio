# Cross-browser media Slice 2 independent server review

Date: 2026-08-30

Reviewer: independent code-review agent

Scope: row 10, Slice 2 — shared promotion transport schemas, D1 mapping,
managed-media repository integration, multipart promotion, exact and batch
resolution routes, API normalization, migration verification, and focused
tests.

Final verdict: **ACCEPT — no remaining P0/P1 in the reviewed Slice 2 code.**

This verdict does not close row 10. The browser promotion owner,
active-document persistence, admission recovery, two-browser evidence, and
deployed D1/R2 evidence remain later slices in
`cross-browser-media-phase-entry.md`.

## Evidence reread

Before reviewing code, I reread the complete 704-line
`cross-browser-media-phase-entry.md`, including its identity, D1/R2, HTTP,
idempotency, cancellation, status-race, browser, and deployed acceptance
contracts. I also reread the prior server render-admission, deployed-storage,
and API security/error phase records.

The implementation was reviewed from the changed source and tests rather than
from an implementation summary:

- `packages/document/src/media.ts` and `packages/document/test/media.test.ts`;
- `apps/studio/src/server/media-assets.ts`;
- `apps/studio/src/server/media-asset-repository.ts` and its tests;
- `apps/studio/src/server/media-asset-http.ts` and its tests;
- JSON request policy, API path normalization, the three TanStack routes, and
  generated route tree;
- `migrations/0012_media_asset_local_promotions.sql`; and
- `scripts/verify-media-asset-local-promotions-migration.sh`.

## Accepted contract

- One strict local-asset ID schema is shared by document references, server
  input, browser storage, and promotion responses. Promotion and batch
  response schemas are strict and reject private or incoherent fields.
- `(workspace_id, local_asset_id)` is the mapping identity. The mapping joins
  `media_assets` for the authoritative hash, has the required composite
  workspace/asset foreign key with restricted asset deletion, and has the
  reverse workspace/asset index. The content hash is not duplicated.
- Exact and batch reads are workspace-scoped. Batch input is 1–100 distinct
  aliases and output is rebuilt in request order, including explicit unmapped
  entries. Ready and archived assets remain distinguishable and archived
  assets are non-selectable.
- Promotion computes request identity as
  `sha256("local-promotion\0" + localAssetId + "\0" + upload.requestHash)`.
  This binds the idempotency key to both the route semantics and alias while
  retaining the server-authoritative upload hash, media type, dimensions, and
  bytes.
- Existing alias/hash and idempotency conflicts are checked before R2 work.
  New objects use the existing deterministic workspace/content R2 key. New
  asset, mapping, and request rows are one D1 batch; content-deduplicated
  adoption batches mapping and request together. Race losers never delete the
  deterministic R2 object.
- Retained storage accounting now includes archived assets. New assets settle
  their exact byte delta; deduplication, replay, and archived restoration
  settle zero.
- Multipart handling follows authentication, request headers, idempotency-key
  validation, storage/admission lookup, and capacity reservation before
  `formData()`. The existing authoritative byte inspection remains in force.
- Exact lookup and batch resolution use private/no-store responses. Strict
  response parsing prevents R2 keys, object URLs, signed URLs, data URIs, or
  bytes from entering the public response. The global API boundary supplies
  request IDs, canonical errors, and workspace/principal audit identity.
- API normalization recognizes promotion routes before the generic managed
  asset route and hides exact alias values.

## P1 findings found and repaired during review

### 1. Valid `resolve` alias was shadowed by the static batch route

The shared local ID schema permits the literal `resolve`, while TanStack route
selection gives `/local-promotions/resolve` to the static route. Initially that
file exposed only POST, so exact GET recovery for a valid alias could not reach
`$localAssetId`.

Repair: the static route now handles GET by delegating the literal `resolve`
alias to exact lookup and retains POST for batch resolution. API audit
normalization is method-sensitive: GET is recorded as the hidden dynamic alias
route, while POST keeps the static resolve identity. Regression coverage
protects both forms.

### 2. Archived restore could commit mapping/request and then report failure

Two requests can observe the same archived content before one restores it. A
later D1 batch may legitimately report `0` changes for the conditional restore
while still committing a new exact mapping and request row. The initial code
called the exact-change assertion after the batch and threw even though the
authoritative state had committed.

Repair: a non-exact restore result now rereads the exact workspace alias and
idempotency request, verifies content hash and managed asset identity, and
accepts only that authoritative committed state. Missing mapping/request or
identity drift still fails closed. Tests cover the `0/1/1` adoption and a
false-adoption case with the request authority absent.

### 3. Archive winning after restore was treated as an internal failure

Both the reconciliation and ordinary post-batch read initially required the
asset to remain `ready`. A valid archive could win immediately after the
restore batch, leaving a committed mapping, request, and retained bytes but
causing a false server error. That contradicted the phase rule that an exact
promotion mapping may recover an archived asset.

Repair: every post-batch path now validates exact alias, content hash,
idempotency request, and managed asset identity while accepting the joined
authoritative status (`ready` or `archived`). Tests cover archive winning after
both exact and non-exact batch results and confirm archived remains
non-selectable.

## Verification run

Using Node 24.19.0 where Vitest/Vite requires it:

- Studio focused server slice: **52/52 passing** across repository, HTTP, API
  boundary, and JSON request-policy tests.
- Document shared-media contract: **8/8 passing**.
- Document typecheck: passed.
- Studio typecheck: passed.
- Real SQLite migration verifier: passed after applying migrations 0001–0012;
  it checks the composite primary key, composite FK enforcement, reverse
  index, required columns, alias constraint, cross-workspace rejection,
  restricted managed-asset deletion, and `foreign_key_check`.
- `git diff --check`: passed for the shared working tree at review time.

## Explicitly deferred evidence

These are not Slice 2 code blockers, but they remain mandatory before row 10
can close:

- Repository unit tests use a deliberately small D1 fake. The real-SQLite
  verifier proves the migration and constraints, while Cloudflare D1 batch and
  race behavior still needs the deployed Slice 6 exercise.
- Peak multipart/FormData memory, disconnect behavior, request-audit
  correlation, and real R2 object metadata require the approved deployed gate.
- Migration 0012 was not applied to production during this review. Production
  mutation remains subject to the existing explicit deployment authorization
  and ordered preflight.
- The browser journal/owner, critical draft flush, admission migration,
  missing-byte UX, two-context Playwright journey, and cross-browser
  export/publication are Slices 3–6 and are outside this server-slice verdict.
