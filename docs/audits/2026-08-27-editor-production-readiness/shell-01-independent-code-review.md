# SHELL-01 independent code review

Date: 2026-08-28
Reviewer: independent code-review agent
Current code verdict after remediation re-review: **pass**
Phase-closure evidence verdict: **fail until the browser visual gate runs**

The interaction remediation fixed every original P1/P2 and both issues found
during re-review. No remaining product-code defect was found in the reviewed
SHELL-01 scope. The checked-in browser specifications are materially stronger,
but browser execution and the required visual comparison were unavailable on
this host. This report therefore passes the code remediation without claiming
that the SHELL-01 completion gate has run.

## Remediation re-review, 2026-08-28

### Resolved during re-review: first-paint persisted panel geometry

Locations:

- `apps/studio/src/routes/index.tsx:4-9`
- `apps/studio/src/features/studio-shell.tsx:338-375`
- `apps/studio/src/features/studio-shell.tsx:450-452`
- `apps/studio/src/features/studio-shell.tsx:588-599`
- `apps/studio/test/e2e/responsive-shell-accessibility.spec.ts:242-293`

The route is client-only, the lazy state initializer reads validated
localStorage before `StudioShell`'s first render, and the initial available
width now comes synchronously from `document.documentElement.clientWidth` with
`window.innerWidth` as fallback. The `ResizeObserver` remains responsible for
later element-size changes.

The added browser regression seeds 360/440 at 1440px and installs a
`MutationObserver` before reload. Its first mounted geometry sample must be
360/440, which would catch the former 328/408 first frame. The test is
well-targeted, though it was not executed on this browser-disabled host.

### Resolved during re-review: compact density affordance

Locations:

- `apps/studio/src/features/editor/page-filmstrip.tsx:71-74`
- `apps/studio/src/features/editor/page-filmstrip.tsx:441-445`
- `apps/studio/src/features/editor/page-filmstrip.tsx:892-903`
- `apps/studio/src/features/editor/page-filmstrip.tsx:944`
- `apps/studio/src/features/editor/page-filmstrip.tsx:987-1005`
- `apps/studio/src/features/editor/page-filmstrip.visibility.mounted.test.tsx:337-390`

Both saved densities produce the contract-compliant 88px compact composition,
and the density action is now absent below 1280px. The saved desktop preference
is retained. At the desktop media-query boundary the control appears with
`aria-pressed`, an explicit on/off `data-state`, and visible active-state
styling. The mounted test proves compact absence, desktop presence and state,
desktop callback behavior, and the comfortable thumbnail geometry.

### Resolved during re-review: storage-property acquisition failure

Locations:

- `apps/studio/src/features/editor/studio-shell-layout.ts:712-728`
- `apps/studio/src/features/editor/studio-shell-layout.test.ts:406-419`
- `apps/studio/src/features/studio-shell.tsx:337-377`

The synchronous bootstrap originally acquired `window.localStorage` outside
the repository's error boundary. A browser `SecurityError` from that property
getter would have crashed the client-only editor before safe defaults or the
live status region could mount. `bootstrapStudioShellLayout` now contains both
storage acquisition and repository loading. Getter failure returns defaults,
a null repository, and an unavailable result that feeds the live status. A
targeted `DOMException("SecurityError")` regression covers the boundary.

### Current evidence boundary

The browser specification now includes Enter-collapse focus transfer and a
first-mounted-frame geometry sample for persisted 360/440 panels at 1440px.
Those are appropriate regressions. It still needs to run on a browser-capable
host, along with the required visual matrix. The remaining useful coverage
additions are the symmetric right-panel focus path, constrained splitter
interaction at 1280px, pointer dragging, actual filmstrip bounding boxes, and
the 1920px visual fixture. These are acceptance-evidence gaps, not defects found
in the reviewed implementation.

### Original finding disposition

- **Resolved:** constrained resizing now uses live resolved coordinates,
  preserves the opposite panel, exposes a live maximum, and has left/right
  constrained regression tests.
- **Resolved:** Enter-collapse requests focus transfer to the persistent panel
  toggle after commit. The browser specification now proves the left path; the
  symmetric right path remains an evidence gap rather than a different code
  path.
- **Resolved:** both saved densities render an 88px compact strip, while desktop
  remains 96px/120px. Canvas and crop toolbar reserves are 100px in compact
  mode and 108px/132px on desktop, matching strip height plus 12px.
