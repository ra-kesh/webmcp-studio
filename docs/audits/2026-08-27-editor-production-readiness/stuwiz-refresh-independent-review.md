# Stuwiz refresh independent review

Date: 2026-08-30

Reviewer: independent code review of the uncommitted Studio quotation refresh change

## Gate decision

**Not safe to commit as the row 9 implementation.**

The change has a useful foundation: same-source identity admission, a persisted pending sidecar, bounded resolved history, editor mutation exclusion, CAS participation through the draft snapshot hash, and an explicit accept or reject dialog. The focused tests and both affected package typechecks pass.

Two P0 correctness defects remain. The semantic trace still uses positional output identity for page chrome and some values, so repagination or optional-value changes can associate a Studio edit with the wrong source property. The merge also silently relocates or drops user-created structure instead of stopping on anchor and reference collisions. Either defect can produce an accepted document that does not preserve the user's Studio work as represented in the preview.

The persisted proposal is also weaker than the phase contract. It stores the incoming source and an impact summary, but not the candidate document or candidate identity. Acceptance recomposes a different document with a new timestamp. That is a P1 approval-integrity defect and must be closed before this gate can pass.

This review does not change the earlier upstream conclusion. Live Stuwiz integration remains blocked until Stuwiz supplies an authenticated, full-source revision and fingerprint contract, immutable branding provenance, and stable cross-row lineage where needed.

## Findings

### P0. Positional semantic keys can transfer a Studio edit to a different source value

Evidence:

- `packages/document/src/quotation-composer.ts:658-671` assigns card details as `${semanticKey}.detail.${index}`.
- Participant card details are built at `packages/document/src/quotation-composer.ts:733-746` by filtering optional email, phone, and address values before those indexes are assigned.
- Page chrome and continuation nodes use generated page numbers and continuation labels in semantic keys at `packages/document/src/quotation-composer.ts:495-522` and `packages/document/src/quotation-composer.ts:539-557`.
- The merge treats semantic-key equality as source-property equality at `packages/document/src/quotation-source-refresh.ts:336-368`.
- The trace test only checks that keys remain present after reversing events, at `packages/document/test/quotation-composer.test.ts:165-178`. It does not prove that a key continues to denote the same property after optional values shift or pagination changes.

Concrete failure: if a participant originally has email, phone, and address, `participant.<key>.detail.0` is email. If Stuwiz later removes email, the same key becomes phone. A Studio edit to the email layer is then three-way-merged against the incoming phone layer. Similar misassociation is possible for page-index chrome after repagination.

Contract mismatch: the phase audit requires keys from stable source keys plus bounded semantic roles and explicitly rejects array indexes alone. It also requires repagination not to confuse unchanged source items. The current trace fails that contract.

Required correction: assign role keys such as `.email`, `.phone`, and `.address`; classify generated page chrome as composer-owned structure or key it by stable page-content ownership rather than page index; add tests that remove each optional participant and branding value, reorder every keyed collection, and repaginate before and after a manually edited stable business property.

### P0. Custom nodes and groups are silently moved or discarded when source pages change

Evidence:

- Custom nodes on a source page are reattached only when an incoming page has the same positional page ID at `packages/document/src/quotation-source-refresh.ts:412-439`.
- Any node left without a page is moved to a newly invented "Preserved Studio edits" page at `packages/document/src/quotation-source-refresh.ts:451-473`.
- Custom groups with no surviving single-page node set are silently skipped at `packages/document/src/quotation-source-refresh.ts:542-553`.
- A custom group's parent is silently cleared when the parent has not already been emitted at `packages/document/src/quotation-source-refresh.ts:554-562`. This is also order-dependent because a valid custom parent later in the current group array is not yet present.
- There is no anchor-collision type in `QuotationRefreshConflict`; only `changed_by_both` and `edited_then_removed` exist at `packages/document/src/quotation-source-refresh.ts:19-24`.
- The pure tests cover one edited generated text node, event reorder, and added pages. They do not cover custom nodes, custom pages, custom groups, nested groups, assets, fields, bindings, outputs, or removed anchors at `packages/document/test/quotation-source-refresh.test.ts:16-144`.

