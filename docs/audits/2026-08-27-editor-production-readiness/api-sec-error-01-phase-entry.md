# API-SEC-01 / API-ERR-01 phase entry

Date: 2026-08-30

Status: completed locally and independently accepted; deployed hostile-network
evidence remains open

## Outcome

Make every public Studio API request attributable, workspace-scoped, bounded,
and machine-readable without replacing the identity, repository, or durable
render owners already accepted in earlier gates.

## Evidence reread

- `production-readiness-backlog.md` and
  `remaining-product-work-2026-08-29.md`: principal/workspace ownership,
  request IDs, quotas, safe resources, audit records, stable codes, paths, and
  retryability are the remaining boundary.
- `studio-principal.ts`, the `/v1` route handlers, media/thumbnail HTTP
  adapters, render admission Durable Object, and JSON body policy: Cloudflare
  Access/local-demo identity, workspace-scoped repositories, bounded JSON and
  upload bodies, render resource limits, daily budgets, concurrency, and
  idempotency already exist and remain authoritative.
- Loora `crates/mcp-server/src/server.rs`, `auth.rs`, and `rate_limit.rs`: the
  adopted pattern is ordered anonymous limiting, one authentication decision,
  account-scoped limiting, explicit retry headers, and tests for unavailable
  authentication. Studio keeps its own REST contract and Cloudflare storage.

## Current defects

- Public failures use incompatible shapes: a string `error`, a nested error
  with only `code`, or a nested error with route-specific fields.
- JSON body errors, authentication errors, validation failures, conflicts,
  renderer failures, admission failures, and not-found responses do not share
  request identity, retryability, or field-path conventions.
- Successful and failed `/v1` responses do not universally expose a stable
  request ID, making durable-job, renderer, and client reports hard to join.
- There is no durable request audit record tying method/path/status to the
  resolved principal and workspace. Audit data must not include request bodies,
  tokens, cookies, document content, asset bytes, or untrusted error messages.
- Expensive render work has accepted quota and concurrency limits, but the
  public contract does not consistently expose `Retry-After` and stable quota
  identity to clients.

## Product contract

Every `/v1` response carries `X-Request-Id`. The server accepts a caller ID only
when it is a conservative opaque token; otherwise it creates a UUID. Error
responses use one envelope:

```json
{
  "error": {
    "code": "stable_snake_case_code",
    "message": "human-readable summary",
    "requestId": "request identity",
    "retryable": false,
    "issues": [
      { "path": ["document", "pages", 0], "code": "...", "message": "..." }
    ]
  }
}
```

`issues` and other documented metadata are optional. Unknown exceptions become
an opaque `internal_error`; stack traces and internal exception messages never
cross the public boundary. Retryable responses include `Retry-After` whenever
the server knows the delay.

One bounded audit row is written for every `/v1` request with request ID,
timestamp, method, normalized route path, status, latency, principal/workspace
identity when resolved, stable error code when present, and retryability. Audit
writes must not delay the response and must use `waitUntil`. Sensitive headers
and bodies are never recorded.

## Gate sequence

1. Add and test the shared request-ID/error/issue contract.
2. Add a durable API request audit table and response-finalization middleware.
3. Adapt authentication, JSON parsing, render/export/thumbnail, template,
   quotation, media, revision, and job routes to the shared contract.
4. Verify workspace isolation, malformed input, authentication, not-found,
   conflict, admission/rate, renderer, and unknown-error classes with focused
   adversarial tests.
5. Obtain independent P0/P1 code review, update the continuation ledger and
   remediation log, commit, and continue.

## Deliberate limits

- This gate does not introduce organization roles, billing, or a second auth
  provider. Cloudflare Access remains the deployed identity owner.
- Render admission remains the expensive-work quota owner; this gate exposes
  its decisions consistently instead of creating a parallel counter.
- Deployed migration and hostile-network evidence remain environment gates, but
  the local schema upgrade and contract must be reproducible.

## Completion evidence

- A single server-entry boundary now owns request IDs, opaque unknown failures,
  the canonical error envelope, bounded downstream-error inspection, and
  asynchronous D1 audit writes for every `/v1` response.
- Authentication now precedes JSON or multipart parsing. Internal audit
  identity headers are stripped before routing and only the resolved principal
  may attach workspace identity to the audit record.
- General API fixed-window rate admission and render/upload-specific durable
  admission are workspace/principal scoped. Media upload admission has a unique
  server-generated reservation per transport attempt, independent of repository
  idempotency, so concurrent same-key attempts cannot share a quota slot.
- Managed assets, allowed fonts, inline raster structure, dimensions, and total
  pixel area are admitted before browser decode in both Studio and Renderer.
- Public Zod failures expose stable issue codes and canonical paths. Known
  capacity failures expose accurate retryability and `Retry-After`; deterministic
  workspace caps do not claim that waiting will help.
- Migrations `0009` through `0011` create a bounded request audit with normalized
  routes, safe identity fields, supporting indexes, and exact 30-day retention.
  The executable migration harness passes.
- Focused Studio, document, and Renderer suites pass 58 tests; all three package
  typechecks and `git diff --check` pass. Live port-3001 probes retained success,
  malformed-JSON, validation-path, request-ID, and principal/workspace audit
  evidence.
- Independent P0/P1 review initially rejected caller-derived upload reservation
  identity. After separating transport admission from repository idempotency and
  adding a concurrent same-key regression, final rereview returned **ACCEPT with
  no remaining P0/P1**.
