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
- Fabric-powered editor with drag, resize, rotate, inline text editing, selection,
  layers, property controls, shared fields, zoom, PNG export, and review
- canonical undo/redo, batched multi-object edits, keyboard controls, and resilient
  local draft autosave
- live, abortable WebMCP registration for inspection, validation, and
  reviewable shared-field, canvas, and output-variant proposals, plus explicit
  immutable publishing
- published-version API playground with strict parameter materialization,
  multi-output requests, downloadable artifacts, and render history
- D1-backed immutable template versions, idempotent render jobs, failure state,
  and reload-safe history
- isolated 24-hour demo workspaces with a fresh-session reset and short-lived
  bearer access for copied API requests
- public template, render, status, history, and artifact-download routes
- private renderer Worker that turns the canonical document into deterministic
  HTML, captures PNG/PDF with Cloudflare Browser Rendering, and writes it to R2

Draft editing stays local for fast recovery; publishing is complete only after
D1 accepts the immutable snapshot. Browser-local published snapshots are a
cache, not the API source of truth. WebMCP render calls use that same published
version and flow into the API playground's persisted, session-isolated render
history.

## Start locally

Requirements: Bun 1.2 or later, Node 22.12 or later, and a current Wrangler 4 release.

```bash
bun install
bunx --bun wrangler d1 migrations apply webmcp-studio --local -c apps/studio/wrangler.jsonc
bun run dev
```

Open `http://localhost:3001`.

Run the Studio and its renderer auxiliary Worker together through the Cloudflare Vite plugin:

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
  editor/        Fabric adapter, canonical history, and editor state contracts
  render-view/   deterministic React view of the canonical document
  ui/            shadcn source components and design tokens
  webmcp/        route-aware tool catalog and service boundary
docs/            product, architecture, API, WebMCP, demo, and ADRs
migrations/      D1 schema
```

Start with [docs/product-spec.md](docs/product-spec.md) and [docs/architecture.md](docs/architecture.md).

## License

MIT. Reference repositories informed behavior and architecture, but their code was not copied into this project. See [docs/reference-repositories.md](docs/reference-repositories.md).