This behavior is data loss even when schema validation succeeds. Moving an annotation or image to an unrelated recovery page changes its meaning and placement without a user decision. Dropping its group or parent loses authored structure. `assertValidDocument` at line 658 proves referential validity, not preservation.

Contract mismatch: the phase audit says an artifact on a removed or repaginated page must become an anchor collision and the implementation must not guess a page. Dangling or ambiguous groups and references must block, not disappear.

Required correction: model explicit page, parent, and reference collisions; preserve only artifacts whose exact anchor remains proved; stop candidate construction on ambiguous anchors; never create a recovery page as an implicit resolution; test custom and nested structure across page deletion, repagination, and output changes.

### P1. The persisted proposal is not the exact candidate the user approves

Evidence:

- `PendingQuotationRefresh` stores the incoming source, impact, and proposal ID but no candidate document or candidate content identity at `apps/studio/src/features/editor/quotation-refresh-journal.ts:53-69`.
- `quotationRefreshProposalId` hashes only document/source/composer coordinates at `apps/studio/src/features/editor/use-document-editor.ts:412-431`. It excludes the candidate document, impact, conflict set, and preservation result.
- Preparation builds a document using the preparation time at `apps/studio/src/features/editor/use-document-editor.ts:5179-5185`, then discards that document and persists only its impact at lines 5200-5216.
- Acceptance recomposes from scratch and supplies a new current time at `apps/studio/src/features/editor/use-document-editor.ts:5445-5452`.
- The pure builder writes that time into `document.updatedAt` at `packages/document/src/quotation-source-refresh.ts:658-673`.

The accepted document is therefore guaranteed to differ from the prepared candidate whenever prepare and accept occur at different instants. More importantly, a composer or merge regression that produces the same coordinate hash but a different candidate is not detected. The dialog's sentence that changes "are ready" is not tied to a persisted candidate.

Contract mismatch: the phase audit requires the exact candidate and proposal identity to survive reload, and says acceptance must never silently recompute and apply a different candidate under an old approval.

Required correction: either persist the validated candidate plus its identity, or make candidate generation fully time-independent and persist a cryptographic candidate identity that acceptance recomputes and compares before applying. Include the exact impact and collision set in that identity. Set decision-time metadata only after the approved content identity has matched.

### P1. Accept and reject report success before the decision is durable

Evidence:

- Prepare, collision choice, reject, and accept call `captureSettledDraft()` and immediately return success at `apps/studio/src/features/editor/use-document-editor.ts:5224-5231`, `5321-5330`, `5353-5372`, and `5490-5528`.
- `captureSettledDraft` only captures into the debounced save controller at `apps/studio/src/features/editor/use-document-editor.ts:1818-1865`.
- The save controller's `capture` schedules the write and returns at `apps/studio/src/features/editor/document-draft-save-controller.ts:156-171`; only `flush` waits for durability at lines 186-200.
- The mounted acceptance test explicitly calls `flushActiveDraft()` after acceptance at `apps/studio/src/features/editor/use-document-editor.persistence.mounted.test.tsx:3754-3758`, so it does not prove the API's reported success is durable.

The dialog closes after `true`. An IndexedDB failure or cross-tab CAS conflict can occur afterward. The editor may later expose recovery state, but the user has already received a successful accept or reject result. Immediate close or browser termination can also lose the newest decision.

Contract mismatch: the phase acceptance criteria say accept and reject must survive immediate close or reopen, and no acceptance may be reported until repository capture succeeds or a recoverable conflict is visibly presented.

Required correction: after capturing a prepare, choice, accept, or reject transition that changes the decision sidecar, flush the active controller and return true only for `saved`. For a CAS conflict, keep the exact candidate and open recovery before closing the dialog. Add storage-failure, immediate-close, and two-tab race tests around the public editor actions.

### P1. Draft admission does not prove that pending identity fields match their payload and linked source

Evidence:

- The journal schema validates each field independently at `apps/studio/src/features/editor/quotation-refresh-journal.ts:11-69`. It does not recompute `incoming.sourceSnapshotId`, compare incoming quotation ID or revision to `incomingSource`, or relate `base` to the draft's source context.
- Draft ownership checks only `documentId` and `baseDocumentRevision` at `apps/studio/src/features/editor/current-draft-repository.ts:207-225`.
- Draft admission hashes whatever sidecar passed parsing at `apps/studio/src/features/editor/draft-admission.ts:93-106` and `152-160`; hashing malformed cross-field claims makes them stable, not true.

