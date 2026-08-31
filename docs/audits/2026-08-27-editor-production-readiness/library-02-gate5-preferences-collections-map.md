# LIBRARY-02 Gate 5 preferences and collections map

Date: 2026-08-31

Status: Steps 1-4 independently accepted; browser authority and preference UI integration are active

## Decision

Gate 5 needs a server-owned preference service, not more state inside the
template browser. D1 owns favorites, last use, collections, membership order,
revisions and idempotency receipts. The existing discovery controller continues
to own search, paging and stale-result rejection. A separate preference
controller owns preference mutations and their failures.

This split lets Gate 5 start without editing the active Gate 4B browser work.
The server contracts, migration, repository and framework-independent client can
land first. The route provider and shared browser receive the new ports only
after Gate 4B is committed.

## Step 1 result — shared preference and collection contracts

Status: **independently accepted on 2026-08-31; zero open P0/P1 findings**

- Added strict exact-item, preference, collection, snapshot, request, receipt
  and response-envelope schemas in the shared Document package.
- Added `recentOnly` to catalog query identity/filtering and mapped the Recent
  entry point to used items rather than merely sorting unused items last.
- Enforced preference/collection limits, exact reorder permutations, snapshot
  membership integrity, normalized-name uniqueness, timestamp chronology and
  operation-specific successful receipt semantics.
- Collection names count grapheme clusters, allow joiners inside visible emoji
  and reject control/default-ignorable-only names that would render blank.
- Focused preference, catalog and discovery evidence passes 35/35; both Document
  and Studio typechecks pass. Independent final review reports zero P0/P1.

## Step 2 result — durable preference and collection schema

Status: **independently accepted and committed on 2026-08-31; zero open P0/P1 findings**

- Added workspace/principal-scoped preference, collection, ordered membership,
  workspace-revision and idempotency-receipt tables in migration `0014`.
- Receipt claims bind the exact workspace, principal, target identity and
  revision, operation, idempotency key and canonical request hash. Retained keys
  cannot be reused for a different request after receipt cleanup.
- Foreign keys and delete behavior prevent stale claims from recreating deleted
  collection targets. Ordered membership changes use disjoint temporary
  positions so swaps and removal compaction remain atomic under the unique
  position constraint.
- The migration verifier covers replay, hash/operation/principal mismatch,
  deleted targets, reorder swaps, removal compaction, cascades and rollback.
  `verify-library-preferences-collections-migration.sh` passes, and the final
  independent review reports zero P0/P1.
- Checkpoint: `32659d6 feat: add library preference persistence schema`.

## Step 3 result — principal-scoped repository and HTTP authority

Status: **independently accepted and committed on 2026-08-31; zero open P0/P1 findings**

- Added atomic D1 preference, Recent and collection mutations with exact
  expected revisions, operation-specific item admission, replay-safe
  idempotency claims and typed receipts.
- Projection, preference snapshot and collection-detail reads use D1 batches so
  their workspace epoch and rows cannot come from different committed states.
- Reorder uses bounded `json_each` statements with 9 and 6 bindings regardless
  of collection size; the 500-member contract is covered without crossing D1's
  per-statement parameter limit.
- Added strict principal-scoped list/detail/preference/collection routes,
  canonical query/path/revision parsing, bounded JSON policies, private
  no-store responses and sanitized internal validation failures.
- Catalog projection masks durable favorite or collection state after the
  corresponding permission is revoked, while the scoped repository state
  remains available for cleanup.
- Focused repository and HTTP evidence passes, Studio typecheck passes, and two
  independent final reviews report zero P0/P1.
- Checkpoints: `bfbeca4 feat: persist library preferences and collections` and
  `0993f96 feat: expose principal-scoped library APIs`.

## Step 4 result — resilient browser preference owner

Status: **independently accepted and committed on 2026-08-31; zero open P0/P1 findings**

- Added a strict HTTP client, framework-independent preference controller and
  StrictMode-safe provider with one authoritative preference snapshot.
- Transport-unknown results retain the same idempotency key; reconciled 412
  retries use a new key only after newer authoritative state is ready.
- Late reads and mutation receipts cannot overwrite newer workspace,
  preference or collection authority. Ordered collection detail, add/remove
  membership projections and exact retry/failure state have one public owner.
