# PERSIST-01B Recent and Trash model review

Date: 2026-08-29
Reviewer: independent code review
Verdict: APPROVE

## Scope

I reviewed the actual model and test code against:

- `persist-01b-recent-trash-phase-map.md`;
- `persist-01b-recent-provider-integration-map.md`;
- the approved controller and provider implementations and their independent
  reviews;
- the repository's `DocumentDraftSummary`, `DraftOrigin`, recovery, and failure
  contracts;
- the planned component's dialog, alert, focus, date, and virtualization needs.

I did not edit production code or tests.

## Verdict

**APPROVE. There are zero open P0, P1, or P2 findings in the pure Recent and
Trash model.**

The final re-review read the production model, its entire deterministic suite,
the implementation note, and this review history again. It verified all seven
recorded findings against the final code rather than accepting the repair
summary.

The two findings from the first re-review are now closed:

- the timestamp parser accepts arbitrary repository-valid fractional
  precision and normalizes it to the JavaScript millisecond instant;
- repository-valid year 0000 retains its canonical ISO value as both the
  machine-readable time and the visible label, avoiding `Intl`'s ambiguous
  year-one rendering;
- one `Intl.DateTimeFormat` and one `Intl.NumberFormat` are constructed per
  ready collection projection and shared by page age and all rows. The 100-row
  test asserts the exact constructor count without a timing threshold.

The original P1 and four P2 findings also remain closed: off-row Rename state
retains ID, owner, input, captured CAS version, phase, and error; query misses
preempt no-query recovery-only and empty states while retaining recovery
warnings; impossible dates do not normalize into contradictory output;
quarantine keys follow controller identity; and every prior silent test return
has been replaced by a failing status assertion with the claimed state matrix
covered.

## Second re-review findings, resolved in final re-review

### P2: The timestamp parser rejects repository-valid fractional precision

Location: `recent-documents-model.ts:285-361`

The repaired parser correctly rejects impossible dates and normalizes offsets,
but its fractional-second expression accepts only one to three digits. ISO and
RFC 3339 timestamps may carry more fractional digits, and the current repository
`validTimestamp()` contract accepts them through `Date.parse()`.

For example, the repository accepts
`2026-08-29T10:30:00.1234Z`, while the model projects `Activity date
unavailable`. This makes a repository-valid summary lose truthful activity
metadata. The same parser accepts year `0000`, then `Intl.DateTimeFormat`
renders it as `Jan 1, 1` without an era, so the machine and visible year are not
unambiguous.

Required repair: align the model and repository timestamp domains. The least
disruptive model repair is to accept arbitrary fractional precision, normalize
to the JavaScript millisecond instant, and reject year zero. Add deterministic
tests for both cases. If the product instead requires exactly millisecond
precision, narrow the repository validator in the same phase so list summaries
cannot enter a state the model calls invalid.

### P2: Long-list projection constructs two `Intl` formatters per row

Locations:

- `recent-documents-model.ts:256-268`
- `recent-documents-model.ts:270-361`
- `recent-documents-model.ts:425-460`

Each row calls `numberFormatter()` once and `recentDocumentActivity()` creates a
new `Intl.DateTimeFormat`. A 100-row projection therefore constructs 100 number
formatters and 100 date formatters before React reaches the virtualized DOM.

On the review host with Node 24.19.0, 1,000 repetitions of the same 100-row
formatter-construction work averaged about 12.6 ms per projection. The exact
time is machine-dependent, but the 200-constructor count is deterministic. It
uses most of a 60 Hz frame before rendering, so virtualization does not solve
the model-side cost.

Required repair: construct one number formatter and one date formatter per
projection, or use a bounded stable cache keyed by locale and time zone, then
pass them through row/activity formatting. Add a deterministic construction-
count test rather than a timing threshold.

## Initial findings, resolved in re-review

### P1: Rename ownership disappears when its row leaves the confirmed page

Locations:

- `recent-documents-model.ts:308-326`
- `recent-documents-model.ts:350-385`
- `recent-documents-model.ts:414-435`

The approved controller intentionally keeps a rename reservation after a
replacement list removes the cached row. It also keeps the reserved ID, typed
input, captured `expectedRecordVersion`, and eventual inline failure. Its
regression test proves that this state remains submit-capable after the row is
gone.

The model exposes rename state only inside `RecentDocumentRowModel`. Once the
row is absent, neither `rows` nor `actionFailures` gives the component enough
data to keep the dialog open. `actionFailures` carries only a message and drops
the input and captured version. There is a second loss on the ordinary visible
path: a submitting rename is reduced to `{ status: "submitting", kind:
"rename" }`, which drops the user's typed input and captured version while the
request is pending.

A component built on this model would close or blank an explicitly opened
Rename dialog during a valid refresh race. That breaks the controller's repaired
CAS and failure-retention contract.