A malformed, migrated, or manually corrupted envelope can present one incoming identity while carrying a different valid source payload. Acceptance catches some differences indirectly when recomposing, but it does not recompute and compare the pending incoming identity before writing the resolved audit entry. The resolved entry can therefore claim the stored `pending.incoming` identity rather than the source actually accepted.

Contract mismatch: draft admission must validate exact source, composer, template, and proposal ownership. Same-revision hash disagreement must fail closed.

Required correction: add asynchronous refresh admission that recomputes the incoming fingerprint; compare all incoming identity fields to the source payload; compare base identity and composer/template identity to `sourceContext.composition`; verify proposal or candidate identity; reject impossible collision choices and duplicate conflict keys. Add malformed and exact round-trip tests in `draft-admission.test.ts` and repository decode tests.

### P1. Save-as-copy silently cancels pending work without a recorded, user-visible policy

Evidence:

- Conflict save-as-copy forces `pending: null` while copying resolved entries at `apps/studio/src/features/editor/document-draft-repository.ts:2503-2527`.
- No refresh-specific repository tests exist in `document-draft-repository.test.ts`.
- The resolved journal receives no cancellation or rejection entry, and the dialog/UI does not explain that save-as-copy will drop the pending refresh.

The phase audit permits cancellation on copy only if the policy is deliberate, tested, and records no false decision. The code avoids a false accepted or rejected decision, but silently losing the pending source and all collision choices still violates the stated no-silent-loss requirement.

Required correction: make the copy policy explicit in conflict recovery UI and tests. Prefer carrying the pending proposal after rewriting document, draft, and candidate preconditions for the new ID if that can be proved. Otherwise require an explicit acknowledgement that the pending refresh will be cancelled.

### P1. Group-level Studio edits and deletions do not follow the three-way policy

Evidence:

- Generated group merging preserves only a changed group name at `packages/document/src/quotation-source-refresh.ts:252-261` and reconstructs membership, page, and parent solely from incoming composition at lines 507-540.
- A Studio deletion of a generated group is treated as absence and the incoming group is regenerated because `currentGroup` is optional at lines 495-505.
- No group conflict is emitted, although every generated group is traced by the composer.

This contradicts the preservation matrix for Studio deletions and source-owned structure. A user can ungroup content or change group nesting in Studio and see that structure silently regenerated on refresh.

Required correction: either classify groups as immutable composer-owned structure and block UI edits to them, or apply the same three-way deletion and property policy used for nodes. Add group deletion, rename, membership, and nesting tests.

### P2. Resolved audit evidence is incomplete

Evidence:

- `resolvedRefreshSchema` records content identities and document revision, but not the required base/result draft snapshot IDs or actor/principal identity at `apps/studio/src/features/editor/quotation-refresh-journal.ts:72-88`.
- Reject computes `baseContentSnapshotId` from the current document at decision time at `apps/studio/src/features/editor/use-document-editor.ts:5343-5368`, not from an immutable prepared content identity.
- The proposal's `baseDraftSnapshotId` is captured at preparation but is neither checked during acceptance nor copied into resolved audit evidence at lines 5186-5199 and 5426-5439.

Required correction: persist prepared base content identity, verify the base draft identity against the active persistence authority, record resulting draft identity after the durable write, and record the available local principal or explicitly document why no actor exists in the local trust boundary.

### P2. The impact preview is layer-count based and can understate business impact

Evidence:

- The impact exposes changed JSON paths, categories, generated counts, and layer counts at `packages/document/src/quotation-source-refresh.ts:26-36` and lines 656-688.
- The dialog renders only pages, updated/added/removed layer counts, and category badges at `apps/studio/src/features/editor/quotation-refresh-dialog.tsx:107-140`.

There is no business-item summary for added, removed, and changed participants, events, packages, deliverables, milestones, or terms. Page additions/removals and repagination are collapsed into a generated page total. Preserved custom artifact and anchor status is absent. The UI therefore cannot substantiate its claim that the exact incoming changes are ready.

Required correction: derive bounded business-section entries from stable source keys, include page deltas and preservation/anchor outcomes, and test that the displayed summary matches the accepted candidate without exposing raw node IDs or raw resolved customer values.

