# Stuwiz refresh phase entry

Date: 2026-08-30

Status: implementation-ready for the bounded local model and persisted decision flow; blocked from a production Stuwiz integration claim until the upstream source contract is closed.

## Outcome

Ledger row 9 is not implemented today.

Studio can persist an exact quotation source, prove its SHA-256 fingerprint, bind it to a composer and template revision, save that sidecar with a draft, and preserve it through repository conflicts. It cannot reconcile a newer revision of that source with a document that a user has edited.

The current quotation import path is replacement, not refresh. It recomposes the incoming source, retains only the current document ID, replaces the complete document, installs the new source context, and clears Review. There is no source identity gate, impact preview, three-way comparison, preservation policy, explicit accept or reject decision, refresh conflict state, or refresh audit trail.

The bounded phase should add a separate quotation refresh domain around the current deterministic composer and draft repository. It must not turn Review into a source-sync engine, put source metadata in the canonical document, or introduce a generic collaboration architecture.

## Evidence revisited

This entry audit reread the row 9 requirement and the mandatory phase protocol in:

- `remaining-product-work-2026-08-29.md`
- `remediation-progress.md`
- `quotation-content-drift-audit.md`
- `review-02-phase-entry.md` and its independent review
- `loora-editor-reference.md`
- `openpencil-editor-north-star.md`
- `stuwiz-quotation-composition.md`

It traced the current quotation contract, fingerprinting, composer, template application, content migration, composition context, draft admission, repository, save controller, Review journal, editor owner, shell command route, transient quotation-composition API, and their tests.

The directly relevant Loora reference code was revisited for typed transactions, exact preconditions, separately persisted pending work, rebase conflicts, and refusal to replace a snapshot while local work is pending. Those are useful behavioral patterns. Loora's canvas transaction architecture does not replace Studio's document, quotation, Review, or repository ownership.

The Stuwiz `origin/staging` quotation contract and runbook were inspected read-only. The relevant quotation paths were unchanged between the local staging ref `9af78458` and `origin/staging` ref `8b79b190`. No Stuwiz file or database was changed.

## Current behavior

### Source and composition identity

`packages/document/src/quotation-contract.ts` validates a strict, render-ready `QuotationRenderPayloadV1` and computes a canonical SHA-256 fingerprint over the complete payload.

`apps/studio/src/features/editor/quotation-composition-context.ts` records:

- the exact source quotation ID and revision;
- the quote version and contract version;
- the exact source fingerprint;
- the composer ID and version;
- the immutable composition template identity.

`apps/studio/src/features/editor/current-draft-repository.ts` stores the exact source and composition context outside the canonical document. Draft admission rejects a known composition whose source, composer, or template identity does not match its sidecar.

This separation is correct and remains the foundation for refresh.

### Composition and appearance

`packages/document/src/quotation-composer.ts` is deterministic for a fixed source, composer, template, and font-metrics environment. It composes the entire document from the source.

Its document IDs are not semantic source identities. Pages are indexed, and node and group IDs are allocated positionally. Adding, removing, reordering, or repaginating source records can move an unchanged business item to different document IDs.

`packages/document/src/quotation-template-application.ts` applies a quotation palette to the current document without recomposing content. Its tests prove that content, geometry, user edits, and document identity remain intact. Appearance application must stay separate from source refresh.

### Import and editor ownership

`importQuotationFile` in `apps/studio/src/features/editor/use-document-editor.ts` currently:

1. validates or receives an incoming quotation payload;
2. composes a complete replacement document;
3. forces the replacement to use the current document ID;
4. creates a known composition context for the incoming source;
5. replaces the current document and source sidecar;
6. clears the Review journal; and
7. resets the page and selection.

The path allows a different quotation ID to replace the current draft in place. It does not compare source revisions or hashes, does not distinguish import from refresh, and does not preserve user changes.

Undo and redo do preserve the exact quotation sidecar associated with their document snapshots. That existing history ownership is appropriate for the final accepted refresh transition.

### Persistence and conflict recovery

`apps/studio/src/features/editor/draft-admission.ts` computes two useful identities:

- the content snapshot identity for canonical document content; and
- the draft snapshot identity, which also includes source context and Review.

