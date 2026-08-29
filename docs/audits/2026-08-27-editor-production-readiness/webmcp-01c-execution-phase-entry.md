# WEBMCP-01C canonical command execution phase entry

Date: 2026-08-29

Status: completed and independently accepted

## Outcome

Turn WEBMCP-01B's truthful capability discovery into one safe command adapter
without creating a second mutation engine or allowing automation to bypass the
visible Review owner.

## Evidence reread

- ARCH-10 and WEBMCP-01 in the original architecture audit and production
  backlog.
- `packages/editor/src/product-commands.ts` and Studio's
  `executeProductCommand`, including exact target validation, live enablement,
  dialogs, downloads, asynchronous critical actions, and current Review/crop
  locks.
- The existing WebMCP proposal tools and document `ChangeSet` validation,
  preview, decision, and apply path.
- Loora's `packages/canvas/src/engine.ts`,
  `packages/agent/src/canvas-tools.ts`, and MCP tool manifest. The adopted
  lesson is one validated operation vocabulary and explicit destructive
  policy; no Loora code or website-builder scope is imported.

## Product contract

Add one `execute_product_command` tool whose input contains a canonical command
invocation, an explicit `dry_run`, `proposal`, or `direct` mode, exact document
revision/snapshot/operation identity, and a caller-provided idempotency key.

- `dry_run` resolves, validates, and compiles the same deterministic plan used
  by an executable direct/proposal command against one captured snapshot. It
  never changes document or interface state. Discovery-only commands return a
  typed unsupported result instead of a false successful dry run.
- `proposal` may create only document commands that the existing Review panel
  can preview and apply atomically. The tool never marks operations accepted or
  applies them.
- `direct` is allowed only for explicitly classified non-document interface
  commands. Document mutations, destructive actions, file pickers, navigation,
  dialogs, exports, publish, and open-world work are never silently promoted to
  direct execution.
- Unsupported mode/command combinations return a typed policy result and the
  appropriate existing specialized tool when one exists.

Every result includes stable status/code, command and mode, idempotency key,
base identity, result identity when known, affected page/node/output IDs,
warnings, and exact canonical disabled reason. Concurrent replay of the same
key and exact request shares one in-flight result; reusing a key for a different
request fails. Proposal identity is derived from the exact request so a
repeated request produces the same proposal IDs. Receipts for direct
session-only interface commands are scoped to the live registration because
none of those commands changes durable content.

## Acceptance boundary

- Invocation parsing cannot create targets that were not returned by the
  canonical capability projection.
- The command is resolved again immediately before dispatch; stale document,
  snapshot, operation, selection, page, and output identity fail closed.
- Proposal commands compile to existing `DocumentCommand` operations and use
  the existing `proposeChangeSet` owner. There is no parallel review state.
- Idempotency receipts are bounded, concurrent-safe, and scoped to the live
  registration. Deterministic proposal identity makes a proposal replay stable;
  durable document mutations remain owned by Review and persistence.
- Capability discovery truthfully reports execution modes after this gate.
- Focused editor/WebMCP/Studio tests, typechecks, lint/format, live tool
  registration, independent code review, ledger update, and one commit close
  the gate.

## Deliberate limits

Commands whose current UI contract merely opens a dialog, picker, download, or
async workflow are not falsely advertised as generic executable commands.
Their typed argument and durable job contracts remain follow-on work or stay on
their existing purpose-built WebMCP tools.

Receipt durability across a registration or page reload is not claimed. A
deterministic proposal identity makes retries inspectable and stable, but it
does not by itself prevent the current in-memory Review owner from receiving a
duplicate proposal after reload. Durable proposal history and cross-session
deduplication remain part of REVIEW-02.