- Cross-tab messages remain privacy-safe invalidation hints. Focus, visibility
  and explicit Refresh coalesce one follow-up authoritative read when another
  read is already active.
- Focused client/controller/provider evidence passes 31/31, Studio typecheck
  passes, and the final independent review reports zero P0/P1.
- Checkpoint: `01070ab feat: add resilient library preference client`.

## Step 5 entry — browser authority and shared surface

Status: **active**

The pre-implementation review found four boundaries that must close before
browser acceptance:

- the Studio `:3001` local D1 stores do not yet contain migration `0014`;
- concurrent first library requests can race localhost demo-session creation,
  so the route runtime must serialize initial preference and discovery access;
- an invalidated append cursor must start a retained replacement instead of
  retrying the dead cursor;
- template creation still resolves exact detail through the process-local
  adapter and must use the same server authority as visible discovery.

The active implementation is split into three non-overlapping checkpoints:
server-backed discovery and cursor recovery, route-owned runtime/session
bootstrap, and exact preference projection plus Favorites/Recent/failure UI in
the single shared browser. Collection management and post-create Recent remain
the following checkpoints.

## Evidence revisited

The map is based on the current code, not the earlier phase outline alone.

- `packages/document/src/library-catalog.ts` already has exact item identity,
  nullable preference projections, favorite and collection filters, recent
  ordering, query identity and revision-bound cursors.
- `packages/document/src/library-catalog-projections.ts` currently projects
  built-ins with `preferences: null`. Managed and local media projections use
  browser or media-record recency, but do not have durable library preference
  revisions.
- `apps/studio/src/content/library/catalog.ts` builds one immutable 58-item
  catalog and exact-detail map. It has no principal overlay.
- `apps/studio/src/content/library/library-discovery-adapter.ts` is deliberately
  asynchronous but still reads the process-local catalog. Its
  `list/getDetail/getTaxonomy` shape is the right seam for a server adapter.
- `apps/studio/src/content/library/discovery-controller.ts` already carries
  `favoritesOnly`, `collectionId` and recent order. It does not have a
  `recentOnly` predicate, so its Recent entry point currently means "sort all
  items by recent use" rather than "show items that were used". Gate 5 must fix
  that contract.
- `apps/studio/src/content/library/library-template-browser.tsx` already accepts
  an identity-only favorite callback. It has no mutation revision, pending
  preference state, collection picker or action-specific preference failure.
- `apps/studio/src/server/studio-principal.ts` supplies both `workspaceId` and a
  stable principal ID for local-demo and Cloudflare Access requests. Every
  library repository query must constrain both values.
- `apps/studio/src/server/media-asset-repository.ts` and migrations `0007` and
  `0013` provide the local patterns for bound SQL, workspace isolation,
  idempotency request hashes, exact receipts, conditional revision writes and
  race reconciliation.
- `apps/studio/src/server/media-asset-http.ts`, `api-boundary.ts` and
  `json-request-policy.ts` provide the existing principal, no-store, request ID,
  bounded-body and structured-error boundaries.
- `DocumentDraftRepository` and `RecentDocumentsController` treat
  `BroadcastChannel` messages as invalidation hints. An authoritative repository
  read remains the source of truth when delivery is missing or stale.

### Reference patterns kept

OpenPencil's `src/app/recent-files/store.ts` bounds and deduplicates identity.
Its `src/components/home/HomeWorkspace.vue` separates the recent index from
document sources, removes stale entries after an open failure, and keeps
loading, failure and empty states distinct. Its localStorage array is not
suitable for Studio favorites or collections because it has no principal,
expected revision or idempotency contract.

Loora's `packages/editor/src/lib/canvas-client.ts` sends mutations with an
expected revision. A realtime `canvas.changed` message carries only enough
information to schedule an authoritative refresh. Late revisions do not replace
local truth directly. Gate 5 should use the same rule for cross-tab library
hints. Loora also keeps high-frequency presence listeners separate from
document listeners. Studio should likewise keep preference state out of the
editor document subscription.

Neither reference provides a safe preference repository to copy. Studio needs
its own D1 schema because its item identity includes kind, immutable version,
workspace and principal.