`apps/studio/src/features/editor/document-draft-repository.ts` and `document-draft-save-controller.ts` already provide compare-and-swap saves, exact conflict candidates, reload of the stored head, and replay-safe save-as-copy. A source-only change therefore conflicts correctly with a concurrent draft change.

These primitives are sufficient for refresh persistence and cross-tab recovery once the refresh sidecar participates in draft admission, draft identity, conflict candidates, copies, and reloads.

### Review

`apps/studio/src/features/editor/review-journal.ts` records document `ChangeSet` operations. It does not own quotation source context and cannot atomically advance a source fingerprint with a document replacement.

Refresh may reuse Review's bounded-journal and explicit-decision lessons. It must not store refresh as an ordinary Review proposal. A refresh decision changes the authoritative source sidecar and can replace source-owned document structure, while Review applies document commands only.

### Studio API boundary

`apps/studio/src/routes/v1/studio/quotation-compositions.ts` authenticates a Studio principal and returns a transient composition. It does not retrieve or persist a versioned Stuwiz source, provide idempotency, record a refresh decision, or return the full identity needed for source audit. It is not a refresh endpoint.

### Stuwiz staging contract

Stuwiz currently has strong quotation-document controls:

- a quote row has `version`, `documentVersion`, `documentRevision`, and `documentSha256`;
- draft saves use the expected document revision as a compare-and-swap precondition and increment it;
- sent quotation snapshots and copied terms are preserved;
- preset-derived terms are not replaced after manual edits without explicit confirmation.

There are still contract gaps for Studio refresh:

- no authenticated Studio JSON source endpoint or adapter emits `QuotationRenderPayloadV1`;
- `documentSha256` hashes the normalized quotation document, while Studio fingerprints the complete source envelope;
- draft branding can be resolved from live organization state and can change without incrementing `documentRevision`;
- Stuwiz branding uses storage key, MIME type, and content hash, while Studio's v1 source currently uses `logoUrl`;
- Stuwiz draft documents can be incomplete, while Studio's source contract is strict and render-ready; and
- creating a quote revision creates a new quote row ID. Studio has no stable quote-series identity with which to prove that two row IDs belong to the same refresh lineage.

Consequently, equal Stuwiz document revisions do not yet prove equal complete Studio sources. A same-revision, different-full-source-hash result must be an integrity conflict, not an update.

## Defects that the phase must close

| Severity | Defect | Current evidence | Required result |
| --- | --- | --- | --- |
| Critical | Import silently destroys user work | `importQuotationFile` replaces the whole document | Refresh compares base, current, and incoming and never drops a user change silently |
| Critical | No source identity admission gate | No quotation ID, revision, or hash relation is checked before replacement | Refresh accepts only a proved same-lineage, monotonic candidate |
| Critical | Positional composition IDs are unsafe merge keys | Composer IDs depend on output order and pagination | Composer exposes a stable semantic trace without changing canonical output |
| High | No preview or explicit decision | Import applies immediately | Prepare and persist a pending preview; accept and reject are separate human actions |
| High | No source refresh audit | Only the latest source context is stored | Keep a bounded resolved decision log with before/after source identities and result identity |
| High | Refresh cannot survive reload | There is no pending refresh sidecar | Persist the exact pending proposal and restore it through all repository paths |
| High | Review cannot atomically advance source identity | Review contains document commands only | Give refresh its own typed state and apply source plus document together |
| High | Upstream revision omits full source inputs | Branding may change outside `documentRevision` | Gate live integration on a full-source version/fingerprint contract |
| Medium | Quote lineage ends at row ID | A Stuwiz quote revision gets a new row ID | Treat another row as replacement until Stuwiz supplies stable series identity |

## Bounded design contract

### Scope

The phase covers:

- preparing a refresh from an exact current source and an exact incoming source;
- validating source lineage and monotonicity;
- composing an old baseline and incoming baseline deterministically;
- producing a semantic three-way diff and impact summary;
- preserving user changes by a stated property policy;
- requiring explicit resolution for collisions;
- persisting one pending decision and a bounded resolved audit log;
- explicitly accepting or rejecting the whole incoming source;
- recovering stale previews, reloads, and repository conflicts; and
- exercising the model through fixture-driven unit, mounted, repository, and browser tests.