### P2. Dialog and cross-browser acceptance coverage is missing

Evidence:

- The phase surface calls for dialog behavior tests, but there is no `quotation-refresh-dialog.test.tsx`.
- No quotation refresh cases exist in `apps/studio/test/e2e/quotation-template-preservation.spec.ts` or `apps/studio/test/e2e/draft-recovery.spec.ts`.
- The one mounted editor scenario covers a single text collision and a manual flush at `apps/studio/src/features/editor/use-document-editor.persistence.mounted.test.tsx:3685-3782`.

Missing coverage includes focus restoration, Escape and "Review later" semantics, keyboard-only collision selection, stale/error announcements, pending reload with retained choices, accept/reject after reload, source-only CAS races, exact conflict candidates, reload stored version, save-as-copy policy, session-only mode, private browsing/storage failure, Safari IndexedDB behavior, and appearance/template independence.

## Contract and provenance assessment

Source identity admission in the editor handles the basic matrix correctly: different quotation IDs are blocked, lower revisions fail, exact same-revision hashes become a no-op, and same-revision hash disagreement fails closed at `apps/studio/src/features/editor/use-document-editor.ts:5125-5177`. This logic belongs in the pure model too; `prepareQuotationRefresh` itself only accepts a higher revision and throws at `packages/document/src/quotation-source-refresh.ts:278-304`, so callers cannot inspect typed no-op, stale, or integrity outcomes as required by the phase contract.

Composer and immutable template provenance are checked before preparation and acceptance at `apps/studio/src/features/editor/use-document-editor.ts:5133-5145` and `5413-5425`. Same-source imports retain the active quotation template instead of accepting a request-time template switch at lines 5120-5131. That is the right direction. It needs admission-level cross-field validation so restored drafts cannot bypass those construction-time checks.

Appearance is not explicitly reapplied during refresh. Node-level three-way merge should preserve a palette applied in Studio when the incoming composition uses the immutable composition template. No end-to-end test proves this, and the positional and custom-structure findings above mean the general preservation claim is not yet safe.

The resolved log avoids copying the raw incoming source, changed paths, conflict layer names, or conflict property values. That is good privacy hygiene. Collision-choice keys and semantic keys still need a bounded opaque-key contract; source keys are currently arbitrary strings and could contain customer data. Pending data contains the full source as expected inside the local draft trust boundary, with an 8 MiB pending cap at `apps/studio/src/features/editor/quotation-refresh-journal.ts:8-10` and `98-111`. There is no separate aggregate sidecar cap beyond the 50-entry resolved limit and the existing draft cap.

## Verification performed

Read-only checks against the uncommitted workspace:

- `git diff --check`: passed.
- `@webmcp/document` focused tests for quotation composer and source refresh: 13 passed.
- `@webmcp/studio` focused tests for the refresh journal and mounted persistence editor: 88 passed.
- `@webmcp/document` typecheck: passed.
- `@webmcp/studio` typecheck: passed.

The first test attempt used the host Node 18 binary and failed during Vitest startup because `node:util.styleText` is unavailable there. Re-running with the bundled Node 24 runtime succeeded. This was an environment issue, not a repository failure.

## Minimum gate closure

Do not mark row 9 complete or commit this implementation as production-ready until all P0 and P1 findings are closed. At minimum:

1. Replace positional semantic keys with stable source-property roles and prove reorder plus repagination behavior.
2. Stop on custom artifact, group, page, parent, and reference ambiguity instead of moving or dropping authored structure.
3. Persist or cryptographically bind the exact candidate and preview, then apply that exact content.
4. Make accept and reject wait for durable save or visible recoverable conflict.
5. Add cross-field sidecar admission and exact source/context/proposal verification.
6. Specify and test pending refresh behavior for CAS conflict, reload, and save-as-copy.
7. Add mounted component and browser coverage for collision UI, template preservation, immediate reopen, and cross-session behavior.

After those changes, rerun independent review. Until the separate upstream contract closes, describe the result only as offline or versioned-source refresh, not live production Stuwiz refresh.

## Second-pass review, 2026-08-30

### Decision

**Still not safe to commit as the row 9 implementation.**