- **Resolved:** the former undersized compact density target is eliminated by
  omitting the desktop-only control from compact mode.
- **Resolved:** `lostpointercapture` settles pending work, clears resize state,
  accepts a fresh drag, and does not double-settle after normal release.
- **Resolved:** client-only rendering, synchronous preference loading, and a
  synchronous client viewport width remove both the default-state and
  wrong-width first frames. A targeted first-mounted-geometry browser
  regression is checked in.
- **Resolved:** an always-mounted polite status region exposes layout storage
  errors even when the actions menu is closed.
- **Resolved:** raster thumbnails now carry integer intrinsic dimensions and
  loading pulse disables under reduced motion.
- **Resolved during re-review:** compact mode no longer exposes a density
  action with no compact visual result; desktop retains a stateful control.
- **Resolved during re-review:** storage-property getter failure is contained
  by the bootstrap boundary and returns safe defaults plus a live error.
- **Still positive:** shell preferences remain outside canonical document and
  history state; compact Sheets, independent panel scrolling, raster caching,
  and page-order ownership are unchanged.

## Original review findings (historical)

The findings below record the state before remediation. Their current status is
listed above; they are retained so the review remains auditable.

### P1: constrained resizing reverses the dragged divider and changes the untouched panel

Locations:

- `apps/studio/src/features/editor/studio-shell-layout.ts:443-475`
- `apps/studio/src/features/studio-shell.tsx:367-380`
- `apps/studio/src/features/studio-shell.tsx:2549-2558`
- `apps/studio/src/features/studio-shell.tsx:2933-2942`
- `apps/studio/src/features/editor/studio-shell-layout.test.ts:180-187`
- `apps/studio/test/e2e/responsive-shell-accessibility.spec.ts:179-228`

`resolveStudioShellLayout` proportionally reduces both requested panel widths
when their sum exceeds the panel budget. The shell then gives each splitter
the resolved width as `value`, but `previewShellPanelWidth` writes the next
splitter value back as that panel's persisted requested width while retaining
the other panel's larger requested width.

Concrete reproduction with the shipped pure functions:

1. Save left/right preferences at 360/440 on a wide viewport.
2. Resolve them at 1280px. The visible widths are 328/408 and the canvas is
   520px.
3. Start on the visible left width of 328 and drag the divider 8px right. The
   splitter sends 336.
4. Store 336 beside the still-requested right width of 440 and resolve again.
   The visible widths become 318/418.

The pointer moved right, but the left divider moves 10px left and the untouched
right panel grows by 10px. `End` also advertises a static 360px maximum that is
not reachable in this state, so `aria-valuemax` no longer describes the live
constraint.

The existing layout test proves proportional window reconciliation in
isolation. The browser test starts from defaults at 1440px and presses one
Arrow key, so it never enters the conflicting requested-versus-resolved state.

Remedy: keep persisted preferred widths separate from the live resolved pair.
At the start of a pointer or keyboard resize, materialize the current resolved
pair as the interaction base, constrain the active panel against the current
other panel plus the 520px canvas and both 12px splitters, and leave the other
visible panel unchanged. Pass the resulting live maximum to the separator's
ARIA values. Add a regression test for wide max widths, resize to 1280px, then
pointer and keyboard changes in both directions for both splitters.

### P1: Enter-collapse removes the focused splitter without restoring focus

Locations:

- `apps/studio/src/features/editor/editor-panel-splitter.tsx:170-176`
- `apps/studio/src/features/studio-shell.tsx:2473-2562`
- `apps/studio/src/features/studio-shell.tsx:2578-2594`
- `apps/studio/src/features/studio-shell.tsx:2931-2996`
- `apps/studio/src/features/editor/editor-panel-splitter.test.tsx:94-127`
- `apps/studio/test/e2e/responsive-shell-accessibility.spec.ts:200-208`

Enter invokes `onToggleCollapse`. The parent immediately stops rendering the
focused separator because the whole panel/splitter fragment is conditional.
No code transfers focus to the persistent "Expand document panel" or "Expand
properties panel" button. The browser therefore falls back to the document
body after the focused node is removed.

The component test only checks that the callback ran. The browser test
collapses by clicking the separate toolbar button, so it does not exercise the
required splitter keyboard path.

Remedy: when collapse originates from a splitter, move focus after the state
commit to its persistent expand button, or keep a collapsed rail containing a
reopen control. Add a mounted test that focuses each splitter, presses Enter,
asserts collapse and focus on the matching expand control, then activates that
control and verifies the restored width.