The phase does not cover:

- background polling or automatic acceptance;
- partial acceptance of an upstream source payload;
- live collaborative editing or a generic transaction engine;
- cross-row quote lineage without an upstream stable series identity;
- migration of legacy or unknown quotation composition contexts;
- changing quotation appearance during refresh;
- changing published or exported artifacts in place; or
- claiming a production Stuwiz connection before its endpoint, authentication, and full-source version contract exist.

### Admission matrix

Refresh preparation must use the persisted source context as the base, not an inferred document structure.

| Incoming relation | Result |
| --- | --- |
| No current known quotation composition | Block refresh; use an explicit import or replacement workflow |
| Different `quotationId` | Block refresh; use replacement or create a new draft |
| Same ID, same revision, same full source hash | No-op; there is nothing to preview or accept |
| Same ID, same revision, different full source hash | Integrity conflict; preserve current state and require a corrected source/version contract |
| Same ID, lower revision | Reject as stale or rollback input |
| Same ID, higher revision | Prepare a refresh preview |
| Another quote row alleged to be a later quote version | Block until a stable upstream series identity proves lineage |

`quoteVersion` is audit evidence, not a substitute for row lineage or source revision. The incoming payload must pass the strict Studio contract before it enters the refresh model. An incomplete Stuwiz draft is not silently normalized into a valid Studio source.

### Stable semantic trace

The composer must expose a side result that relates stable source keys and roles to the document elements it generated. A trace entry needs enough identity to distinguish, for example, a participant name, event row, package price, deliverable, payment milestone, terms block, and source-owned decoration, without relying on a positional node ID.

The trace is a merge aid, not canonical document content. It must satisfy these gates:

- composing through the traced API produces a canonical document byte-for-byte equal to the existing composer result;
- trace keys derive from source stable keys plus a bounded semantic role, never visible labels or array indices alone;
- each source-owned page, group, node, field, value, and binding that can change during recomposition is either traced or deliberately classified as composer-owned structure;
- duplicate trace keys and ambiguous ownership fail preparation; and
- if canonical composer output must change, the composer version is bumped and the compatibility consequence is handled explicitly.

Directly comparing `text-12` in two compositions is prohibited because it can represent different source content after pagination or ordering changes.

### Three-way refresh model

Refresh uses three exact inputs:

- **base**: recomposition of the persisted current source with the persisted composer and immutable composition template;
- **current**: the user's editable Studio document; and
- **incoming**: composition of the incoming source with that same composer and composition template.

For each traced source-owned semantic property:

| Current vs base | Incoming vs base | Result |
| --- | --- | --- |
| Equal | Changed | Use incoming |
| Changed | Equal | Preserve current |
| Equal or changed | Current equals incoming | Use the converged value |
| Changed | Changed differently | Collision requiring an explicit `keep Studio` or `use Stuwiz` choice |

The pure model returns either a no-op, an invalid-source result, an identity conflict, or a deterministic proposal containing the candidate document, impact counts, and unresolved collisions. It does not mutate editor state or persistence.

Accepting all collision choices advances to the complete incoming source identity even when a chosen Studio presentation or manual value is preserved in the resulting document. The recorded audit must make those exceptions visible. The implementation must never construct a partial upstream payload and claim its hash as accepted.

### Preservation rules

| State | Refresh rule |
| --- | --- |
| User edit to a source-owned property unchanged upstream | Preserve it automatically |
| User edit to a source-owned property also changed upstream | Require a per-collision decision |
| Source-owned value changed only upstream | Apply it in the candidate |
| User-added node or group outside the source trace | Preserve it if its page, parent, and references remain valid |
| User-added field, value, binding, or output | Preserve it if all referential and schema invariants remain valid |
| User deletion of source-owned content unchanged upstream | Preserve the deletion as a user edit |
| Upstream deletion of content the user also edited | Require an explicit collision decision |
| User artifact anchored to a removed or repaginated source page | Mark an anchor collision; do not guess a new page |
| Selection, zoom, open sidebar, and other transient UI | Do not include in source comparison or source audit |
| Active appearance palette | Keep the current active appearance; do not run template application as part of refresh |
| Published/exported artifact | Never mutate it; refresh creates a later draft state |
| Unknown or legacy composition context | Block automatic refresh and offer an explicit migration or replacement path |