The repair closes both former P0 findings and six of the seven former P1 findings. The implementation is much closer to the phase contract. One preservation defect remains at P1: a Studio deletion of a generated source-owned node is silently retained even when Stuwiz changed that same semantic node. That is a two-sided change and must require a decision. The exact acceptance matrix names this case.

No new P0 was found. The gate can pass after the remaining P1 is fixed and covered, assuming the focused checks continue to pass. Live production Stuwiz integration remains separately blocked by the upstream contract described in the phase audit.

### Status of every prior P0 and P1

#### Closed: positional semantic keys could transfer an edit to another value, former P0

Optional contact values now use explicit roles. `QuotationCanvasWriter.card` takes `{ role, value }` details and writes `${semanticKey}.${role}` at `packages/document/src/quotation-composer.ts:623-677`. Participant fields use `email`, `phone`, and `address` at lines 739-750; event details use `schedule`, `audience`, and `notes` at lines 759-785; branding contact uses the same role scheme at lines 871-883.

The composer tests now exercise collection reorder, participant optional-field removal, branding optional-field removal, and repagination while retaining a manually edited business key at `packages/document/test/quotation-composer.test.ts:188-320`. Page chrome remains keyed by a generated page role at `packages/document/src/quotation-composer.ts:498-560`, but business-property identity no longer depends on that role. Custom content on a generated page is admitted only when the old and incoming generated semantic-key signatures match at `packages/document/src/quotation-source-refresh.ts:299-307` and `441-464`. This closes the original wrong-business-value failure.

#### Closed: custom nodes and groups were moved or discarded, former P0

The recovery-page fallback is gone. Unassigned custom nodes now throw `QuotationRefreshAnchorConflictError` at `packages/document/src/quotation-source-refresh.ts:587-596`. Custom groups must retain every layer on one proved page at lines 753-773, and missing parent groups block at lines 775-784. Generated group structure now receives a three-way comparison and collision path at lines 662-750. Generated and custom field bindings also stop on lost anchors at lines 786-846.

The pure tests prove nested custom groups survive an unchanged anchor and that a changed generated page signature blocks instead of relocating a custom layer at `packages/document/test/quotation-source-refresh.test.ts:217-280`.

#### Closed: persisted proposal was not the approved candidate, former P1

Pending state now stores `baseContentSnapshotId`, `candidateContentSnapshotId`, and the exact `candidateDocument` at `apps/studio/src/features/editor/quotation-refresh-journal.ts:76-97`. The proposal hash binds both identities, appearance provenance, full impact, and collision choices at lines 182-225. Preparation persists the exact candidate and hash at `apps/studio/src/features/editor/use-document-editor.ts:5185-5238`.

Each collision choice deterministically rebuilds the candidate with the original `preparedAt`, recalculates its identity, and replaces the pending proposal at `apps/studio/src/features/editor/use-document-editor.ts:5340-5419`. Acceptance verifies proposal, base, and candidate identities and installs `pending.candidateDocument` directly at lines 5515-5577. It no longer recomposes a fresh candidate under an old approval.

#### Closed: decisions returned success before durable persistence, former P1

Prepare, collision choice, reject, and accept now call `flushActiveDraft()` and return its result at `apps/studio/src/features/editor/use-document-editor.ts:5246-5253`, `5411-5419`, `5439-5459`, and `5594-5624`. `flushActiveDraft` waits for the save controller and returns true only when its state is `saved` at `apps/studio/src/features/editor/use-document-editor.ts:1864-1878`.

The mounted refresh acceptance test no longer performs a compensating manual flush after the action and asserts saved state plus durable pending/choice/accepted transitions at `apps/studio/src/features/editor/use-document-editor.persistence.mounted.test.tsx:3689-3800`. Reopen and durable reject are covered at lines 3802-3865.

#### Closed: pending identity fields were not cross-checked, former P1

Synchronous ownership checks now relate the pending base, incoming identity, linked source, composer, composition template, and active appearance at `apps/studio/src/features/editor/current-draft-repository.ts:210-270`. Async admission recomputes the base source fingerprint, incoming fingerprint, candidate content identity, base content identity, and proposal hash at `apps/studio/src/features/editor/draft-admission.ts:159-213`.

Tampered incoming source, candidate document, and proposal hash all fail the new admission test at `apps/studio/src/features/editor/draft-admission.test.ts:273-302`.

