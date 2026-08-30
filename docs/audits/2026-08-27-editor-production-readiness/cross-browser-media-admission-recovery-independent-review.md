# Cross-browser media admission and recovery — independent review

Date: 2026-08-30
Reviewer: independent code-review agent
Scope: row 10, Slice 5 admission, import planning, admission receipts,
cross-browser missing-byte recovery, mounted recovery durability, exact media
impact, and the local recovery UI.

## Final verdict

**ACCEPT**

The frozen Slice 5 tree has no open P0 or P1 finding in this review.

A document containing device-local image identities can now be classified
against exact browser-local state and the authoritative Studio mapping,
automatically migrated only when identity is proven, installed only by the
current route/session owner, and recovered from the mounted editor through one
canonical history transaction and an exact critical save. Interrupted mounted
recovery retains enough durable evidence to distinguish a precommit attempt,
the exact prepared history result, an exact committed result, and a later
durable head before replaying the stable managed-use receipt.

This verdict accepts Slice 5 implementation and focused local evidence only.
It does not close ledger row 10 and does not claim the deployed, real
two-browser, real-network, or real-Worker evidence reserved for Slice 6.

## Material reread

The review read the complete frozen
`cross-browser-media-admission-recovery-phase-map.md`, including its P0
prerequisites, ownership map, recovery choices, history/durability rules,
race/session fences, privacy boundary, focused evidence matrix, exit gate, and
Slice 6 exclusion. It also reread the accepted Slice 1 through Slice 4
independent reviews before evaluating the current production and test code.

The final-tree pass covered every changed Slice 5 production boundary and its
focused tests, including:

- `packages/document/src/media-admission.ts`, `commands.ts`, `schema.ts`, and
  the media admission/relink suites;
- `local-asset-store.ts` and `local-asset-promotion-client.ts`;
- `document-draft-repository.ts` and its dedicated admission receipt suite;
- `document-route-admission.ts`, the keyed document route, strict-mode
  persistence provider, and mounted route cutover tests;
- `document-import.ts` and import planning/acceptance tests;
- `mounted-media-recovery-repository.ts` and its complete transition/CAS test;
- `use-document-editor.ts`, especially the recovery reservation, prepared
  history checkpoint, critical flush, read-back, Recent reconciliation,
  startup replay, cancellation, and session gates;
- `asset-library-model.ts`, `asset-library-components.tsx`,
  `asset-library-dialog.tsx`, `inspector-sidebar.tsx`, and
  `studio-shell.tsx`; and
- the mounted recovery, persistence, media projection, route, focus, and DOM
  regressions added for this slice.

## Accepted contract evidence

### Canonical admission and exact identity

- `planLocalMediaAdmission` derives the alias set from the canonical aggregate
  extractor, preserves stable sorted identity, enforces the 5,000-alias bound,
  and refuses incomplete, reordered, malformed, or unavailable mapping facts
  instead of guessing that an alias is unmapped.
- Safe automatic migration requires a ready exact local hash or the explicit
  no-local-bytes relationship to a ready/archived managed mapping. A
  same-alias hash conflict remains unresolved and visible.
- The local-to-managed and local-to-local commands update the exact aggregate
  reference set across direct image nodes, field defaults, field current
  values, and bound projections. They reject reference drift and preserve
  non-identity document properties.
- Clear/remove recovery is expressed as one reviewed command batch. Required
  fields and unsafe locked/bound states are refused; optional default/current
  slots and their bindings/layers are cleared atomically.

### Browser-local state and private mapping

- Requested local inspection is bounded and ordered. It distinguishes ready,
  missing bytes, absent, quarantined, and unavailable without scanning the
  complete asset library or converting IndexedDB failure into absence.
- Ready records are rehashed before admission migration. Missing/absent state,
  metadata/blob shape, unavailable state, and the complete bounded sorted
  quarantine record set are compared again immediately before the local
  mutation. A same-code re-quarantine race is therefore still detected.
- Exact Blob restoration uses local-state/revision CAS. A stale local result
  changes neither the alias nor its forensic quarantine records.
- Mapping resolution is strict, private, same-origin, `no-store`, ordered, and
  chunked to the documented bounds. Response count, alias order, nested
  promotion identity, request identity, canonical errors, timeout, abort, and
  malformed success are all checked. Broadcast notification triggers an
  authoritative refetch rather than becoming mapping authority.
- Local paths, names, Blob bytes, object/R2 identity, hashes, mapping request
  IDs, and recovery journal details are not presented in the recovery UI or
  introduced into the public document/WebMCP contract.

### Admission draft transaction and route ownership

