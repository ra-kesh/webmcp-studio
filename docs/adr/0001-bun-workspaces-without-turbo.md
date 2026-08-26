# ADR 0001: Bun workspaces without Turborepo

Status: accepted, 2026-08-26.

## Context

The product has two deployable apps and a small set of TypeScript packages. The challenge has a one-week delivery window. We need workspace linking and filtered scripts, but no remote cache, large task graph, or independent team pipelines.

## Decision

Use Bun workspaces and scoped package scripts. Do not use Turborepo. Keep deploy commands inside each app and the quality gate at the root.

## Consequences

There is less configuration and one lockfile. Package dependencies still declare `workspace:*`. If task ordering or remote build caching becomes measurable later, add an orchestrator from evidence rather than preinstalling it.