#### Closed in code: pending save-as-copy was silently cancelled, former P1

Repository save-as-copy now refuses a candidate with a pending refresh and explains that the source and decisions remain preserved at `apps/studio/src/features/editor/document-draft-repository.ts:2503-2512`. It no longer clears pending state. The code-level policy matches the phase audit's permitted refusal path.

A direct repository test for this exact refusal is still missing. That is now a P2 test gap, not a P1 behavior defect.

#### Closed: generated group edits and deletion bypassed three-way policy, former P1

Generated groups now compare semantic node membership and parent identity across base, current, and incoming at `packages/document/src/quotation-source-refresh.ts:309-323` and `662-733`. A Studio deletion remains deleted when upstream structure is unchanged, and a two-sided structure change becomes a conflict. The deletion case is covered at `packages/document/test/quotation-source-refresh.test.ts:282-304`.

#### Still open as P2: resolved audit evidence lacks draft-level result identity

The repaired proposal records base draft identity, base content identity, candidate content identity, composition template, and appearance template. Resolved entries still contain only content identities and result document revision at `apps/studio/src/features/editor/quotation-refresh-journal.ts:133-150`. They do not record the resulting draft snapshot identity after the durable decision or an available local actor identity. Acceptance therefore has stronger approval evidence but the durable audit remains short of the phase audit's stated base/result draft identity contract.

#### Closed: impact preview understated business changes, former P2

The pure model now counts keyed additions, removals, and updates for people, events, packages, delivery schedule, payment schedule, and terms at `packages/document/src/quotation-source-refresh.ts:158-209`. It also reports previous and incoming page totals plus preserved custom-layer count at lines 935-952. The dialog renders those summaries without semantic node IDs at `apps/studio/src/features/editor/quotation-refresh-dialog.tsx:122-190`.

#### Partly closed: dialog and browser acceptance coverage, former P2

The new component test verifies the accessible revision label, business summary, hidden semantic key, alert announcement, disabled acceptance, asynchronous durable choice, and acceptance at `apps/studio/src/features/editor/quotation-refresh-dialog.test.tsx:97-156`. The mounted editor suite covers durable prepare/choice/accept and pending reopen/reject.

The phase audit's browser matrix remains absent. There are still no refresh cases in `apps/studio/test/e2e/quotation-template-preservation.spec.ts` or `apps/studio/test/e2e/draft-recovery.spec.ts`. Keyboard focus return, Escape/Review-later persistence, cross-browser IndexedDB behavior, and a real two-session refresh CAS path are not exercised end to end.

### New P1 finding

#### P1. A Studio-deleted generated node does not collide when Stuwiz changes it

Evidence:

- The node loop finds the base and current nodes at `packages/document/src/quotation-source-refresh.ts:481-484`.
- When the base node exists but the current node does not, it increments `removedSourceLayers` and continues unconditionally at lines 492-494.
- It never compares `oldNode` with `nextNode` in that branch and never emits a conflict.
- The later upstream-removal loop at lines 511-535 handles the inverse case, where Stuwiz removed a node that Studio edited. It does not repair the Studio-deleted/upstream-changed case.
- Existing pure tests cover edited values, upstream deletion behavior through the general model, custom anchors, and generated-group deletion, but no test deletes a generated node and changes that same semantic node upstream.

Concrete failure: a user deletes `event.welcome.schedule` in Studio. Stuwiz then changes the welcome event's date or location. Refresh accepts the higher source revision while silently retaining the Studio deletion. The resolved audit claims the complete incoming source identity, but the user was never asked whether the newly changed Stuwiz value should restore that layer.

Contract mismatch: the preservation matrix says a user deletion of source-owned content is preserved only when upstream is unchanged. When both sides changed differently, the refresh requires an explicit `keep Studio` or `use Stuwiz` choice.

Required correction: in the `!currentNode` branch, compare the old and incoming node. If unchanged upstream, preserve the deletion. If changed upstream, emit a collision keyed by the semantic node. `preserve_studio` must keep it deleted; `use_stuwiz` must add the incoming node with a collision-safe ID and attach it to the correct incoming page and groups. Add tests for both choices, plus the converged case if the model supports it.

### New and remaining P2 findings

#### P2. Pending-refresh save-as-copy refusal lacks a focused test