## Ownership

```text
packages/document
  strict library preference, collection, request and response schemas

Studio Worker
  LibraryCatalogService
    immutable Studio catalog + principal preference projection
  LibraryPreferenceRepository
    D1 rows, revisions, idempotency and workspace/principal checks
  LibraryHttpHandlers
    authentication, parsing, errors, ETags and private no-store responses

/_studio route
  LibraryDiscoveryProvider
    query, results, cursor, exact detail
  LibraryPreferenceProvider
    favorites, recent-use receipts, collections, cross-tab invalidation

LibraryTemplateBrowser / future media browser
  presentation only, sends exact item intents to the two controllers
```

Favorite and collection mutations never enter document history. A completed
Create, Insert or Replace remains committed if recording recent use fails.

## Shared contract changes

Add `packages/document/src/library-preferences.ts` and export it from the
package index. Keep these contracts separate from the canonical document schema.

### Identities and state

Add strict schemas for:

- `LibraryItemIdentity`: `itemKind`, catalog ID and positive immutable version;
- `LibraryPreferenceState`: exact item identity, `favorite`, `lastUsedAt`,
  `collectionIds`, non-negative `revision` and `updatedAt`;
- `LibraryCollectionSummary`: collection ID, name, literal scope `workspace`,
  positive revision, item count, timestamps;
- `LibraryCollectionDetail`: summary plus ordered exact item identities;
- `LibraryPreferenceSnapshot`: non-negative `workspaceRevision`, all projected
  item preference states and the current principal's collection summaries;
- request bodies and receipts for set favorite, record use, create/rename/delete
  collection, add/remove membership and reorder members;
- response envelopes for catalog list, exact detail, preference snapshot,
  preference mutation, collection list/detail and collection mutation.

The existing `LibraryPreferenceProjection` remains the compact list shape. Do
not add its mutation revision to every Gate 4 fixture. The preference snapshot
owns revision tokens. The server overlays only `favorite`, `lastUsedAt` and
`collectionIds` onto catalog summaries.

Extend `LibraryCatalogQuery` with `recentOnly: boolean`, defaulting to false.
Include it in query identity and reject an item when it is true and
`preferences.lastUsedAt` is null. `LibraryDiscoveryController` sets it only for
the Recent entry point. This is a required correctness fix, but it should land
after the current Gate 4B files are committed so it is a small, reviewable
contract change.

Export the existing catalog ID schema or add one shared identity parser. Server
routes must not duplicate its regular expression.

### Limits

The first contract should cap a principal at 100 collections, one item in 100
collections, and 500 members per collection. Names contain 1 to 100 visible
characters after trimming and whitespace normalization. Reorder input must be a
duplicate-free exact permutation of the current member identities.

## D1 migration

Add `migrations/0014_library_preferences_collections.sql`. Applying it to a
remote database remains a separate deployment action.

### `library_workspace_state`

One row per workspace:

- `workspace_id` primary key and foreign key to `workspaces` with cascade;
- non-negative integer `revision`;
- ISO `updated_at`.

This revision is an invalidation epoch. It does not replace item or collection
revisions. Every committed preference, collection or membership change bumps it
inside the same D1 transaction.

### `library_item_preferences`

One row per principal and exact item version:

- `workspace_id`, `principal_id`, `item_kind`, `item_id`, `item_version` as the
  composite primary key;
- integer `favorite` constrained to 0 or 1;
- nullable ISO `last_used_at`;
- positive integer `revision`;
- `last_mutation_key` for atomic request ownership;
- ISO `created_at` and `updated_at`;
- workspace foreign key with cascade.

The absence of a row projects as favorite false, never used and revision zero.
Indexes cover favorite lookup and descending last use for one workspace and
principal.

### `library_collections`

- opaque `collection-...` ID;
- `workspace_id` and `owner_principal_id`;
- display `name` and deterministic `normalized_name`;
- literal scope `workspace`;
- positive integer `revision` and `last_mutation_key`;
- ISO timestamps;
- uniqueness on workspace, owner principal and normalized name;
- uniqueness on workspace and collection ID for the membership foreign key.

