# PERSIST-01B atomic conflict-copy independent review

Date: 2026-08-28
Final re-review: 2026-08-28
Verdict: **APPROVE**
Scope: `saveConflictAsCopy`, conflict schema/event compatibility, resolved-row preservation, and focused repository tests only

## Executive result

No P0, P1, or P2 finding remains in the reviewed scope. The body, metadata, and conflict resolution are committed in one IndexedDB transaction; retries converge on the stored result; both same-target and different-target concurrency are serialized correctly; transaction abort and quota failures roll back all three writes; legacy save-copy rows remain unresolved-without-proof; and the old public `resolveConflict("save_copy")` path is rejected.

The final test revision closes all three former P2 acceptance gaps. The new tests exercise the preflight-to-write replacement race, oversized stored-candidate rejection, and the additive `conflict_resolved` BroadcastChannel parser matrix. The exact three-test gate passes under Node 24.

## Final finding disposition

### Former P2-1: Closed

`document-draft-repository.test.ts:979-1065` interposes the second database open, replaces the same unresolved conflict after the readonly preflight, and then resumes the operation. It asserts `stale_conflict` with the replacement row, no requested target, and byte-equivalent preservation of the replacement conflict. This directly exercises the in-transaction re-read and expected-candidate comparison.

### Former P2-2: Closed

`document-draft-repository.test.ts:1506-1554` seeds a structurally valid conflict whose stored candidate exceeds `DRAFT_MAX_ENCODED_BYTES`. It asserts typed `validation_failed`, no target document, and unchanged conflict evidence. This is the contract's oversized stored-candidate branch.

### Former P2-3: Closed

`document-draft-repository.failures.test.ts:965-1090` now sends valid foreign reload and save-copy `conflict_resolved` events, rejects incompatible result-ID/resolution combinations and a missing conflict ID, preserves observer isolation, and continues through channel post/close behavior. These cases directly exercise the additive parser branch instead of relying on local event construction alone.

## Code review evidence

- `parseConflict` normalizes an absent legacy result field to null and distinguishes unresolved, reload, modern save-copy, and legacy save-copy states (`document-draft-repository.ts:899-966`). Explicit modern `save_copy` plus null result does not pass as legacy.
- `#conflictIdForWrite` reuses only a missing or unresolved preferred row and allocates a fresh key for every parseable resolved row (`document-draft-repository.ts:1411-1431`). All three conflict producers call it: migration at line 1696, save at line 1897, and deletion-state CAS at line 2650. No direct producer remains that can overwrite a resolved preferred row.
- `saveConflictAsCopy` validates and admits the stored candidate before writing, captures one copy timestamp, derives the copy body and summary, then re-reads the conflict and target in one `readwrite` transaction across `draft-body`, `draft-meta`, and `draft-conflicts` (`document-draft-repository.ts:2226-2561`).
- Replay follows `resolutionDocumentId`, ignores a retry's different target ID, validates the winning body/metadata pair, performs no write, and emits no event (`document-draft-repository.ts:2436-2472`).
- New copy writes schedule body, metadata, and resolved conflict in the same transaction and await commit before publishing `saved` followed by `conflict_resolved` (`document-draft-repository.ts:2513-2552`).
- `resolveConflict("save_copy")` returns `validation_failed` before storage. Reload resolution writes `resolutionDocumentId: null`, commits, then publishes (`document-draft-repository.ts:3733-3790`). Search found no production caller composing `create()` with save-copy resolution.
- Existing deterministic tests cover exact candidate projection and event order, missing and initially stale conflicts, preflight replacement, same-target concurrency, different-target concurrency, replay after reopen, old-path rejection and reload, legacy rows, valid/corrupt targets, candidate hash corruption, oversized candidate rejection, and preservation of a resolved row against a later `save()` conflict. Abort and quota rollback remain covered in `document-draft-repository.storage-failures.test.ts`.

## Gates run

Node 24 was forced through the bundled runtime.

```text
bun --filter @webmcp/studio test -- \
  src/features/editor/document-draft-repository.test.ts \
  src/features/editor/document-draft-repository.failures.test.ts \
  -t "replaced between conflict-copy preflight|oversized stored conflict candidate|BroadcastChannel construction"

2 files passed; 3 tests passed; 52 skipped.
```

This final re-review intentionally did not reopen route, list, or quarantine scope. The atomic conflict-copy implementation and its three formerly missing acceptance boundaries are approved.
