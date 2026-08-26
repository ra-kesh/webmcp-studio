# ADR 0005: shadcn/ui with Geist

Status: accepted, 2026-08-26.

## Context

The one-week build needs consistent, accessible controls without inventing a component library. The desired visual tone is close to Vercel's compact Geist language, but current public Geist component options are not the right dependency base.

## Decision

Use shadcn/ui source components, Radix Nova, a neutral palette, Geist Sans, Geist Mono, Lucide, Tailwind 4, and semantic tokens. Build editor-specific components by composition.

## Consequences

The repository owns component source and can tune density. Radix provides established accessibility behavior. App styling remains separate from document templates. Any local component modifications must be reviewed when updating from the shadcn registry.
