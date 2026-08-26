# ADR 0004: Private Browser Run renderer Worker

Status: accepted, 2026-08-26.

## Context

The editor Worker should stay responsive and should not expose Browser Run directly. PNG and PDF output need browser-accurate text and layout. A container would add deployment work and operating cost that the challenge does not need.

## Decision

Use a separate Worker with a Browser Run binding and Cloudflare Playwright. Call it from the Studio Worker through a service binding. Store results in R2 and metadata in D1. Do not deploy a container.

## Consequences

The renderer can deploy and scale separately while remaining private. The renderer must deploy before the Studio Worker. Local full-topology development needs both Wrangler configs and remote Browser Run access.
