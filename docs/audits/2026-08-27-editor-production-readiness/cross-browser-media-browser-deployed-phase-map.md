# Cross-browser local media Slice 6: browser and deployed evidence

Date: 2026-08-30

Status: execution active; the Slice 6A core two-context journey passed on
2026-08-30, while the remaining race, compact/accessibility, Slice 6B and
authorized deployed gates remain open

Ledger boundary: row 10, Cross-browser local media — Slice 6 only

## Outcome

Prove the accepted Slice 1 through Slice 5 implementation in the environments
whose behavior cannot be substituted by unit fakes:

1. two isolated real Chromium contexts with distinct IndexedDB state;
2. real browser IndexedDB, FileReader, XHR, BroadcastChannel, focus, reload,
   compact layout and accessibility behavior;
3. the existing Access-protected production Worker, D1 mapping, R2 object,
   managed-use receipt and request audit; and
4. cross-browser PNG/PDF, publication and WebMCP behavior after recovery.

Slice 6 is evidence and harness work. It does not weaken the accepted domain,
repository, renderer, privacy or ownership contracts to make a browser case
pass. Ledger row 10 remains active until the real-browser, deployed,
repository-wide and independent-review gates all pass.

## Evidence reread

Before freezing this map, reread:

- the complete `cross-browser-media-phase-entry.md`, including all invariants,
  the full twelve-case cross-boundary matrix, real-browser gate, deployed gate,
  repository-wide commands, deliberate limits and completion claim;
- the Slice 1, server, journal, owner, use-receipt, editor-relink and
  admission-recovery independent reviews;
- `cross-browser-media-admission-recovery-phase-map.md`, especially its Slice
  6 exclusion and accepted exit record;
- `media-01-browser-acceptance.md`, the current MEDIA-01 Playwright fixture,
  `playwright.config.ts` and the existing browser evidence conventions;
- `deployed-storage-phase-entry.md` and
  `deployed-acceptance-phase-entry.md`, including authentication handoff,
  immutable production evidence, secret redaction, public-route-only writes,
  read-only D1/R2 inspection and explicit authorization boundaries; and
- the current production `wrangler.jsonc`, local port ownership and existing
  deployment identity. Port 3000 remains Stuwiz; Studio remains on 3001.

## Accepted starting point

Slices 1 through 5 are independently accepted with zero open P0/P1. The
starting implementation already owns:

- strict local and managed identity plus exact aggregate reference paths;
- workspace-scoped D1 promotion mappings and private bounded resolution;
- one finite-lease browser promotion owner with durable retry identity;
- one mounted relink transaction, critical durable draft proof and stable
  managed-use receipt;
- admission/import migration with an atomic preimage receipt; and
- the complete missing-byte choice set with durable mounted crash recovery.

Slice 6 must test those contracts. It must not reimplement them in a special
test-only product path.

## Non-negotiable evidence rules

1. The two browser contexts use separate persistent browser profiles. Context
   B begins with no local asset metadata, Blob, quarantine or promotion journal.
2. Shared truth crosses contexts only through the real product Worker routes
   and their D1-backed local-promotion mapping. A copied mapping fixture or
   mocked response invalidates the gate.
3. A document may reach Context B through a validated draft seed or import
   fixture, because arbitrary cloud draft synchronization is outside row 10.
   Its canonical body must still contain the original local alias before
   admission begins.
4. Browser evidence uses native IndexedDB, FileReader, XHR/fetch,
   BroadcastChannel, focus and reload behavior. `fake-indexeddb`, one context,
   or two pages sharing one profile cannot substitute.
5. Every production request remains Access-authenticated and workspace-scoped.
   Evidence retains request IDs and safe hashes, never cookies, JWTs, Access
   assertions, local paths, local file metadata, private bytes or raw R2 keys.
6. Product writes use public product routes. D1 and R2 inspection is read-only.
   Tests do not delete rows/objects, edit timestamps, expose the private
   Renderer, lower quotas or reuse another product's resources.
7. No production write, Access policy change, migration, Worker deployment,
   Workflow control operation or paid-capacity action occurs without explicit
   authorization for that exact gate.
8. Evidence stages under a run-specific temporary directory and becomes an
   immutable named run only after every assertion and redaction check passes.
9. An authentication redirect, migration/deployment drift, unexpected resource
   name, partial artifact set, privacy leak, cross-workspace visibility,
   unbounded retry or daily-budget approach stops the run without promotion.