- Admission migration uses an exact draft-head CAS and writes the body,
  metadata, invalidated preview, preimage receipt, stable managed-use keys, and
  result identity atomically. Failure or cancellation cannot leave a partial
  receipt/body pair or an ordinary editing conflict row.
- Receipt decoding preserves restored audit metadata. Restore is exact-head
  only; an advanced head is retained unchanged. Keep can acknowledge a current
  verified nondeleted advanced head without rewriting it, but refuses while a
  required managed-use receipt remains unsettled.
- The route controller fences local inspection, mapping, hashing, migration,
  install publication, focus, and touch through one generation/abort owner.
  Its final local-state reread prevents a stale preflight from entering the
  non-cancellable migration.
- `touchOpened` occurs only after the exact admitted record has been installed
  through the route callback. The managed-use reconciler starts only from that
  exact admitted/touched head; stale, deleted, advanced, wrong-document, and
  failed-first-use outcomes cannot publish into a superseding route.
- The keyed document route resets recovery opt-out and confirmation state on
  document identity changes. A failed recovery preflight offers both Retry and
  an unchanged authoritative **Open without recovering images** path.

### Import planning and active-session safety

- Import validates bounded file content, JSON, schema, aggregate, and resource
  policy before mapping work. A valid document whose local Blob is absent is
  returned as an explicit media plan instead of being misclassified as a
  corrupt resource.
- Candidate document, source identity, exact media plan, and recovery manifest
  remain separate until explicit acceptance. Active-document acceptance
  rechecks session, document, content/history snapshots, and Review/crop/
  quotation-refresh state before creating one truthful import history commit.
- The review identifies each affected node, field default/current slot,
  binding, page, and output. Equal aggregate counts cannot hide a different
  alias or reference set.

### Mounted recovery transaction and crash windows

- A managed recovery reserves a durable intent before the document changes.
  It contains the exact source draft/content/history/operation anchors,
  expected source references, preexisting target references, managed identity,
  and stable Recent idempotency key.
- The pure history result is calculated without installation. The journal then
  records `history_prepared` with the exact result content snapshot, history
  snapshot, operation version, commit ID, and authoritative `undoable` value.
  Only after that durable checkpoint wins does the hook install the history,
  enter its critical phase, capture the draft, flush, and read the exact body
  back.
- Exact `committed` and `already_applied` receipts require source + 1 document
  and draft versions and the checkpoint content. `observed_later` requires a
  strictly later durable head, records that later content separately, and
  retains the original prepared transaction checkpoint. It does not fabricate
  a reopened history operation or promise a current-session Undo.
- Cancellation or ownership loss after intent/checkpoint but before history
  installation durably abandons the exact reservation. A stale owner cannot
  install or publish. If terminalization itself fails, document mutation is
  gated behind a visible Retry rather than silently continuing.
- Once history is installed, Cancel is refused and the action becomes
  **Finish saving** until the critical body/read-back/receipt sequence settles.
  Retrying does not relink or add another history entry.
- Startup discovery is itself a mutation/session gate. Pending precommit
  records are abandoned only after exact projection checks. A target-proven
  interrupted commit requires the prepared checkpoint before an exact or later
  document receipt can be synthesized; then `/used` replays the same stable
  key. Terminal conflict, abandoned, and complete records are excluded and
  bounded.
- Concurrent equivalent document-receipt writes adopt only the exact winning
  durable result. Cross-document, mixed-content, non-advanced, over-advanced,
  stale-revision, and nonequivalent writes are refused without altering the
  stored intent.

### Recovery choices and presentation truth

- **Use Studio copy** supports ready and retained archived mappings, explicitly
  confirms a different healthy device file, preserves any preexisting uses of
  the target managed image, and performs no second upload.
- **Locate file** validates type, size, dimensions, decoded pixels, and hash.
  An exact known hash restores the old local Blob and retains an explicit path
  to adopt the exact Studio copy. Different known bytes never overwrite the
  old identity; unknown trustworthy identity receives a new local alias.
- **Choose Studio image**, exact optional slot clear, and reviewed bound
  unbind/remove/clear use the same anchor, history, critical save, and stale
  state fences. Inspector unavailable aliases deep-link into the shared
  Document media workflow instead of acting on an arbitrary first node.
- Recovery rows expose named node, bound-layer, field default/current, page,
  and output impact with per-reference lock state. Completed cards become
  review-only only when the old source reference count is actually zero.
- Restore remains available until its repository result is known. Advanced
  head or unavailable-preimage outcomes preserve Download/Save-as-copy and
  Keep paths; a successful restore never exposes contradictory preservation
  actions.