### P1: the compact filmstrip can grow to 112px and keeps the large-density control visible

Locations:

- `docs/audits/2026-08-27-editor-production-readiness/shell-01-phase-entry.md:88-98`
- `apps/studio/src/features/editor/page-filmstrip.tsx:57-65`
- `apps/studio/src/features/editor/page-filmstrip.tsx:851-865`
- `apps/studio/src/features/editor/page-filmstrip.tsx:948-965`
- `apps/studio/src/features/studio-shell.tsx:2820-2836`
- `apps/studio/src/features/editor/page-filmstrip.visibility.mounted.test.tsx:224-240`
- `apps/studio/src/features/editor/page-filmstrip.visibility.mounted.test.tsx:243-326`

The contract sets compact layouts at 72-88px or routes pages through the Pages
Sheet. The user-global `comfortable` preference instead renders `h-28` below
1280px, and the density toggle remains available there. A user who selects the
comfortable desktop strip therefore gets a 112px strip after moving to a
compact viewport.

The tests explicitly encode 112px as the compact comfortable height, so green
tests currently certify the contract violation. They also inspect class names
rather than rendered height.

Remedy: retain the user's desktop preference but force the compact composition
to an 88px gallery, or remove the compact filmstrip and use the existing Pages
Sheet. If the toggle stays in compact mode, both density choices must fit the
compact height budget. Test computed bounding boxes at 320, 390, 1119, 1280,
1440, and 1920px.

### P2: the compact density button has a 28px target

Locations:

- `apps/studio/src/features/editor/page-filmstrip.tsx:948-963`
- `docs/audits/2026-08-27-editor-production-readiness/visual-and-interaction-audit.md:116-123`

The density button uses `size-7` at every viewport. This is below the audit's
44px compact/coarse-pointer target and is the smallest action in the strip.
The adjacent page menu uses the correct 44px compact target.

Remedy: use a 44px hit area below the desktop breakpoint while keeping the icon
at the shared small scale. Add a compact bounding-box assertion to the browser
matrix.

### P2: unexpected pointer-capture loss can leave the splitter stuck in resize mode

Locations:

- `apps/studio/src/features/editor/editor-panel-splitter.tsx:111-168`
- `apps/studio/src/features/editor/editor-panel-splitter.tsx:204-209`
- `apps/studio/src/features/editor/editor-panel-splitter.tsx:224-235`
- `apps/studio/src/features/editor/editor-panel-splitter.test.tsx:149-234`

Pointer up and pointer cancel settle the drag, but the separator does not handle
`lostpointercapture`. If capture moves to another element or is lost without a
delivered cancel, `dragRef` remains populated and `resizing` remains true. New
pointer-down attempts are then rejected by the `dragRef.current` guard. The
unmount cleanup cancels the animation frame but cannot recover a still-mounted
stuck handle.

Remedy: handle `lostpointercapture` with an idempotent settle or cancel path.
Track the latest clamped value in a ref and test capture loss both before and
after a queued animation frame.

### P2: persisted desktop layout is applied only after the server-rendered shell has painted

Locations:

- `apps/studio/src/routes/index.tsx:4-7`
- `apps/studio/src/features/studio-shell.tsx:336-400`
- `apps/studio/src/features/studio-shell.tsx:521-546`

This route is server rendered. The server and hydration render use the default
expanded 264/336 layout. A passive effect reads localStorage later and replaces
it with the user's saved widths, collapse flags, and filmstrip density. Reloading
with a collapsed panel or non-default width therefore paints the default shell
before visibly shifting to the saved shell. Hydration itself is safe, but the
reload behavior is not polished persistence.

Remedy: bootstrap local layout before first paint with a small head script that
sets validated shell CSS variables and collapse attributes, or use a
server-readable user preference. React state should then adopt the same value
during hydration. Add a reload visual test for both panels collapsed and for
non-default widths.

### P2: shell-layout persistence failures are not announced when the actions menu is closed

Locations:

- `apps/studio/src/features/studio-shell.tsx:355-364`
- `apps/studio/src/features/studio-shell.tsx:521-532`
- `apps/studio/src/features/studio-shell.tsx:1656-1667`
- `apps/studio/src/features/studio-shell.tsx:2398-2455`

Read, recovery, and write failures update `shellLayoutError`, but the message is
rendered inside the closed More actions menu. The always-mounted live save
badge does not contain this error. Changing the More button's accessible name
to "attention required" does not announce the actual failure or its effect.