10. Row 10 closes only after independent code/evidence review finds no open
    P0/P1. A green local browser run cannot close a blocked deployed gate.

## Slice 6A — local real-browser gate

### Harness

Add `apps/studio/test/e2e/cross-browser-media-production.spec.ts` using two
explicit Chromium contexts rather than the default single Playwright page.
Use one run-scoped alias, document ID, file name and idempotency identity.

Context A:

- opens the canonical fixture containing direct image uses, an asset-field
  default, another field's current value and bound projections;
- creates a real browser-local image through the product upload path so the
  Blob, metadata and revision live in native IndexedDB;
- runs **Make available everywhere** through the visible Media workflow;
- proves one managed mapping, one exact document relink, one critical save and
  one managed Recent use; and
- proves Undo and Redo change only the document and issue no second upload.

Context B:

- starts from an empty local asset database and empty promotion journal;
- receives the same validated canonical document body still containing the
  original local alias through the supported draft/import boundary;
- opens it through route admission, resolves the real shared mapping, persists
  one coherent managed body and receipt, and never receives local or R2 bytes;
- reloads and proves the managed body remains stable without another migration
  or managed-use mutation; and
- completes foreground PNG/PDF, publication and WebMCP behavior using only the
  admitted managed identity.

### Real browser race and recovery cases

Retain browser evidence for:

1. IndexedDB v4-to-v5 upgrade with existing metadata/Blob preservation and a
   deliberately blocked upgrade that becomes retryable after the old handle
   closes;
2. FileReader hash cancellation, local read cancellation, upload cancellation,
   mapping lookup cancellation and the non-cancellable critical save phase;
3. two tabs racing the same promotion, finite-lease ownership, takeover after
   expiry and suppression of late loser publication;
4. Worker-commit/response-loss and mapping-response-loss recovery without a
   second upload or relink;
5. BroadcastChannel as an invalidation hint followed by authoritative IndexedDB
   or mapping reread;
6. mapping created while another editor is mounted, producing **Studio copy
   available** rather than an automatic mounted mutation;
7. exact same-hash recovery, different-hash identity conflict, archived backup,
   unknown mapping, unavailable repository, Locate file, managed selection and
   context-valid clear/remove;
8. route replacement, Review, crop, document deletion and unmount while work is
   cancellable or critical, with no stale focus/state publication; and
9. admission receipt Restore, Keep, Download and Save-copy behavior across
   exact and advanced durable heads.

### Browser presentation and accessibility

Run desktop and 390 px compact journeys. Prove:

- keyboard-only opening, impact review and recovery actions;
- stable focus through Cancel/Stopping/Retry/Finish-saving and return to the
  actual opener;
- polite status plus alert semantics without duplicate announcements;
- one scroll owner and no horizontal overflow;
- exact named node, field-slot, bound-layer, page and output impact; and
- no current Undo promise after reload unless the exact commit still exists in
  the current history stack.

### Local browser artifacts

Write screenshots, trace on failure, safe network manifest and a compact JSON
assertion report under:

```text
docs/audits/2026-08-27-editor-production-readiness/artifacts/
  cross-browser-media/local/<run-id>/
```

The manifest records only relative file paths, byte lengths, SHA-256 hashes,
browser/runtime identity, safe request IDs, viewport and assertion names. It
must reject local aliases, content hashes, cookies, authorization values,
private response bodies, data URIs, object URLs, signed URLs and raw R2 keys.

### Slice 6A exit

The dedicated two-context Playwright file, existing MEDIA-01 journeys and the
focused Slice 1 through Slice 5 regression matrix pass against native browser
facilities. Context B recovers with empty asset IndexedDB, and the evidence
manifest contains no private material.

### Slice 6A core execution record — 2026-08-30

The dedicated Playwright journey now passes against Studio on port 3001 and
the real local Worker topology. It uses two explicit Chromium contexts with
separate native IndexedDB state and one shared local demo workspace identity.
No Worker route, D1 mapping response, upload response or render response is
mocked.

The accepted core run proves:

- one native local metadata/Blob pair in Context A and zero local records in
  Context B;
- one visible promotion, one managed-use receipt and an exact atomic relink of
  six canonical references: three image nodes, one field default and two field
  current values, including both bound projections;