- Progress uses native focusable controls and polite status/alert semantics.
  Precommit Cancel, postcommit Finish saving, route Retry/opt-out, exact impact
  review, and the 44 px compact action targets have mounted/DOM evidence.

## P0/P1 findings found and repaired during review

The implementation was not accepted on its first reviewed state. The material
P1 findings repaired before the final freeze were:

1. route admission could start managed-use reconciliation before exact editor
   installation and could block open on `/used`;
2. restored receipt metadata and advanced-head Keep/acknowledgement were not
   coherent, and Keep could discard a preimage while `/used` was unsettled;
3. final local-state CAS did not initially include exact quarantine membership
   and same-code re-quarantine races;
4. mounted recovery initially depended on an in-memory checkpoint and a
   transient Recent identity rather than a durable precommit operation;
5. the durable mounted receipt was not sufficiently bound to document,
   original result content/history, exact version advance, and the winning
   draft head;
6. cancellation/ownership loss after prepared-journal persistence could leave
   a live pending record or let a stale owner publish;
7. startup replay tried to infer the interrupted operation from a reopened
   history whose operation version resets, rather than an exact durable
   prepared-history checkpoint;
8. later-head reconciliation initially replaced original transaction truth
   instead of retaining it separately from the later durable body;
9. pending discovery failures did not gate ordinary mutations with a visible
   recovery path;
10. completed, abandoned, conflict, equivalent-concurrent, and response-loss
    journal transitions were incomplete or insufficiently bounded;
11. exact local/mapping/reference rereads, restored/local Locate behavior, and
    authoritative Broadcast refetch were incomplete at mounted action time;
12. default/current field slots, bound layers, projected uses, per-reference
    locks, and partial clear/remove read-back were not all represented or
    checked exactly;
13. postcommit UI could still offer Cancel, a completed relink could expose
    mutation actions, and Inspector could route a shared alias through a
    first-node shortcut;
14. Restore failure, advanced-head preservation, restored-success copy, and
    `preimage_unavailable` presentation did not initially agree with repository
    truth; and
15. the final mounted regression matrix lacked prepared-write cancellation,
    ownership loss, CAS response loss/adoption, abandonment failure/retry,
    later-head checkpoint, fresh-attempt nonce, equal-count import identity,
    and preservation-path evidence.

Every item above has code and focused regression evidence in the final tree.

## Independent evidence run

The reviewer ran the final frozen tree with the configured Node/Bun workspace
runtime:

- expanded Slice 5 domain, local repository, mapping client, draft receipt,
  route, import, model/UI, mounted recovery, persistence, strict-mode, and
  routing matrix: **18 files / 321 tests passing**;
- post-lint-delta route, local repository, and mounted persistence regression:
  **3 files / 137 tests passing**;
- `@webmcp/document` typecheck: passing;
- `@webmcp/studio` typecheck: passing;
- scoped ESLint for all 30 changed Studio TypeScript files outside the large
  editor hook: passing;
- direct lint of the repaired route/local/persistence files: passing; and
- `git diff --check`: passing.

The final gate also includes the separately recorded frozen-tree runs supplied
to the reviewer: the mounted/UI matrix at **159/159**, the route/domain/import/
local evidence at **152/152**, and the final repaired-delta matrix at
**150/150**. These overlap the independent 321-test run and are listed as
additional freeze evidence, not added together as a unique-test total.

## Nonblocking P2 cleanup

- Direct type-aware lint of `use-document-editor.ts` reports 24
  `no-unnecessary-condition` diagnostics. The review inspected the affected
  paths. Most are deliberate runtime guards around async operations, mutable
  refs, one-item network/repository responses, and session/unmount fences that
  TypeScript's local control flow treats as fixed; the remaining diagnostics
  are older quotation branches. They do not expose a P0/P1 runtime gap and
  should not be removed mechanically. A later focused hook decomposition can
  make these ownership boundaries easier for both TypeScript and reviewers to
  prove.
- `MountedMediaRecoveryRepository.recordHistoryPrepared` can adopt an
  identical checkpoint before its terminal-status check. Product callers use
  a fresh per-attempt operation ID and reject terminal records before reaching
  this transition, so the path is not reachable through the reviewed workflow.
  Moving the terminal barrier ahead of replay/adoption would nevertheless make
  the repository API defensively self-contained.

Neither item weakens the Slice 5 exit gate. Repository-wide lint/build, real
IndexedDB/browser behavior, deployed Access/Worker/D1/R2 behavior, network
payload inspection, and the true two-browser acceptance journey remain Slice
6 obligations.
