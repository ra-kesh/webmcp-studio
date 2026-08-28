# PERSIST-01B exact stored-document open

Date: 2026-08-29
Status: implementation complete for integration step 3

## Scope

`useDocumentEditor` now exposes `openStoredDocument(documentId)`. The command
opens the requested repository ID directly. It does not infer the target from
the first Recent row and does not substitute the private starter when the
record cannot be opened.

The Start screen still uses its transitional `continueCurrentDraft` adapter.
Its durable branch delegates to `openStoredDocument`. The separately named
`continueSessionEnvelope` path accepts only blocked or unavailable persistence
state with an exact recoverable in-memory envelope. The Recent UI and model
cutover remain outside this change.

## Ownership and admission

The command uses the existing session-transition owner and
`openingDocumentIdRef`. It adds no second opening flag or request guard.

The sequence is:

1. claim the shared `continue` transition;
2. read `repository.get(documentId)`;
3. reject missing, corrupt, deleted, or identity-mismatched records;
4. call `touchOpened(documentId)`;
5. install the touched record, or the verified read when only the activity
   update fails with `storage_unavailable`;
6. clear the exact opening ID and release the same transition in `finally`.

The command checks transition ownership after every awaited repository or
installation operation. It also rechecks authoritative repository readiness
after every await, including while an existing controller is settled before a
new record is installed. Existing Home, replacement, recovery, and unmount
paths therefore keep their first-accepted-wins behavior.

Repository events for the opening ID are reconciled rather than broadly
suppressed. The command's own local `saved/opened` event is an authoritative
barrier for hints received before `touchOpened` commits. After that barrier,
quarantine is terminal; otherwise the highest `recordVersion` among foreign
content saves, deletes, and restores wins, with arrival order breaking equal
versions. Foreign open and publication metadata still invalidate Recent data
without making the document dirty. A late material change is projected as an
external change and is never replaced by the weaker activity-update warning.

## Mounted coverage

The persistence-mounted suite now proves:

- exact-ID selection among multiple active records;
- missing, deleted, and corrupt rejection without opening the private starter;
- missing, deleted, and corrupt rejection from a real active workspace without
  replacing its history, source context, save state, controller, or lease;
- identity-safe cleanup of only the matching transitional Start card;
- verified-record fallback when `touchOpened` cannot update activity because
  storage is unavailable;
- touch-fallback installation preserves a stronger queued external-change
  warning;
- repository-readiness loss during a deferred exact read prevents installation
  and lease acquisition;
- local-open barrier behavior, stale version-two delete/restore hints against a
  verified version-three head, and version-five-before-version-four ordering;
- foreign save, delete, restore, and quarantine races between touch and install;
- local versus foreign open/publication metadata behavior;
- an accepted exact-ID open rejects later Home and replacement transitions;
- the pre-existing delete-between-read-and-touch race still rejects admission;
- the existing Continue, Home, replacement, recovery, and StrictMode lease
  tests still pass through the extracted command.

Latest verification on Node 24.19.0:

- persistence mounted: 67 tests passed;
- Start and StrictMode mounted: 12 tests passed;
- Studio typecheck and scoped ESLint: passed;
- scoped Prettier and diff check: passed.

No Vite, browser, Playwright, Workerd, Wrangler, build, or deployment command
was started.