"Workspace" is forward-compatible storage language. The interface still says
"Your workspace" because the current product has no shared membership model.

### `library_collection_members`

- workspace and collection identity;
- exact item kind, ID and version;
- non-negative integer position;
- ISO `added_at`;
- primary key on collection and exact item;
- unique collection position;
- composite foreign key to the collection with cascade.

Add a reverse index on workspace plus exact item identity so list projection can
collect membership IDs without scanning every collection.

### `library_mutation_requests`

- workspace, principal and idempotency key as the primary key;
- operation name and SHA-256 request hash;
- validated result kind, result identity, result revision and compact response
  JSON;
- ISO `created_at`;
- workspace foreign key with cascade;
- checks for key, hash and JSON bounds;
- an index on creation time for later retention work.

The response JSON stores the exact successful receipt. A replay must parse it
with the current shared response schema before returning it. It must never be
reconstructed from a row that may have changed again.

Triggers on preference, collection and membership writes bump
`library_workspace_state`. Multiple bumps in one user action are acceptable
because this value is an epoch, not a user-visible edit count. A failed D1 batch
rolls back the target rows, trigger writes and receipt together.

## Repository design

Add `apps/studio/src/server/library-preference-repository.ts`. Every public
method takes `workspaceId` and `principalId` first. Missing and foreign
collections return the same `library_collection_not_found` error.

Required read methods:

- `readSnapshot(workspaceId, principalId)`;
- `readPreference(workspaceId, principalId, identity)`;
- `listCollections(workspaceId, principalId)`;
- `getCollection(workspaceId, principalId, collectionId)`;
- `readProjection(workspaceId, principalId)` for catalog composition.

Required mutation methods:

- `setFavorite(..., expectedRevision, favorite, idempotencyKey)`;
- `recordUsed(..., completedAction, completionId, idempotencyKey)`;
- `createCollection(..., name, idempotencyKey)`;
- `renameCollection(..., expectedRevision, name, idempotencyKey)`;
- `deleteCollection(..., expectedRevision, idempotencyKey)`;
- `addCollectionMember(..., expectedCollectionRevision, identity,
idempotencyKey)`;
- `removeCollectionMember(..., expectedCollectionRevision, identity,
idempotencyKey)`;
- `reorderCollectionMembers(..., expectedCollectionRevision,
orderedIdentities, idempotencyKey)`.

Deletion removes only the organizational collection. It never deletes a
template, media item, favorite or document.

### Item admission

Adding a favorite, recording use or adding membership first resolves the exact
catalog item through a `LibraryCatalogService`. The service rejects missing,
retired or unauthorized items. It never treats a favorite or collection row as
permission to use content.

Removing a favorite or membership may clean up an existing scoped row after an
item retires. This prevents permanent orphaned preferences. The removal path
still requires the exact stored identity and current expected revision.

### Atomic expected-revision and idempotency rule

Every logical request hashes the operation, target, expected revision and
canonical body. Transport retries reuse the same idempotency key. A user retry
after a reconciled conflict uses a new key and the latest revision.

The repository follows this order:

1. Read an existing request receipt. Return its parsed response when the hash
   matches, or return `idempotency_key_reused` when it does not.
2. Run one D1 batch. The target write includes workspace, principal and expected
   revision predicates and records `last_mutation_key`.
3. Insert the request receipt only when the target row contains that exact
   mutation key and result revision. A guarded constraint must abort the batch
   when the conditional target write changed no row.
4. After a thrown batch, read the request receipt once. This resolves a race in
   which another transport attempt committed the same key.
5. If no matching receipt exists, read the authoritative target and return a
   stable precondition or conflict error. Never report success from intended
   values alone.

The mutation-key guard matters. Checking only `revision = expected + 1` can
mistake another request's concurrent change for this request's result.

Delete and remove need an explicit claim before the row disappears. Collection
deletion first conditionally advances and claims the collection, inserts the
guarded receipt, then deletes only the claimed row in the same batch. Membership
removal claims the parent collection only when the exact member exists, deletes
under that claim, then stores the guarded receipt. A missing row cannot produce
a successful receipt merely because it is absent after the batch.

The first favorite mutation uses expected preference revision zero and inserts
revision one. Later favorite changes increment the same preference revision.
Collection membership and order changes increment the collection revision.