Remedy: expose the newest workspace error in an always-mounted polite live
region and keep the detailed copy in the menu. Add a mounted test for a throwing
storage implementation.

### P2: thumbnail fallback motion and raster image markup miss two interface rules

Locations:

- `apps/studio/src/features/editor/page-filmstrip.tsx:260-284`

Raster images rely on inline CSS dimensions but omit HTML `width` and `height`
attributes. The loading placeholder uses `animate-pulse` without a
`motion-reduce` override. The fixed thumbnail wrapper limits layout movement,
so this is not a structural filmstrip failure, but both issues are visible in a
dense, frequently mounted navigation control.

Remedy: set integer `width` and `height` attributes from the raster/display
geometry and disable the pulse under reduced motion.

## Original test and evidence gaps (historical)

The checked-in browser test is useful but does not satisfy the SHELL-01 gate.
`apps/studio/test/e2e/responsive-shell-accessibility.spec.ts:179-236` covers one
left-panel Arrow resize at 1440px, collapse through the toolbar button, density
persistence, canvas minimum, and the compact breakpoint. It does not cover:

- pointer dragging or animation-frame coalescing in a browser;
- the reconciled max-width state at 1280px;
- right-panel resize, collapse, or restore;
- Enter collapse from a focused separator;
- Home, End, Shift+Arrow, live ARIA maximums, or focus after collapse;
- actual filmstrip height, horizontal scrolling, or compact density targets;
- independent panel scrolling;
- a 1920px layout;
- a visual comparison or screenshot against the reference target.

The phase contract at
`docs/audits/2026-08-27-editor-production-readiness/shell-01-phase-entry.md:134-137`
and `:154-161` says static tests alone cannot close the phase. Browser execution
was intentionally unavailable on this host, so no browser result is claimed.

## Confirmed positives

- The encoded panel bounds, defaults, 520px canvas minimum, and 12px splitter
  accounting match the phase table.
- `StudioShellLayoutRepository` validates an exact versioned shape, clamps
  finite widths, rejects invalid runtime writes, quarantines corrupt bytes, and
  returns safe defaults when storage fails.
- Shell preferences remain user-global workspace state. They do not enter the
  canonical document, quotation payload, renderer manifest, WebMCP state, or
  document/guide history.
- Both desktop panels have independent min-height and overflow ownership. Their
  existing template, page, layer, design, fields, and review content keeps its
  own scrolling containers.
- Compact Sheets remain separate from desktop panel visibility preferences.
  A collapsed desktop panel does not remove its compact Sheet capability.
- The splitter has a 12px hit target, a 1px visible divider, focus-visible
  styling, pointer capture, primary-button filtering, 8/32px keyboard steps,
  Home/End support, and animation-frame coalescing. Scheduled work is canceled
  on unmount.
- The filmstrip derives page order from `output.pageIds`, preserves aspect
  ratios, keeps page and context actions reachable, uses roving page focus, and
  keeps the active thumbnail live.
- Inactive thumbnail rasters use revision/renderer/size keys, bounded
  concurrency, exact-request deduplication, abortable work, LRU eviction, URL
  revocation, transient retry, and viewport-margin observation. The overlay
  offsets are 12px above each declared filmstrip height in both density modes.

## Verification run

Run from `apps/studio`:

```text
bunx vitest run --config vitest.config.ts \
  src/features/editor/studio-shell-layout.test.ts \
  src/features/editor/editor-panel-splitter.test.tsx \
  src/features/editor/page-filmstrip.visibility.mounted.test.tsx \
  --maxWorkers=1
```

Result after remediation: 3 files passed, 58 tests passed.

```text
bunx eslint \
  src/features/editor/studio-shell-layout.ts \
  src/features/editor/studio-shell-layout.test.ts \
  src/features/editor/editor-panel-splitter.tsx \
  src/features/editor/editor-panel-splitter.test.tsx \
  src/features/editor/page-filmstrip.tsx \
  src/features/editor/page-filmstrip.visibility.mounted.test.tsx \
  src/features/studio-shell.tsx \
  src/routes/index.tsx \
  test/e2e/responsive-shell-accessibility.spec.ts
```

Result: passed with no findings.

```text
bun run typecheck
bunx prettier --check <the reviewed implementation and test files>
```

Result: both passed.

The focused green suite confirms the code's current assertions. Browser and
visual acceptance remain a separate phase gate as described above.
