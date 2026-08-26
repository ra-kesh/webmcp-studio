# ADR 0002: TanStack Start on Cloudflare Workers

Status: accepted, 2026-08-26.

## Context

The editor needs full-document React, typed file routes, public API routes, server functions, and Cloudflare runtime bindings. The user prefers TanStack over another Next.js application and wants the product hosted on Workers.

## Decision

Use TanStack Start with Vite and `@cloudflare/vite-plugin`. Internal UI mutations use server functions or shared services. Public REST contracts use server route handlers. D1 and R2 remain server-only.

## Consequences

The app deploys as a Worker and uses current runtime bindings. TanStack Start is still moving toward 1.0, so dependency upgrades require a build and route-generation check. The repository keeps framework code inside `apps/studio` so the document model does not depend on it.