After every candidate is built, normal document validation and quotation composition invariants must pass. A preserved object with a dangling page, group, asset, field, binding, or output reference is a conflict, not a best-effort omission.

### Preview and impact

The preview must be derived from the exact deterministic proposal that acceptance would apply. It includes:

- old and incoming quotation identity, source revision, quote version, and source hash;
- added, removed, and changed source-owned semantic items grouped by business section;
- preserved user edits;
- user artifacts whose anchors remain valid;
- unresolved collisions and their available choices;
- pages added, removed, or repaginated;
- validation failures or blocking ambiguity; and
- the candidate document and proposal identity used for the final precondition check.

The UI must not present a raw node-ID diff as business impact. Sensitive source values need not be duplicated into the resolved audit log, but the pending preview may contain the exact incoming source and candidate needed for deterministic recovery within the existing local-draft trust boundary and size limits.

### Decision lifecycle

Only one quotation refresh may be pending for a draft.

1. **Prepare** validates identity, recomposes base and incoming, computes the proposal, and persists it without changing the active document or source context.
2. **Resolve collisions** records explicit decisions against the same proposal identity. It does not mutate the active document.
3. **Accept** verifies every precondition again, applies the exact candidate and incoming source context as one named history transition, records the accepted audit entry, and queues an immediate draft capture.
4. **Reject** leaves the active document and source context byte-for-byte unchanged, removes the pending proposal, records the rejected audit entry, and queues an immediate draft capture.
5. **Cancel viewing** closes the UI but does not imply rejection and does not erase a persisted pending proposal.

Prepare, accept, and reject are unavailable during a crop transaction, draft replacement, or another modal mutation. An ordinary Review proposal and a quotation refresh must not both claim the same active mutation boundary.

### Stale proposal and repository conflict recovery

The pending proposal records exact preconditions:

- draft ID;
- active document ID and revision;
- base content snapshot identity;
- base draft snapshot identity;
- base source identity and hash;
- incoming source identity and hash;
- composer and immutable composition template identity; and
- proposal/candidate identity.

Acceptance must fail closed and require regeneration if any precondition changed after preview. It must never recompute silently and apply a different candidate under an old approval.

Repository compare-and-swap remains the cross-tab authority:

- the refresh sidecar participates in the draft snapshot identity;
- pending and resolved refresh state are preserved in exact conflict candidates;
- reload stored version restores its refresh state exactly;
- save-as-copy preserves a pending proposal only when all recorded document, source, and draft identities are rewritten consistently for the copy; otherwise it deliberately cancels the stale proposal and records no false decision; and
- an accepted local refresh that loses a repository race remains recoverable as the exact conflict candidate, including the incoming source and accepted audit entry.

The implementation must choose and test one save-as-copy rule before integration. Silent loss of a pending or accepted refresh state is not allowed.

### Source audit trail

Add a refresh sidecar to the draft envelope, separate from Review and canonical document content:

```text
quotationRefresh:
  pending: zero or one exact proposal
  resolved: newest bounded decision entries
```

A pending proposal records exact source payload/candidate data required for recovery plus collision choices and preconditions. A resolved entry records only durable evidence:

- refresh ID and decision (`accepted` or `rejected`);
- decision time and local actor/principal identity when available;
- old and incoming quotation ID, revision, quote version, contract version, and full source hash;
- composer and composition template identity;
- impact counts and collision choice summaries by stable semantic key;
- base and resulting content/draft snapshot identities; and
- the resulting document revision for acceptance.

Use a fixed bound consistent with the Review precedent, with one pending item and at most the newest 50 resolved entries. Do not store duplicated raw customer text, prices, addresses, or terms in resolved summaries. Draft admission must cap the pending source, candidate, and aggregate sidecar sizes so the existing 32 MiB draft cap is not the only guard.

## Exact implementation surface

