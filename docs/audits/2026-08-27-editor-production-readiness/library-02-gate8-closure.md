# LIBRARY-02 Gate 8 closure

Date: 2026-09-01

Status: independently accepted and integrated into `main`

Branch: `codex/library-02-gate8`

Base: `04602cd96728bdfdaaba7aba858260f653c3849e`

Implementation checkpoint: `1f3cff5983af3fc80ea53b8ed8c3f87aadf541eb`

Accepted evidence checkpoint: `fa3b74a1085c5dc69aaaeb14f31c9882de9c86ca`

Independent re-review: ACCEPT with no remaining P0 or P1 findings

Main integration: `c123cc9`, `eefbc84` and `220ce3a`

This checkpoint closes the final acceptance boundary only. Gates 1 through 6E
and the Gate 7 Assets workspace were already merged before this work began.
Gate 8 did not add catalog inventory or rebuild those gates.

## Acceptance result

- The proposal, portrait-format and social-story discovery journeys each create
  a distinct durable document. Every created document and first page receives
  a fresh ID rather than retaining the canonical template ID.
- General template Apply still requires exact impact confirmation. One Undo
  restores the prior document and quotation source context.
- Quotation-style Apply preserves the edited quotation content, manual text and
  seven-page structure, then one Undo restores the exact prior document and
  source context.
- The focused media matrix passes built-in insert, geometry-safe replacement,
  stale managed rejection, durable local reuse, failure recovery, stale page
  cancellation, missing-blob recovery, bounded object URL release, and 320 px
  and 390 px compact focus containment.
- The existing focused controller, permission, preference, catalog, preview and
  exact-action suites remain green. They retain stale-response rejection,
  cross-tab authoritative refresh, private-data exclusion, permission checks,
  WebMCP parity and bounded preview ownership.
- Desktop and compact Templates and Assets states were visually inspected.
  Assets show the real curated media, not fallback or empty-state placeholders.

## P0 and P1 findings closed during Gate 8

1. **P1, selected template actions were not reachable in the normal editor
   journey.** Editor details rendered after the complete 21-card collection.
   Details and Create/Apply actions now render directly after the selected card,
   with a mounted regression and desktop/compact browser coverage.
2. **P1, the real curated-media content route returned 403 through the static
   asset binding.** The binding request used a synthetic host, so every verified
   curated content request failed before integrity validation. The fetcher now
   preserves the incoming Studio origin. The endpoint returns the exact bytes,
   MIME type, byte count, immutable cache headers and SHA-256 ETag, and the
   browser capture proves that curated previews render.
3. **P1, the retained scale profile contained three copied measurements.** The
   Gate 8 browser test now builds and times its 500-item catalog, times seven
   warm requests through the running local Worker, seeds 1,000 device-local
   summaries in the isolated Playwright profile, counts the mounted cards and
   writes those values and raw samples from the same run.
4. **P1, the desktop Assets capture could precede image decode.** The capture
   now waits until both named curated previews are complete with a nonzero
   natural width. The replacement desktop evidence visibly contains Olive
   botanical and Sandstone arches.

No P0 finding was discovered in the Gate 8 pass.

## Scale evidence

The retained profile is
[`artifacts/library-02-gate8/scale-profile.json`](./artifacts/library-02-gate8/scale-profile.json).
It records Chromium 152 on macOS arm64 with Node 22.23.2 at a 1440 by 900
viewport.

| Budget | Measured result | Limit | Result |
| --- | ---: | ---: | --- |
| 500-item local catalog median | 3.163 ms | under 50 ms | pass |
| Warm local Worker list, 50 summaries, median | 30.097 ms | under 200 ms | pass |
| 1,000-item media collection mounted cards | 5 | at most 32 | pass |
| 1,000-summary browser search request to visible p95 | 60.807 ms | under 250 ms | pass |
| Concurrent preview jobs | 3 | at most 3 | pass |

The browser timing starts when the post-debounce catalog request reaches the
fixture route and stops when the matching card is present in the DOM. Seven
distinct searches are measured. The 180 ms input debounce is recorded
separately and is not counted twice.

The retained JSON includes all seven local-catalog and Worker samples, not only
their medians. The mounted-card figure is queried from the rendered Assets
workspace after its 1,000-item accessibility set is visible. No scale result is
stored as a test constant.

## Retained visual evidence

- [`desktop-templates.png`](./artifacts/library-02-gate8/desktop-templates.png)
- [`desktop-assets.png`](./artifacts/library-02-gate8/desktop-assets.png)
- [`compact-templates.png`](./artifacts/library-02-gate8/compact-templates.png)
- [`compact-assets.png`](./artifacts/library-02-gate8/compact-assets.png)

## Focused verification

- Document catalog, preference, manifest, media identity and quotation tests:
  37 passed.
- Gate 8 Studio controller, catalog, preference, preview, media-action and HTTP
  matrix: 11 files and 153 tests passed.
- Curated-media content and HTTP regressions: 2 files and 8 tests passed.
- Template browser mounted regression: 20 tests passed.
- Template browser journeys and visual/scale fixture: 5 passed.
- Quotation template preservation journey: 1 passed.
- Focused media production journeys: 10 passed.
- Studio typecheck: passed.
- Studio production build: passed.
- `git diff --check`: passed.

The build retains pre-existing warnings for the route-shaped test filename,
the template preview manifest public-path import and large chunks. None changed
the focused Gate 8 result.

## Data and environment safety

- Port 3000 was not used or modified.
- Browser storage and IndexedDB were not cleared.
- The 1,000-item scale fixture was added only to Playwright's fresh, isolated
  browser profile for that test and was discarded with the context.
- The seven known untracked capture directories in the main checkout were not
  modified.
- D1 migrations 0001 through 0017 were applied only to the isolated local
  Wrangler state needed by the worktree test server. No remote migration,
  deployment or production write occurred.
- The work stayed in the isolated worktree at
  `/Users/rakesh/Developer/webmcp-studio-worktrees/library-02-gate8`.

## Integration state

Gate 8 is integrated into `main` as `c123cc9`, `eefbc84` and `220ce3a`.
Their stable patch IDs exactly match `1f3cff5`, `fa3b74a` and `6cb4d4b`.
Re-review of `fa3b74a` returned ACCEPT with no remaining P0 or P1 finding.
A current-main audit confirmed that the accepted code and retained artifacts
remain present after later editor and accessibility changes.