The behavior at `apps/studio/src/features/editor/document-draft-repository.ts:2503-2512` is correct but has no matching refresh test in `document-draft-repository.test.ts` or the mounted editor suite. A regression could silently reintroduce cancellation without failing the current focused gate.

Add a repository conflict candidate containing an exact pending proposal, call `saveConflictAsCopy`, assert `validation_failed`, verify the conflict candidate is unchanged, and confirm reload can still recover and reject the pending proposal.

#### P2. Cross-session and browser refresh acceptance remains incomplete

Mounted persistence tests prove reload of pending state in a fresh hook, but they do not race an accepted refresh against a real second repository owner and inspect the exact retained conflict candidate. No Playwright test proves appearance preservation, keyboard/focus behavior, immediate close/reopen, or pending recovery in the supported browser matrix.

This does not replace the remaining P1 as the commit blocker, but the phase audit names these as acceptance tests. They should be added before row 9 is marked complete.

### Checks run in the second pass

The second pass used the bundled Node 24 runtime and ran:

- `@webmcp/document` focused composer and refresh tests: 22 passed.
- `@webmcp/studio` refresh journal, refresh dialog, draft admission, and mounted persistence tests: 100 passed.
- `@webmcp/document` typecheck: passed.
- `@webmcp/studio` typecheck: passed.
- `git diff --check`: passed.

### Second-pass gate closure

Fix the generated-node deletion collision and add its two decision-path tests before commit. The repository save-as-copy refusal and browser/session tests should also be added to meet the phase's declared acceptance evidence. Once the P1 fix passes, a short final audit can change the bounded local refresh gate to safe. The production claim must still say offline or versioned-source refresh until Stuwiz closes its live endpoint, full-source identity, branding, authorization, and lineage contract.

## Third-pass review, 2026-08-30

### Final decision

**All identified P0 and P1 findings are closed. The bounded local/versioned-source refresh implementation is safe to commit.**

This decision is limited to the local Studio refresh model and its persisted decision flow. The remaining P2 evidence gaps from the second pass still apply: add a direct pending-refresh save-as-copy refusal test, complete the declared browser/session acceptance matrix, and extend resolved audit evidence with draft-level result identity where available. Those gaps do not expose a known silent data-loss or false-acceptance path in the reviewed code, but they should be closed before row 9 is presented as fully complete against every acceptance item in the phase audit.

Live production Stuwiz refresh is not approved by this decision. It remains blocked on the upstream authenticated endpoint, complete source identity including branding, authorization tests, and stable lineage contract described in the phase audit.

### Closure of the remaining P1

The Studio-deleted/generated-node branch now performs the missing three-way comparison at `packages/document/src/quotation-source-refresh.ts:493-518`.

- If the old and incoming generated nodes are equal, Studio preserves the deletion without a collision at lines 494-498.
- If Stuwiz changed the node, the model emits `changed_by_both` with the changed properties at lines 500-505.
- `preserve_studio` retains the deletion at lines 514-516.
- `use_stuwiz` restores the incoming node through collision-safe ID allocation, records its semantic mapping, and marks it for generated-group reconstruction at lines 506-513.

The normal incoming-page projection places the restored semantic node in source order. Generated-group reconstruction then inserts restored nodes relative to their nearest surviving incoming siblings at `packages/document/src/quotation-source-refresh.ts:666-674` and `707-750`. Full document validation still runs before returning the candidate.

The focused tests cover the required matrix:

- unchanged upstream preserves the Studio deletion with no collision at `packages/document/test/quotation-source-refresh.test.ts:321-347`;
- changed upstream with `preserve_studio` keeps the deletion;
- changed upstream with `use_stuwiz` restores the changed value;
- both candidates pass document validation at `packages/document/test/quotation-source-refresh.test.ts:349-399`.

No new P0, P1, privacy, provenance, persistence, or collision-semantics defect was found in this final code inspection.

### Third-pass checks

Using the bundled Node 24 runtime:

- focused quotation composer and source-refresh tests: 24 passed;
- `@webmcp/document` typecheck: passed;
- `git diff --check`: passed.

Combined with the second-pass results of 100 focused Studio tests and the Studio typecheck, the reviewed bounded implementation now has a passing high-signal gate.
