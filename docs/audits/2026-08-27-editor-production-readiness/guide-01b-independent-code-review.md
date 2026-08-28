# GUIDE-01B independent code review

Date: 2026-08-28

## Verdict

The implementation meets the GUIDE-01B phase-entry contract. Verdict: pass. The initial rejection is preserved below as historical context; every finding is marked resolved after remediation.

## Findings

### High: chronological undo can be wrong when a document mutation follows a guide mutation (Resolved)

`apps/studio/src/features/studio-shell.tsx:480-487` records a guide action immediately, while document actions are appended from the `useEffect` at `:521-539`, after render. If a guide is added or moved and a document operation is dispatched before React commits the effect, the guide remains the last ledger item even though the document operation happened later. `undoSessionAction` at `:541-567` then undoes the guide first. The contract explicitly requires true chronological ordering across domains. Add a synchronous/shared action observation path, or make the ledger authoritative at each command boundary and test guide→document and document→guide sequences in one event loop turn.

### Medium: fallback undo/redo bypasses the session ledger (Resolved)

The fallback branches at `apps/studio/src/features/studio-shell.tsx:569-574` and `:606-612` execute an editor or guide undo/redo without appending/removing a corresponding ledger action. After stale entries are skipped, the next command can operate on a domain while the ledger still describes a different state. This makes chronology depend on whether the ledger happened to contain an entry. Keep the ledger and both underlying histories synchronized, or remove the fallback once the ledger is initialized for every action.

### Medium: guide snap targets are not covered by the observed tests (Resolved)

The wiring exists (`apps/studio/src/features/studio-shell.tsx:439-452`, `:2553`, and `apps/studio/src/features/editor/fabric-artboard.tsx:337-347`), and the adapter filters them at `packages/editor/src/fabric-adapter.ts:1702-1726`. However, the repository search shows no Studio or adapter test asserting page switching, hidden-guide removal, or guide targets reaching move and resize sessions. Add tests that prove invisible guides neither snap nor paint and that active-page targets are sent after page switches.

### Medium: overlay canvas theme reads a nonstandard computed-style property (Resolved)

`apps/studio/src/features/editor/canvas-ruler-guide-overlay.tsx:389-407` uses `computed.color`. `CSSStyleDeclaration` normally exposes `color`, but the test/runtime mocks frequently provide only `getPropertyValue`, and the code already uses that method for `--background`. In those environments the foreground falls back silently, hiding real theme regressions. Read `getPropertyValue("color")` consistently and add a dark-theme draw assertion.

### Low: the pointer overlay is deliberately `aria-hidden`, so keyboard users depend entirely on the dialog (Resolved)

`apps/studio/src/features/editor/canvas-ruler-guide-overlay.tsx:618-623` hides the complete overlay subtree, including guide hit regions. This is acceptable only if `Manage guides…` is always discoverable and works while the overlay is hidden. The dialog does provide labelled numeric controls (`guide-manager-dialog.tsx:228-286`), but there is no test proving the View command opens it with focus when rulers or guides are disabled. Add that command-to-dialog accessibility test.

The paragraphs under the resolved findings record the defects found in the initial pass. They are historical evidence, not open remediation requests. The current-state evidence and final decision follow below.

## Verification

The safe targeted test run was:

`bun test packages/editor/src/page-guides.test.ts apps/studio/src/features/editor/editor-workspace-state.test.ts apps/studio/src/features/editor/canvas-ruler-guide-overlay.test.tsx apps/studio/src/features/editor/guide-manager-dialog.test.tsx --runInBand`

The workspace and pure overlay tests passed where they ran. The React suites did not execute in this Bun environment: `canvas-ruler-guide-overlay.test.tsx` fails because `vi.stubGlobal` is unavailable, and `guide-manager-dialog.test.tsx` fails because `document` is undefined. These are test-environment failures, not evidence of a product pass. No Vite, browser, Playwright, Wrangler, or build commands were run.

## Re-review after remediation

The prior findings are resolved in the changed tree. `use-document-editor.ts:354-363` now emits synchronous `onHistoryCommit` notifications at mutation commit points (`:903`, `:1405`, `:2347`, `:2416`, `:3067`). `studio-session-history.ts` owns pure ledger transitions with dedicated tests, and `studio-shell.tsx:341` injects the callback. The old effect-based document observation and fallback undo/redo paths are gone.

Guide snap projection is covered through `studio-shell.tsx:439-452`, `:2553`, and `fabric-artboard.tsx:337-347`, with tests for projection, hidden guides, active-page routing, and move/resize targets. Escape precedence is centralized in `editor-escape.ts:14-34`, with expanded ownership tests. The overlay foreground now uses `getPropertyValue("color")` (`canvas-ruler-guide-overlay.tsx:404-408`) and has dark-theme coverage. Guide-limit handling and connected focus restoration are explicit in `use-editor-workspace-guides.ts:181-223` and `guide-manager-dialog.tsx:313-333`.

Owner-reported verification is editor 284/284 and Studio 401/401 Vitest tests, with Studio typecheck and focused lint green. No prohibited browser, build, Playwright, Wrangler, or Vite commands were run. Verdict: GUIDE-01B passes the code-review gate. The earlier direct Bun invocation remains an environment mismatch; CI's Vitest/JSDOM results are authoritative for the React suites.
