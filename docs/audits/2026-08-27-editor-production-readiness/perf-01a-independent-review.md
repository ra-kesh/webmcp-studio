# PERF-01A independent code review

Date: 2026-08-29  
Verdict: **ACCEPT — no remaining P0/P1 findings**

## Reviewed scope

- `apps/studio/src/features/editor/page-filmstrip.tsx`
- `apps/studio/src/features/editor/page-filmstrip.visibility.mounted.test.tsx`
- `apps/studio/src/features/studio-shell.tsx`
- `apps/studio/test/e2e/perf-01-scale.spec.ts`
- `artifacts/perf-01-scale-profile.json`

The review read the implementation and regression code. It did not accept the
browser screenshot or phase summary as proof by itself.

## Rejected P1s and closure

The first review rejected transition-deferred viewport exits. An inactive page
could leave the preload margin while a delayed React visibility update still
made it eligible for admission or postponed cancellation. Native observer truth
is now written synchronously. Exit clears its exact admission timer and cancels
its revision-keyed cache request before visibility is published in a React
transition.

The re-review found a narrower urgent-render race: a synchronous cancel could
be followed by an urgent editor commit whose request effect still saw stale
transition state and recreated the raster. The request effect now independently
requires raw observer visibility for every request and cancels whenever either
raw or committed visibility is absent. The regression forces a `flushSync`
active-page render after viewport exit, verifies immediate `AbortSignal`
cancellation, advances the admission window, and proves the producer remains at
one call.

The first review also rejected the evidence gate because fallback mode or zero
requests could pass, sequential request storms were not bounded, and a failed
run could overwrite accepted evidence. The browser gate now requires:

- renderer-backed mode;
- at least one thumbnail request;
- at most three total starts in the measured interaction window;
- at most three concurrent requests;
- the retained live-Artboard, Object-URL, frame, and page-switch budgets.

All assertions execute before evidence promotion. The accepted JSON path is
anchored to the test source rather than the caller's working directory, and a
temporary file is renamed atomically only after the complete gate passes.

## Evidence retained

- 100 pages and 800 nodes in real Chromium.
- 90 alternating full-range scroll frames at 24.2 ms p95.
- Page 100 acknowledgement in 361 ms.
- Three total starts and maximum concurrency three.
- 32 mounted filmstrip tests and 43 combined cache/filmstrip tests passing.
- Studio typecheck and scoped lint passing.

Wrangler's local Browser simulator completed no raster in the selected run.
The review therefore accepts only interaction scheduling and cancellation.
Healthy-host steady-state latency, visual parity, cache hits, memory after
completion, and Object-URL release remain open PERF-01B evidence.