The phase should remain within these files unless an entry audit is amended before implementation.

### New files

- `packages/document/src/quotation-source-refresh.ts`: pure identity admission, semantic diff, three-way merge, preservation policy, collision model, and deterministic proposal identity.
- `packages/document/test/quotation-source-refresh.test.ts`: pure model and preservation matrix coverage.
- `apps/studio/src/features/editor/quotation-refresh-journal.ts`: strict pending/resolved sidecar contract, bounds, normalization, and decision helpers.
- `apps/studio/src/features/editor/quotation-refresh-journal.test.ts`: admission, bounds, legacy absence, and decision tests.
- `apps/studio/src/features/editor/quotation-refresh-dialog.tsx`: impact preview, collision controls, accept, reject, stale, and blocking conflict UI.
- `apps/studio/src/features/editor/quotation-refresh-dialog.test.tsx`: keyboard, focus, decision, stale-state, and blocked-state component tests.

### Existing files to modify

- `packages/document/src/quotation-composer.ts`: add the semantic trace side result while preserving current canonical output.
- `packages/document/test/quotation-composer.test.ts`: prove trace stability across reorder and repagination, uniqueness, complete source ownership, and unchanged canonical output.
- `packages/document/src/index.ts`: export the bounded refresh model and trace types.
- `apps/studio/src/features/editor/current-draft-repository.ts`: add the optional refresh sidecar to the exact draft envelope.
- `apps/studio/src/features/editor/draft-admission.ts`: validate, normalize, size-bound, and hash refresh state into draft identity.
- `apps/studio/src/features/editor/draft-admission.test.ts`: cover malformed, oversized, absent legacy, and exact round-trip refresh state.
- `apps/studio/src/features/editor/document-draft-repository.ts`: carry refresh state through heads, conflict candidates, reload, and the selected save-as-copy policy.
- `apps/studio/src/features/editor/document-draft-repository.test.ts`: cover pending, accept/reject, source-only races, conflict copies, and reload fidelity.
- `apps/studio/src/features/editor/document-draft-save-controller.ts`: include refresh sidecar in captures and conflict recovery.
- `apps/studio/src/features/editor/document-draft-save-controller.test.ts`: prove pending and decision transitions are captured without loss.
- `apps/studio/src/features/editor/use-document-editor.ts`: own prepare/resolve/accept/reject, operation exclusion, history transition, stale checks, source-context update, and exact persistence capture.
- `apps/studio/src/features/editor/use-document-editor.persistence.mounted.test.tsx`: replace destructive-import-only expectations with explicit refresh coverage while retaining separate import/replacement coverage.
- `apps/studio/src/features/studio-shell.tsx`: route same-source candidates to refresh preview and keep different-source import on an explicit replacement flow.
- `packages/editor/src/product-commands.ts`: make import and refresh intent distinct in product command copy and availability.
- `apps/studio/test/e2e/quotation-template-preservation.spec.ts`: prove appearance and source refresh remain independent and user styling survives.
- `apps/studio/test/e2e/draft-recovery.spec.ts`: prove pending and accepted refresh recovery through reload and conflict paths.

If the implementation can cover component behavior through the existing mounted editor test without a separate dialog test, the new dialog test file may be omitted. It may not omit the stated behavior.

### Upstream dependency, not an edit in this phase

The Stuwiz integration contract is owned in the staging quotation schema/service/query and its runbook. Before a live endpoint is consumed, Stuwiz must provide:

- authenticated access scoped to the exact Studio principal and quotation;
- a strict, render-ready JSON payload or a versioned adapter contract;
- a monotonic revision and fingerprint over every field included in Studio's source, including the branding snapshot;
- immutable or content-addressed logo resolution;
- an explicit stable series identity if refresh across quote row revisions is required; and
- endpoint tests for no-op, monotonic update, stale input, same-revision hash disagreement, incomplete draft, and authorization failure.

Until then, Studio refresh tests use exact versioned fixtures. They do not pretend the transient composition route is the upstream source service.

## Migration implications

### Local draft storage

The refresh sidecar can be optional in the existing draft envelope. Missing state means no pending refresh and no refresh history. Therefore existing drafts need no eager rewrite and IndexedDB needs no new object store or database-version bump.