- Undo and Redo alter only document identity and do not upload or record use a
  second time;
- Context B resolves the real D1-backed alias mapping, persists the managed
  body and recovery receipt, acknowledges **Keep recovered images**, and stays
  stable over reload without local bytes or repeat admission/use traffic;
- real foreground PNG and five-page PDF downloads;
- immutable publication through the WebMCP tool boundary; and
- one idempotent durable render job with two artifacts. The local Workflow
  bridge dropped the POST response after commit, so the journey also proves
  honest `status_unknown`, same-key replay without a second server record, and
  completed-artifact recovery through `inspect_render_history` after reopening
  Studio.

Selected immutable evidence:

`artifacts/cross-browser-media/local/2026-08-30T06:30:25.795Z-9055761b-29f0-4da3-b9f6-26904873b555`

The evidence writer retains only redacted route shapes, safe request IDs,
assertion names, runtime/viewport identity, relative artifact paths, byte
lengths and artifact SHA-256 values. The first candidate evidence run was
discarded before acceptance because its network manifest retained a raw local
alias in a route path; dynamic local, managed, render and artifact path
identities are now redacted before writing.

The selected version-2 run supersedes the earlier desktop-only core run. It
also retains a 390 by 844 review screenshot and proves keyboard traversal to
**Review document images**, eight exact named impact rows (three field slots,
three layers including two bound projections, the page and the output), Escape
focus return to the actual opener, keyboard activation of **Keep recovered
images**, one polite recovery status, empty compact-context local storage and
no document or dialog horizontal overflow. This gate found and repaired one
real shell defect: the recovery banner opened the Media dialog without
recording its focus-return element.

### Slice 6A native race and migration closure — 2026-08-30

The remaining native-browser boundaries now pass in the same dedicated
Playwright file:

- two mounted documents in two tabs of one Chromium profile share the native
  local Blob and promotion notifications. The owner performs exactly one
  upload. The sibling rereads the authoritative D1 mapping after the
  BroadcastChannel hint but does not silently rewrite its mounted document;
  after its device bytes disappear it presents **Studio copy available** and
  relinks all six canonical references only after the user chooses **Use
  Studio copy**;
- an older tab holds the real asset database at version 4 while Studio requests
  version 6. Studio reports the device identity as unavailable without
  deleting or rewriting it. After the old connection closes and Media is
  reopened, the exact metadata and Blob are usable, the database is version 6,
  and the promotion journal store exists; and
- the retained MEDIA-01 browser matrix supplies the critical close guards,
  cancellation, retry/status-unknown, compact containment and focus behavior,
  while the focused promotion/recovery suites cover stable action-node focus
  and polite/alert terminal-state semantics.

Together with the selected version-2 desktop/compact evidence and the focused
61 + 280 + 18/18 regression record below, this completes Slice 6A. It does not
close row 10 or imply any deployed Cloudflare write, restart, isolation or
time-dependent result.

The existing regression gates were rerun after the compact evidence pass:

- Slice 1 domain/command/history: 3 files, 61 tests passing;
- current Slice 2 through Slice 5 local repository, promotion owner/journal,
  use receipt, admission, import, recovery and mounted editor matrix: 15 files,
  280 tests passing; and
- the complete existing MEDIA-01 Playwright suite: 18 of 18 journeys passing.

The MEDIA-01 run also repaired three stale browser-harness assumptions without
weakening product behavior: ambiguous XHR failure now expects truthful
`status_unknown`; the native IndexedDB seed opens current database version 6;
and compact containment tolerates the dialog's one-pixel border inset while
still enforcing zero overflow and fully contained controls. Its missing-byte
journey now follows the production impact-review and inspector-replacement
workflow and waits for the WebMCP snapshot to observe the saved mutation.

## Slice 6B — production runner and read-only baseline

Build a separate production runner. Do not point existing local conformance,
performance or live-editor capture scripts at production because they use a
fresh unauthenticated context and overwrite selected local evidence.

The runner must:

- use a temporary user-data directory outside the repository;
- keep authenticated browser and API requests inside one BrowserContext rather
  than exporting cookies;
- write only to a run-scoped deployed staging directory;
- capture Studio/Renderer deployment IDs, clean commit, migration ledger,
  exact D1 UUID/name, exact R2 bucket names, Workflow identity and Access
  audience hash before the first write;
