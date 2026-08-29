# WEBMCP-01B canonical capability discovery phase entry

Date: 2026-08-29

Status: completed and independently accepted

## Outcome

Expose the same complete command policy that drives Studio's menus, command
search, toolbar, canvas, and structure controls. An agent must be able to ask
what is possible now, why a command is disabled, and which stable target and
arguments the answer applies to before any generic execution endpoint exists.

## Evidence reread

- ARCH-10 and WEBMCP-01 in the original production-readiness audit/backlog.
- `packages/editor/src/product-commands.ts`, including `productCommandIds`,
  `resolveProductCommand`, target validation, parameterized alignment and
  distribution, structure policy, dynamic labels, and checked state.
- Studio's actual `ProductCommandRuntimeContext`, transient crop policy, output
  policy, guide state, and current editor-only WebMCP projection.
- Loora's compact context/read-first MCP vocabulary and its rule that agent
  operations share the human transaction engine. Studio adopts the shared
  policy boundary, not Loora's direct mutation breadth.

## Product contract

Add one read-only `get_capabilities` tool sourced from a new canonical editor
projection over every `productCommandId`, including non-palette commands and
the concrete alignment/distribution variants.

The tool accepts optional category, scope, command ID, enabled-state, and stable
page/output target filters. Current-selection capabilities remain tied to the
actual visible selection; the tool must not fabricate a selection on another
page. Page/output targets reuse the exact structure and export policy already
used by Studio.

Every capability returns:

- a unique invocation key and canonical command ID;
- label, category, subgroup, scope, mutation/destructive policy;
- exact target and typed arguments where required;
- enabled, checked, and exact disabled reason from `resolveProductCommand`;
- `execution: "not_exposed"` in this phase, so discovery never implies that a
  generic direct mutation endpoint exists.

The response carries document ID, revision, snapshot ID, and operation version.
Target resolution is synchronous against that exact snapshot. Unknown page or
output IDs return typed errors and never move the active page or selection.

## Acceptance boundary

- The complete canonical vocabulary is projected; no second WebMCP command
  registry or hand-maintained enablement table is introduced.
- Parameterized align/distribute invocations are individually discoverable.
- Locked/review/crop/selection/page/output/PDF-disabled reasons match the UI
  resolver, including transient live crop state.
- Existing `inspect_design.commandCapabilities` remains compatible but receives
  the richer canonical active-context projection.
- Registration catalog/count/lifecycle stay truthful and privacy-safe.
- Focused editor projection, WebMCP registration, and mounted live-policy tests,
  both package typechecks, focused lint/format, independent review, ledger
  update, and commit close the gate.

## Deliberate next boundary

WEBMCP-01C will design canonical command execution with dry-run/proposal/direct
modes, expected snapshot identity, idempotency, and the existing human Review
owner. This phase does not expose generic execution or bypass Review.

## Completion evidence

- The shared editor resolver now projects all 73 canonical command IDs into 85
  concrete capabilities, including the 12 alignment and two distribution
  variants. No WebMCP-only command policy or enablement table was introduced.
- `get_capabilities` supports current, page, and output targets with typed
  filters and arguments. Non-current targets do not fabricate a selection;
  page structure and output/PDF policy reuse the exact Studio runtime context.
- Every response reports the captured document revision, snapshot, and
  operation version. Missing targets and stale context return typed errors.
- Studio overlays the live image-crop session before canonical resolution, so
  agent-visible enablement and disabled reasons match the current interface.
  Private runtime context and asset internals are never returned.
- Discovery is deliberately read-only. Every capability states
  `execution: "not_exposed"`; Review ownership and all mutation paths remain
  unchanged.
- The independent code reviewer returned **ACCEPT with no P0/P1 findings**.
  `webmcp-01b-capability-review.md` records the scope and evidence.
- Focused tests pass: editor command projection **17/17**, WebMCP **47/47**, and
  Studio mounted lifecycle/live-policy **4/4**. Editor, WebMCP, and Studio
  typechecks, focused Studio ESLint, scoped Prettier, and `git diff --check`
  pass. The live canonical document route exposes all 14 registered tools.