Draft snapshot hashing must include refresh state. Content snapshot hashing must continue to represent canonical document content only. This preserves the existing distinction between source/decision-only saves and content revisions.

The existing draft admission limit is 32 MiB and the quotation source limit is 2 MiB. Because a pending refresh can hold base evidence, an incoming source, and a candidate, explicit per-proposal and aggregate bounds are required. A rejected or accepted resolved entry must not retain the raw candidate.

### Existing quotation drafts

Known composition contexts can enter refresh after base recomposition proves the persisted source, composer, and immutable template still reproduce a compatible baseline. Unknown, legacy, or historically resolvable-but-not-materializable contexts remain blocked. No heuristic migration is allowed.

The semantic trace must be derivable for old composer version 2 output without changing that output. If this cannot be proven, the phase must introduce an explicit composer migration and cannot refresh those drafts automatically.

### Server and Stuwiz data

The local phase requires no D1 migration because refresh state remains part of the existing draft envelope. A future server-backed audit may require durable server storage, retention, actor identity, and access controls; that is outside this bounded phase.

Stuwiz already stores document revision and hash, so a fixture adapter does not require a schema migration. Full-source revisioning of branding and cross-row series lineage may require an upstream contract or schema revision. That decision belongs in Stuwiz and must precede a production integration claim.

## Sequencing and gates

1. **Freeze the source fixture contract.** Add exact Stuwiz-to-Studio fixtures and document the full-source identity assumption. Stop if equal upstream revisions can produce different full source payloads without a defined integrity result.
2. **Build the pure model.** Add semantic trace, identity admission, three-way merge, impact, collision, and preservation tests. Stop if canonical composer output changes without a version decision.
3. **Add the bounded sidecar.** Add strict pending/resolved state, normalization, limits, draft identity, and legacy absence behavior.
4. **Integrate editor ownership.** Add prepare, resolve, accept, reject, stale checks, operation exclusion, named history replacement, and separate import/replacement semantics.
5. **Close persistence recovery.** Exercise capture, reload, compare-and-swap conflict, exact candidate, and the chosen save-as-copy rule.
6. **Add browser acceptance.** Verify preview truthfulness, manual-edit preservation, collision decisions, reload recovery, template independence, and accessible keyboard/focus behavior.
7. **Run independent review.** Review source identity, data loss, false audit claims, stale proposal application, and repository conflicts before row 9 is marked complete.
8. **Integrate Stuwiz only after its gate closes.** Add live fetch/authentication after the full-source version/fingerprint and stable lineage requirements are demonstrably available.

No later step may be used to excuse a failing earlier gate.

## Acceptance tests

### Pure model

- Same quotation ID, revision, and hash returns no-op.
- Same quotation ID and revision with a different hash returns an integrity conflict.
- A lower revision is rejected as stale.
- A different quotation ID is rejected as refresh and remains eligible only for explicit replacement.
- A higher revision produces a deterministic proposal and identical proposal identity for identical inputs.
- Reordered participants, events, packages, deliverables, or milestones remain associated by stable semantic key, not positional node ID.
- Repagination does not cause an unchanged source item to be mistaken for another item.
- Upstream-only changes apply.
- Studio-only changes survive.
- Equal changes converge without a collision.
- Different changes to the same semantic property require a decision.
- Upstream deletion of user-edited content requires a decision.
- Custom content survives when references remain valid and blocks when its anchor becomes ambiguous.
- Candidate documents pass full schema and referential validation.
- Traced composition is byte-for-byte equal to the current canonical composer output.

### Journal and admission

- An old draft without `quotationRefresh` admits unchanged.
- One pending proposal and the newest 50 resolved entries round-trip exactly.
- A second pending proposal is rejected or explicitly replaces the first through a recorded user action; it never overwrites silently.
- Malformed identities, duplicate semantic keys, invalid collision choices, raw resolved payload copies, and oversized proposals fail admission.
- Pending, accepted, and rejected transitions change draft snapshot identity but not content snapshot identity unless the document changes.
- Rejection preserves document and source context byte-for-byte.