- use redaction-at-write plus a final recursive secret/private-data scanner;
  and
- atomically promote evidence only after all immediate assertions pass.

Before any production mutation, run only the existing read-only deployment,
resource and migration-prefix checks. A mismatch blocks the production run;
the harness does not repair it automatically.

### Slice 6B exit

The production runner, fixture isolation, redaction tests and read-only baseline
pass locally and against the current account without changing Cloudflare state.

### Slice 6B runner implementation — 2026-08-30

The dedicated read-only runner is now implemented behind
`capture:cross-browser-media:baseline`. It refuses every argument except
`--read-only`, requires a clean committed worktree, uses a temporary persistent
Chromium profile outside the repository, keeps the unauthenticated Access probe
inside that BrowserContext, and deletes the profile without exporting storage
state. Before writing local evidence it captures both Worker deployment/version
identities, the configured/remote D1 name and UUID, exact migration ledger,
both R2 bucket names, Workflow identity, clean commit, Wrangler version and
hashed Access audience/redirect host.

Evidence is first written to a unique `.capture-<run-id>` directory. The
recursive scanner rejects email addresses, credentials, cookies, JWTs, raw
local aliases, private R2 keys, signed URLs, data/object URLs, the account ID
and raw Access audience. Only a fully scanned manifest is atomically renamed
to its immutable run directory; rejected staging data is removed. Seven
focused tests pass for migration-prefix handling, deployment projection,
redaction and atomic promotion. The clean-account baseline must run only after
this implementation commit so its recorded commit and clean-worktree claim are
true.

## Slice 6C — authorized owner production exercise

This gate requires explicit authorization for ordinary production test writes.
After authorization, the owner-authenticated run covers:

- one real multipart local promotion and same-hash/idempotency replay;
- exact D1 promotion mapping, upload/use receipts and request-audit correlation;
- exact R2 object metadata/hash inspected read-only, retaining only key hashes
  and prefix-match booleans;
- a second same-workspace browser with empty local IndexedDB recovering the
  mapped alias;
- timeout, disconnect, committed-response-loss, D1 race and concurrent
  same-alias behavior without duplicate upload;
- ready and archived recovery, reference-protected archive refusal and retained
  bytes;
- cross-browser PNG/PDF, publication and WebMCP completion; and
- network inspection proving no local Blob/file metadata, raw hash, R2 key,
  signed URL, data URI or private managed bytes escaped.

The owner run also retains the deployed conformance and healthy-host renderer
artifacts under a production-only output root without replacing local reports.

### Slice 6C exit

One immutable owner run binds browser screenshots, safe network evidence,
request IDs, D1 rows, R2 hash proof, Worker deployment identities and output
artifacts. Every immediate assertion passes and no secret/private-data scanner
finding remains.

## Slice 6D — separately authorized and time-dependent gates

These cannot be folded into the owner run:

- **same-commit restart:** requires separate permission to redeploy the exact
  clean Studio commit while an active Workflow runs;
- **workspace isolation:** requires a second human Access subject and a
  temporary narrow Allow rule, followed by restoration to the owner-only
  policy;
- **seven-day render expiry:** must wait until the retained `expiresAt` plus
  reconciler and clock-skew margin without editing timestamps; and
- **thirty-day audit retention:** must wait more than 30 days and trigger one
  new authenticated request without editing production rows.

If permission, the second identity or time passage is unavailable, record the
exact blocker, leave the gate open and continue to the next independent product
phase. Do not weaken or simulate the requirement.

## Repository-wide and independent gate

After the browser and authorized deployed evidence is frozen, run:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run format:check
git diff --check
```

An independent reviewer must reread the complete Slice 6 implementation,
evidence manifests, redaction boundary and retained artifacts. Row 10 closes
only on **ACCEPT** with zero open P0/P1 and every non-time-dependent production
gate complete. Time-dependent gates remain separately visible until their real
follow-ups pass.

## Immediate execution order under current authority

1. **Completed:** implement and pass Slice 6A local two-context, same-profile
   race and blocked-upgrade browser evidence.
2. Build Slice 6B production runner/redaction tests and run its read-only
   baseline.
3. Record the production-write, restart, second-identity and time-passage
   boundaries without executing them.
4. Independently review and commit the completed local/read-only gate.
5. Continue the next audited editor/product-depth phase while blocked production
   evidence waits for explicit authority or external state.