`recordUsed` is an idempotent merge rather than an expected-revision overwrite.
It stores the server time, never moves `lastUsedAt` backwards, increments the
preference revision once per new completion receipt, and uses the same guarded
request pattern.

Reordering first proves that the input is the exact current member set. Its D1
batch bumps the collection revision, moves existing positions into a temporary
offset range, writes the final positions, and stores one receipt. The temporary
range avoids SQLite unique-position collisions during swaps.

## Catalog composition

Add `apps/studio/src/server/library-catalog-service.ts`. It owns the join between
the immutable Studio catalog and principal state.

For each list request it should:

1. read the current principal projection and workspace revision;
2. clone compact base summaries only;
3. overlay favorite, last use and collection IDs for exact identities;
4. build a `LibraryCatalogIndex` with a revision such as
   `<base-catalog-revision>:w<workspaceRevision>`;
5. execute the existing strict query and return the existing compact page.

The workspace epoch in `catalogRevision` makes a cursor from before a favorite,
recent-use or collection change invalid. On an append revision mismatch, the
client starts a retained replacement instead of repeatedly retrying the dead
cursor.

Exact detail reads resolve the immutable detail first, then overlay the same
principal projection on `detail.summary`. They still run Gate 4's exact detail,
compatibility, permission and document-generation checks before document work.

At the current 58 items, a full principal overlay is bounded and simple. Gate 6
may replace the media side with indexed D1 search when managed media expands.
Gate 5 must not put full documents, source bytes, R2 keys or local Blob URLs in
D1 preference rows or catalog responses.

## HTTP routes

Add `apps/studio/src/server/library-http.ts` and thin TanStack route files under
`apps/studio/src/routes/v1/studio/library/`.

| Method and route                                                                                | Contract                                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /v1/studio/library/items`                                                                  | Strictly parses repeated query parameters into `LibraryCatalogQuery`; returns one compact `LibraryCatalogPage`. |
| `GET /v1/studio/library/items/$itemKind/$itemId/versions/$version`                              | Returns exact principal-projected detail or the same 404 for missing and unauthorized identity.                 |
| `GET /v1/studio/library/preferences`                                                            | Returns `LibraryPreferenceSnapshot` with item revisions and collection summaries.                               |
| `PUT /v1/studio/library/items/$itemKind/$itemId/versions/$version/favorite`                     | Body sets the boolean. Requires `If-Match: "library-preference-revision-N"` and `Idempotency-Key`.              |
| `POST /v1/studio/library/items/$itemKind/$itemId/versions/$version/used`                        | Body names `create`, `insert` or `replace` plus a stable completion ID. Requires `Idempotency-Key`.             |
| `GET /v1/studio/library/collections`                                                            | Lists only the current principal's collection summaries and workspace revision.                                 |
| `POST /v1/studio/library/collections`                                                           | Creates a collection with a bounded JSON body and required `Idempotency-Key`.                                   |
| `GET /v1/studio/library/collections/$collectionId`                                              | Returns ordered members for one authorized collection.                                                          |
| `PATCH /v1/studio/library/collections/$collectionId`                                            | Renames with `If-Match: "library-collection-revision-N"` and `Idempotency-Key`.                                 |
| `DELETE /v1/studio/library/collections/$collectionId`                                           | Deletes the collection only, with the same revision and idempotency headers.                                    |
| `PUT /v1/studio/library/collections/$collectionId/items/$itemKind/$itemId/versions/$version`    | Adds one exact member with collection `If-Match` and `Idempotency-Key`.                                         |
| `DELETE /v1/studio/library/collections/$collectionId/items/$itemKind/$itemId/versions/$version` | Removes one exact member with collection `If-Match` and `Idempotency-Key`.                                      |
| `PUT /v1/studio/library/collections/$collectionId/order`                                        | Accepts the exact ordered identity permutation with collection `If-Match` and `Idempotency-Key`.                |

The item list route accepts required `generation`, optional `search`, repeated
`itemKind`, `categoryId`, `useCaseId`, `formatFamily`, `orientation` and
`ownerKind`, plus `favoritesOnly`, `recentOnly`, `collectionId`, `order`,
`limit` and `cursor`. The HTTP parser maps those names into the shared query and
lets its strict schema normalize and bound them.

All JSON mutation routes get small explicit entries in
`studioJsonRequestPolicies`; reorder gets the largest bound. Every route uses
`requireStudioPrincipal`, prepared statements, shared Zod schemas,
`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and the
existing request ID/audit boundary.

