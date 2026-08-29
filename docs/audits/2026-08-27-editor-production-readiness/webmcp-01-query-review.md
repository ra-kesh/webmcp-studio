# WEBMCP-01A independent code review

Date: 2026-08-29

Final verdict: **ACCEPT — no remaining P0/P1 blocker**

## Scope reread

The reviewer read the original ARCH-10/WEBMCP-01 audit, the phase contract,
Loora's tree/node/search patterns, the current diff, the WebMCP registration and
query implementation, the Studio registration lifecycle, and focused tests.
The review was code-level and read-only.

## First-candidate rejection

The first candidate had three P1 defects:

1. `read_design_tree` limited pages but emitted every descendant layer, so one
   large page could bypass the response bound.
2. `Promise.all` registration could partially succeed, while the hook reported
   Error/0 without aborting the tools that had already registered.
3. `packages/webmcp/package.json` added the editor workspace dependency without
   updating `bun.lock`.

No P0 was found. The reviewer confirmed that snapshot capture, cursor binding,
canonical ordering, image source redaction, `inspect_design` compatibility, and
the 13-tool success path were otherwise sound.

## Repairs and re-review

- The tree is now a bounded flat pre-order stream. `limit` and cursor apply to
  total semantic items, and every group/node carries page, output, parent, and
  depth identity across continuations.
- Registration failure now aborts the shared signal and disposes its managed
  catalog before publishing error state. A mounted regression proves every
  started tool signal is aborted when one registration rejects.
- The Bun workspace lock now records `@webmcp/editor` for the WebMCP package.

The same reviewer reread the repaired diff and returned **ACCEPT**. All three
P1 findings are closed; there is no remaining P0/P1 blocker for this phase.
