# WebMCP visual document studio

An open-source, programmable visual document editor for service businesses.

The product turns a client brief into a coordinated visual pack, lets an agent propose changes against the live document, gives the human operation-level review, then publishes the approved design as an immutable API template.

The challenge demo uses synthetic data for a fictional wedding photography studio. No private studio code, customer data, or assets belong in this repository.

## What runs today

- TanStack Start studio on Cloudflare Workers
- Bun workspace without Turborepo
- shared shadcn/ui package using Radix Nova, Geist Sans, and Geist Mono
- canonical TypeScript document schema, commands, bindings, validation, and tests
- seven-artboard synthetic proposal pack shared by UI and renderer
- interactive editor shell with output rail, preview, fields, and operation review
- route-aware WebMCP tool catalog
- public API route contracts for templates and render jobs
- private renderer Worker that turns the canonical document into HTML, captures PNG with Cloudflare Browser Run, and writes it to R2

The editor interaction adapter, persistence, live WebMCP registration, immutable publishing, and complete render-job lifecycle are planned work. The current API render route returns a queued contract response but does not persist the job yet.

## Start locally

Requirements: Bun 1.2 or later, Node 22.12 or later, and a current Wrangler 4 release.

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

Run the full local Worker topology when Cloudflare bindings are configured:

```bash
bun run dev:workers
```

Quality gate:

```bash
bun run check
```

Generate Worker binding types after changing either Wrangler config:

```bash
bun run --filter @webmcp/studio cf-typegen
bun run --filter @webmcp/renderer cf-typegen
```

## Repository map

```text
apps/
  studio/        TanStack Start editor, WebMCP adapter, and public REST API
  renderer/      private Browser Run Worker
packages/
  document/      canonical schema, commands, field bindings, validation
  editor/        canvas adapter boundary and editor state contracts
  render-view/   deterministic React view of the canonical document
  ui/            shadcn source components and design tokens
  webmcp/        route-aware tool catalog and service boundary
docs/            product, architecture, API, WebMCP, demo, and ADRs
migrations/      D1 schema
```

Start with [docs/product-spec.md](docs/product-spec.md) and [docs/architecture.md](docs/architecture.md).

## License

MIT. Reference repositories informed behavior and architecture, but their code was not copied into this project. See [docs/reference-repositories.md](docs/reference-repositories.md).