### Editor and persistence

- Preparing a refresh does not change the active document, source context, history, Review, selection, or appearance.
- Acceptance is disabled until every collision is resolved.
- Acceptance advances document and incoming source context together in one named history transition.
- Undo and redo restore the matching document and source sidecar; they never create a document/source mismatch.
- Any edit, undo, template application, Review action, or draft cutover after preview makes the proposal stale and blocks acceptance.
- Reload restores the exact pending preview and choices.
- A cross-tab change causes the normal repository conflict and retains the exact refresh candidate.
- Reload stored version and save-as-copy follow the declared refresh-state policy without data loss.
- Different-source import remains an explicit replacement flow and cannot masquerade as refresh.
- Accept and reject survive an immediate close/reopen.

### Browser and product

- The preview identifies the source revision change and summarizes business impacts without exposing raw internal node IDs.
- Keyboard-only users can inspect impacts, choose collision resolutions, accept, reject, cancel viewing, and return focus to the trigger.
- The dialog announces blocking identity, validation, stale, and persistence errors.
- Applying a quotation appearance before or after refresh preserves the active visual choice and all allowed user edits.
- A same-revision hash disagreement cannot be accepted from the UI.
- An incomplete upstream draft cannot enter the refresh flow.
- No acceptance is reported until the repository capture succeeds or a recoverable conflict is visibly presented.

### Live Stuwiz contract

- The endpoint returns the same complete source and fingerprint for repeat reads of one revision.
- Every included branding or business-data change advances the full-source revision or changes an explicitly versioned immutable component covered by the fingerprint contract.
- Authorization prevents cross-tenant quotation reads.
- The adapter rejects incomplete drafts rather than filling required facts heuristically.
- Cross-row refresh remains disabled unless the response contains a stable series identity and the server proves the relationship.

## Stop conditions

Stop implementation and reopen this entry audit if any of the following occurs:

- a semantic trace cannot be produced without changing composer output or guessing identity;
- current source/context cannot deterministically reproduce the merge base;
- a candidate would silently drop a user edit or dangling custom artifact;
- Review is required to mutate source context;
- pending refresh cannot be carried through every repository conflict path;
- acceptance can apply after any preview precondition changes;
- resolved audit evidence can claim an incoming hash for only part of that source;
- live Stuwiz source identity omits branding or another field included in Studio's fingerprint; or
- another quote row is treated as the same lineage without a stable upstream series identity.

## Phase-entry recommendation

Proceed with the pure refresh model, semantic trace, bounded draft sidecar, editor decision flow, and fixture-driven recovery tests. Keep live Stuwiz retrieval behind a hard integration gate.

Row 9 can be marked complete only after the bounded local model passes independent review and the production claim is worded truthfully: either the upstream contract is implemented and tested, or the ledger explicitly records that only offline/versioned-source refresh is complete and live Stuwiz refresh remains blocked.

## Phase-exit evidence, 2026-08-30

The bounded local/versioned-source implementation passed three independent code
review iterations. The final review closes every identified P0/P1 and accepts
the code for a coherent commit. It does not approve live production Stuwiz
retrieval.

Implemented boundaries:

- stable semantic composition trace with byte-identical canonical output;
- pure three-way node, group, page and reference preservation with fail-closed
  custom anchors;
- exact persisted candidate, provenance, impact, choices and proposal identity;
- cross-field draft admission and tamper rejection;
- durable prepare, choice, reject and atomic document/source acceptance;
- source-aware history and a bounded privacy-safe resolved journal; and
- persistent editor review UI with mutation exclusion and an explicit reopen
  path.

Accepted verification:

- 24 focused document composition/refresh tests;
- 100 focused Studio journal, dialog, admission and mounted-persistence tests;
- `@webmcp/document` and `@webmcp/studio` typechecks; and
- `git diff --check`.

Retained evidence hardening is recorded in the continuation ledger: a direct
pending-refresh save-as-copy test, browser/keyboard and real two-session CAS
coverage, and draft-level result identity in resolved evidence. The live
integration stop condition remains the missing authenticated complete-source
Stuwiz revision/fingerprint, branding, authorization and lineage contract.