Stable public errors:

- `invalid_library_request` with Zod issues, 400;
- `invalid_idempotency_key`, 400;
- `library_item_not_found`, 404;
- `library_collection_not_found`, 404 for missing and foreign;
- `library_preference_revision_mismatch`, 412;
- `library_collection_revision_mismatch`, 412;
- `library_collection_name_conflict`, 409;
- `library_collection_member_conflict`, 409;
- `idempotency_key_reused`, 409;
- existing authentication, rate-limit and internal retryable envelopes.

The API boundary's normalized route map must include these dynamic paths so
audit records do not contain raw item or collection IDs.

## Client and cross-tab reconciliation

Add these files after the server foundation:

- `library-preference-client.ts` for strict fetch, ETag, idempotency and request
  ID handling;
- `library-preference-controller.ts` for one snapshot, per-action pending state,
  exact errors, Retry and coalesced invalidation;
- `library-preference-provider.tsx` for one StrictMode-safe route owner;
- controller, client and provider tests beside them.

The controller never owns discovery pages. It exposes preference state and
commands keyed by exact item or collection identity. It sends one minimal
cross-tab hint after a committed mutation:

```ts
{
  schemaVersion: 1,
  type: "library-invalidated",
  workspaceRevision: 14,
  sourceSessionId: "browser-session-id"
}
```

The hint contains no item name, collection name, workspace ID, principal ID or
private source. Another tab ignores its own session and older revisions. A
newer revision schedules one authoritative preference snapshot read and one
retained discovery refresh. Missing `BroadcastChannel` support changes refresh
latency only. Focus, visibility return and explicit Refresh also compare the
authoritative workspace revision.

Late snapshot and mutation responses carry request generation. They cannot
replace newer state. A 412 response triggers an authoritative snapshot. The
controller does not silently overwrite a collection rename or order made in
another tab.

The discovery adapter changes from process-local reads to HTTP without changing
`LibraryDiscoveryDependencies`. Taxonomy stays the complete validated static
projection. The preference provider publishes a narrow invalidation signal that
the discovery provider turns into `refresh()`. React cards do not coordinate the
two controllers.

The browser derives an effective compact projection from the confirmed catalog
summary plus exact preference-controller state. This pure selector makes an
optimistic heart visible without mutating or republishing a discovery page.
After the authoritative discovery refresh arrives, both inputs agree again.

## Mutation and failure behavior

Favorite may update optimistically because it is one reversible boolean. Keep
the authoritative preimage until the receipt arrives. A failure restores only
the preference projection and leaves selection, preview, Create, Apply, Insert
and Replace usable.

Collection create, rename, delete, membership and reorder remain pessimistic.
Keep the prior confirmed list on screen with the failed row or dialog state and
Retry. Do not clear a collection because its mutation failed.

Use exact messages:

- "Couldn't add [item] to Favorites";
- "Couldn't remove [item] from Favorites";
- "Couldn't create, rename or delete [collection]" as the applicable action;
- "Couldn't add [item] to [collection]";
- "Couldn't remove [item] from [collection]";
- "Couldn't reorder [collection]";
- "[item] was used, but Studio couldn't update Recent".

Each failure keeps its request ID and retryability. A transport-status-unknown
Retry reuses the same idempotency key. A Retry after a 412 reconciliation uses
a new key and the latest expected revision.

Recent use is called only after the canonical action reports success:

- template Create after the distinct durable document record exists;
- media Insert after the named document transaction commits;
- media Replace after its one-step document transaction commits.

The Gate 5 contract does not currently count Apply or Assign field as recent
use. Do not add them silently. If that product rule changes, update the shared
completed-action enum and acceptance text first.

Recording Recent is a preference side effect. It cannot roll back a completed
document action. Its Retry carries the original completion ID and idempotency
key so it cannot double-increment recency.