Required repair:

- project rename dialog state independently of visible rows, keyed by document
  ID and owner;
- retain `input`, `expectedRecordVersion`, phase, and error during editing and
  submitting;
- keep row action state as a convenience projection, but do not make row
  presence the owner of the dialog;
- add tests for a hidden editing rename, a hidden failed rename, and a visible
  and hidden submitting rename. Different-document concurrent actions must stay
  representable.

### P2: A sticky recovery item masks a confirmed search miss

Location: `recent-documents-model.ts:561-570`

For zero rows, the model checks global sticky recovery inventory before it
checks `appliedQuery`. A confirmed query miss with any earlier recovery item
therefore becomes `recovery_only` instead of `no_results`.

The phase contract says a confirmed query miss preserves the query and offers
Clear search. Recovery inventory remains visible in the shared warning area; it
does not replace the search result's meaning. The current ordering gives the
wrong main-state copy and omits the `canClearQuery` capability from that union
member.

Required repair: when a confirmed page has no rows, an applied query must
project `no_results` before the no-query `recovery_only`, `empty_recent`, or
`empty_trash` decisions. Keep the sticky recovery items on the base model so the
warning remains visible.

### P2: Parseable but invalid calendar timestamps produce contradictory output

Location: `recent-documents-model.ts:270-286`

`recentDocumentActivity()` treats every value accepted by `Date.parse()` as a
valid exact timestamp and forwards the original string into `<time
dateTime>`. JavaScript normalizes some invalid calendar dates. The current code
produces this result:

```text
input:    2026-02-30T00:00:00.000Z
dateTime: 2026-02-30T00:00:00.000Z
label:    Mar 2, 2026 at 12:00 AM
```

The visual label and machine-readable date disagree, and the `dateTime` value
is not a valid calendar instant. The repository's current timestamp predicate
also uses `Date.parse()`, so the model cannot assume that every summary already
contains canonical ISO text.

Required repair: either reject noncanonical date-time strings and return
`Activity date unavailable`, or normalize the machine-readable value to the
same exact instant used for the localized label. Add impossible-calendar,
non-ISO parseable, valid offset, and canonical UTC cases. Keep locale and time
zone explicit in every test.

### P2: Quarantine recovery keys do not follow controller identity

Location: `recent-documents-model.ts:388-402`

The controller deduplicates quarantined recovery items by `quarantineId` and can
replace a generic event message with the exact list descriptor. The model key
also includes document ID, failure kind, and failure message. The same recovery
item therefore receives a new React key when its description becomes more
exact.

That remount can lose focus and repeat live-region output for one logical
recovery item. It also disagrees with the approved deduplication identity.

Required repair: mirror the controller identity. Use quarantine status plus
`quarantineId` for quarantined items. Use the retained-item tuple already
defined by the controller for retained failures. Add a test proving that a
generic-to-exact quarantine message replacement keeps the same key.

### P2: The test gate can pass after material projection regressions

Locations:

- `recent-documents-model.test.ts:286-300`
- `recent-documents-model.test.ts:404-469`
- `recent-documents-model.test.ts:471-490`
- `recent-documents-model.test.ts:493-525`
- `recent-documents-model.test.ts:528-548`
- `recent-documents-model.test.ts:550-565`

Several tests narrow with `if (!("rows" in model)) return` or the equivalent
for virtualization without first asserting the expected union member. If the
projection returns a top-level opening, blocked, unavailable, or recovery state,
those tests silently pass without checking the behavior named in the test.

The suite also says it retains provider migration state and warning "in every
collection state", but tests only `empty_recent` with migration status `empty`.
It does not cover migrated or collision status, warning retention across
opening, ready, pagination, retained error, and terminal error states, hidden
action failures, submitting actions, quotation and standalone source labels,
or a recovery item combined with a query miss. The implementation note's claim
that these matrices are covered is therefore inaccurate.

Required repair:

- assert the exact union status before narrowing and fail explicitly if it is
  wrong;
- use a table over every collection state that carries the ready-provider
  migration and warning fields;
- cover visible and hidden action ownership, every submitting/failure kind,
  all source labels, the two query/recovery precedence cases, both
  virtualization boundaries, invalid confirmation time, another locale, and
  the timestamp cases above.

## Checks run

Using Node 24.19.0 from the repository workspace:

- focused Vitest after the final repair: 1 file, 41 tests passed;
- Studio typecheck: passed;
- scoped ESLint: passed;
- scoped Prettier check: passed;
- no whitespace errors in no-index diff checks for the two new files.

No Vite, build, Workerd, Wrangler, Playwright, or browser process was started on
the restricted host.

## Approved scope

Approval covers the pure model and its deterministic suite. React composition,
focus execution, semantic markup, keyboard flow, virtual row measurement,
canonical routing, and healthy-browser acceptance remain in their named later
gates.