## Gate 4 isolation and integration order

Do not edit the current uncommitted Gate 4B files while building the first four
steps below.

1. Add shared contracts and their package tests.
2. Add migration, repository and repository tests with a D1-compatible fixture.
3. Add catalog service, HTTP handlers and route-contract tests.
4. Add preference client/controller/provider tests with injected ports.
5. After Gate 4B commits, add `recentOnly`, switch the discovery adapter to the
   server, mount `LibraryPreferenceProvider` beside `LibraryDiscoveryProvider`,
   and add pending/error/collection controls to the single shared browser.
6. Wire successful Gate 4 template Create and later Gate 6 media Insert/Replace
   receipts to `recordUsed`.

The server and client preference owners must not import
`library-template-browser.tsx`, `use-document-editor.ts` or the Gate 4 action
dialog. Integration moves exact identities and completion receipts across ports.

## Test map

### Shared schemas and catalog

- strict parse and unknown-key rejection for every request and response;
- duplicate identity, collection and reorder rejection;
- `recentOnly` excludes never-used items and participates in query/cursor
  identity;
- projection overlays exact versions only and cannot change permission,
  compatibility, provenance or selectability;
- catalog revision changes with workspace revision;
- an old cursor fails after a preference mutation;
- list and detail never expose canonical documents, source bytes or private
  locators.

### Migration and repository

- fresh migration schema, foreign keys, checks, indexes and cascades;
- workspace and principal isolation on every read and write;
- absent preference is revision zero; first mutation becomes revision one;
- favorite/unfavorite exact expected revision;
- last-used monotonic merge and one increment for a replayed completion;
- create, rename and delete collection;
- add, duplicate-add, remove and missing-remove member behavior;
- reorder exact permutation, swap safety and stable positions;
- same key/same hash exact replay;
- same key/different hash conflict;
- concurrent same-key race resolves one receipt;
- concurrent different-key expected-revision race has one winner;
- target-write failure leaves no receipt or workspace-revision bump;
- malformed stored receipt fails closed;
- retired-item cleanup does not restore item usability.

### HTTP

- principal workspace and principal ID reach every repository call;
- foreign and missing collections share the same 404;
- repeated list parameters and cursor limits parse correctly;
- malformed body, missing content length, missing If-Match and missing
  idempotency key fail before repository access;
- ETag and response schema match returned revisions;
- private no-store and request ID headers appear on reads and mutations;
- API audit path normalization removes all dynamic identities;
- body bounds, rate limit and retryable errors use the existing envelope.

### Client controller and provider

- optimistic favorite success, failure rollback and item usability;
- separate exact failure for every preference action;
- transport-unknown Retry reuses one idempotency key;
- precondition Retry uses the reconciled revision and a new key;
- stale reads and mutation responses cannot overwrite newer state;
- same-tab hints are ignored; newer cross-tab hints coalesce one authoritative
  refresh; malformed hints are ignored;
- missing BroadcastChannel and channel errors do not block reads or writes;
- StrictMode creates one retained runtime and closes it after the final lease;
- preference changes do not rerender the editor document owner;
- a failed recent-use write never rolls back Create, Insert or Replace.

### Mounted and browser acceptance

- favorite, reload and find in Favorites;
- create a collection, add an item, reload and find it through the collection;
- reorder members and preserve order after reload;
- two tabs reconcile favorite, rename and membership changes without stale
  overwrite;
- an old Load More cursor becomes a retained replacement after another tab's
  preference change;
- document actions remain available during and after each preference failure;
- compact keyboard and touch flows can favorite, open collection controls,
  retry and dismiss errors without nested interactive controls.
- a warm 50-summary Worker list stays under the phase's 200 ms local budget and
  reports its fixture and measured result.

## Gate 5 exit

Gate 5 is ready for independent review only when durable preference and
collection state survives reload, every mutation has exact expected-revision and
idempotency behavior, Recent excludes never-used items, cross-tab messages are
hints followed by authoritative reads, preference failure never disables
content use, and the shared browser reports the exact failed preference action.

Do not mark the gate closed from schema tests or happy-path cards alone. D1 race,
HTTP, controller, two-tab and post-document-action recency evidence are all
required.
