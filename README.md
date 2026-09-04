# ZeroEdit

An open-source visual document editor designed for agents and humans to work on
the same editable canvas.

ZeroEdit exposes its editing workflow through WebMCP. An agent can inspect a
document, assemble editable layers, render and inspect a candidate, and present
the proposed change for human review before it becomes the working document.
The same document can then be edited manually and exported as PNG or PDF.

Try the public demo at [zeroedit.app](https://zeroedit.app). Demo workspaces are
temporary and require no account.

## Continue editing in Figma

ZeroEdit includes a Figma importer for taking a document beyond the built-in
editor. The transfer keeps supported content as editable Figma layers. It is a
one-time handoff, not a live sync.

### Install the development plugin

```bash
bun install
bun run --filter @webmcp/figma-importer build
```

In the Figma desktop app, open **Plugins > Development > Import plugin from
manifest** and select `packages/figma-importer/manifest.json`.

### Send a document to Figma

1. Open the document in ZeroEdit and choose **Export to Figma** from the export
   menu.
2. Copy the handoff link. It expires after ten minutes.
3. Run **Studio Interchange Importer** in Figma.
4. Choose **URL**, paste the handoff link, and select **Import**.

The importer creates a Figma page and page-sized frame for each ZeroEdit page.
Text, shapes, SVG paths, images, compatible groups, solid paints, basic
gradients, strokes, blend modes, and supported effects remain editable. The
plugin reports any unsupported or lossy mappings after import. Field bindings,
design variables, component semantics, multiple mask sources, independent
stroke widths, and renderer-specific text shaping do not yet have exact Figma
equivalents.

The importer also accepts a downloaded Studio package or pasted interchange
JSON. See the [Figma importer documentation](packages/figma-importer/README.md)
for the current mapping.

## Prompts that work well

Open a document at [zeroedit.app](https://zeroedit.app), then give one of these
prompts to an agent that can use WebMCP. These examples ask the agent to inspect
the rendered candidate before approval. The agent must use fonts reported by the
live generation-capabilities tool. It must not assume that a font name, remote
image URL, or browser-local file is renderable.

Use native text, shapes, groups, fields, and styles when they can express the
design honestly. For photography, pigment texture, or a complex hero graphic,
the agent may generate or import a raster asset, upload the original bytes through
the workspace upload reservation, and compose editable type and layout around it.

<details>
<summary>Chinese contemporary exhibition poster</summary>

```text
Open zeroedit.app and use its WebMCP tools to create a new editable 9:16 document.
Do not replace the document that is already open. Read the live generation and
font capabilities before choosing type. Render and inspect the candidate at full
size and thumbnail size. Repair one visible composition, clipping, contrast, or
legibility problem if needed, then leave the candidate in Review for me.

Theme: Rain passing through an old city
Main Color Field: Cinnabar Orange
Landscape: Urban rooftops after rain
Visual Dynamics: Diagonal rain curtain
Micro-Narrative: One cyclist crossing a narrow bridge beneath a small flock of birds
Chinese Title: 雨城纪事
Chinese Epigraph: 风穿过旧屋，也穿过我们
Aspect Ratio: 9:16

Generate a highly polished Chinese minimalist contemporary art exhibition poster,
blending Eastern landscape negative space, modern editorial design, abstract large
color fields, paper-based art, and independent publication visuals.

Use clean, warm ivory-white art paper as the background. Establish the primary
mood with a Cinnabar Orange color field occupying about 40% to 55% of the frame.
The color field should have the delicate texture of mineral pigments, gouache,
silkscreen printing, and paper absorption, with natural irregular edges. Retain
subtle brush marks, tonal variations, and exposed paper whites internally, but
keep it clean and intact. Avoid aged or random blemishes.

Incorporate low or partially cropped ink-black urban rooftops and reorganize the
composition around a diagonal rain curtain. Use birds, rain lines, wind paths,
bridges, and rooflines to create a clear direction. Do not fall back to a fixed
black horizontal line with a lower color block.

Embed a very small cyclist crossing a narrow bridge within the landscape. Use the
scale contrast of a large color field, micro-landscape, and tiny figure to create
depth and story. From far away the color field and direction should read first. Up
close, the viewer should discover the cyclist, birds, paths, plants, architecture,
and observation marks.

Use tall, slender Song or modern Mincho letterforms for the vertical Chinese title.
Pair it with minimal serif English, dates, FIELD NOTES, observation notes, the
epigraph, one natural handwritten annotation, and a tiny cinnabar seal. Keep the
information hierarchy precise. If the deployed renderer cannot guarantee a
Chinese font, create the Chinese title and epigraph as separate transparent image
assets rather than silently substituting broken glyphs. Keep the remaining type
editable.

The macro structure must be clear and the micro-details restrained. Keep the
color lively but controlled. Negative space should be present without becoming
vacant. Avoid rough flat fills, cheap vector aesthetics, template color swaps,
massive black mountains, generic travel illustration, excessive antique styling,
random cracks, grimy spots, heavy grain, AI artifacts, UI cards, logos,
watermarks, frame numbers, corner starbursts, and sparkles.
```

</details>

<details>
<summary>Editorial product advertisement</summary>

```text
Open zeroedit.app and use WebMCP to create a new editable 4:5 product campaign
poster. Do not edit through browser clicks. Read the live font and generation
capabilities first. Use image generation only for the hero product photograph if
the editor cannot build it faithfully. Upload that image through the workspace
asset-upload reservation, then keep all typography, rules, labels, and supporting
geometry as editable Studio layers. Render and inspect the candidate before asking
for approval. Correct one visible defect if needed and leave it in Review.

Create an editorial advertisement for a fictional compact portable speaker named
LINE / 01. The exact headline is "ROOM FOR THE QUIET." The supporting line is
"A small speaker for long evenings." Add the factual labels "12 HOUR BATTERY",
"USB-C", and "RECYCLED ALUMINIUM". Do not invent a logo, URL, award, testimonial,
discount, or legal claim.

Use a warm off-white background and one extremely enlarged three-quarter product
view cropped by the right and lower edges. The speaker should feel tactile and
photographic, with brushed dark aluminium, a fine woven grille, one precise control
dial, and soft directional studio light. Reserve a wide quiet zone on the left for
the headline. Let one thin signal-orange line pass behind the product and terminate
at a small technical annotation. Use charcoal for the main type, signal orange for
one controlled accent role, and no other decorative colors.

Set the headline in a high-contrast editorial serif that the renderer reports as
available. Use a restrained condensed sans for specifications. Make the headline
large enough to collide with the product crop without losing a word. Use one strong
scale jump between the headline and the microcopy. Align the support information
to one grid. Keep at least 30% of the page visually quiet.

The finished poster should read as a real print advertisement, not a dashboard or
AI mood board. Avoid floating cards, pills, gradients, glass effects, fake interface
controls, feature-icon rows, generic marketing slogans, extra products, decorative
blobs, starbursts, sparkles, logos, and watermarks.
```

</details>

<details>
<summary>Unsplash-backed photographic poster</summary>

```text
Open zeroedit.app and create a separate new editable document through WebMCP. Do
not replace the current document. This is a photographic double-exposure editorial
poster, not a mono-color design.

Find two suitable, license-compatible Unsplash photographs: one clear side-profile
portrait looking into open space, and one moving train-window landscape with a
distant horizon and lateral motion. Preserve the photographer name, source page,
and asset attribution. Import the original image bytes into the current workspace
through the asset-upload reservation. Do not pass arbitrary remote URLs to the
document and do not automate the browser file picker.

Build a restrained narrative poster around the side-profile portrait. Enlarge the
recognizable silhouette until it occupies most of the frame, with the top and one
side naturally cropped. Direct the gaze toward a wide, bright empty area. Preserve
realistic detail and soft gradation in the key parts of the silhouette. Wash the
other side into high-key diffused light so the subject and background meet softly.

Place the train-window narrative inside the outer silhouette. The smaller scene
should sweep horizontally across the lower portion, passing through the neck or
supporting zone. Use the horizon, motion blur, and pale scenery as one continuous,
memory-like band. Keep only the lower part clear. Let the upper part merge into the
portrait with a soft-edged mask and fading brightness. The double exposure must
retain a definite silhouette without a hard collage seam.

Place one oversized high-contrast serif headline across the lower middle of the
subject. Use the exact headline "BETWEEN TWO STATIONS". Add two lines of narrow
byline text above it and one line of tiny, widely tracked information below it.
Create a strong scale jump between the headline and microcopy. Put a few fine-line
emblems and short labels in horizontal groups inside the bright lower negative
space. Keep them sparse.

Use a high-key near-white background, soft low-saturation midtones in the portrait,
slightly stronger adjacent colors in the moving landscape, and only a small amount
of deeper cool neutral color for stability. Keep the tonal range clean and low
contrast, with wrapping light, shallow shadows, fine even grain, and slight print
softening in photographic midtones. Keep large blank areas clean. Avoid stains,
creases, heavy fading, over-sharpening, UI cards, logos, and watermarks.

Render and inspect the candidate at full size and thumbnail size. Check the title
for clipping, the face for accidental obstruction, the negative-space ratio, and
the double-exposure seam. Use the one bounded repair only for a visible failure.
Leave the final candidate in Review for me.
```

The photographs used in the original test were [a side-profile portrait by Samuel
Dixon](https://unsplash.com/photos/photo-of-woman-looking-right--fQ5XNOcqFQ)
and [a train-window landscape by Viktor
Rejent](https://unsplash.com/photos/view-from-a-train-window-showing-blurred-landscape-z4E3lpdl0Zk).

</details>

<details>
<summary>Mono-color editable film-festival poster</summary>

```text
Open zeroedit.app and use its WebMCP tools with the mono-color skill at
https://github.com/yanliudesign/mono-color-skill to create a polished, fully
editable 3:4 editorial poster for a late-night film festival titled
"AFTER THE LAST TRAIN."

Use Neutral White #FAFAF7 as the paper and only Charcoal #30343A plus Signal Red
#C83232 as printing inks. Give each ink a defined plate role. Choose an original
composition with one dominant cropped object related to a station after midnight,
one clear focal event, one quiet release zone, 25% to 55% exposed paper, and one
manual gesture family. Do not reuse the radio grille or dial composition.

Use an expressive serif title from the renderer's guaranteed font list, with
restrained sans-serif details. Preserve the exact title. Keep supporting copy terse
and factual. Make the title visibly cross, cover, split around, or lock tightly to
the dominant object. Use a 5x to 12x scale jump between display type and microcopy.

Keep the print contemporary. Use clean plate separation, visible halftone only
where it helps the image, clipped highlights where paper cuts through the subject,
and at most two restrained print imperfections. Avoid extra ink colors, gradients,
flat vector poster styling, automatic vintage aging, decorative filler, logos,
URLs, QR codes, UI cards, starbursts, and sparkles.

Build the result from editable native layers. If one photographic or materially
textured hero image is necessary, generate it separately, upload it as an approved
workspace asset, and keep the title and information layers editable. Inspect the
full-size and thumbnail renders against the skill's palette, negative-space,
focal-event, type, and originality checks. Repair it once if needed. Leave the
finished candidate in Review and do not create the document until I approve it.
```

</details>

## What runs today

- TanStack Start studio in a Bun workspace deployed on Cloudflare
- Fabric-powered editor with drag, resize, rotate, inline text editing, selection,
  layers, property controls, shared fields, zoom, PNG export, and review
- live WebMCP tools for document inspection, editable generation, rendered
  candidate inspection, review, asset upload, and explicit publishing
- short-lived Figma handoffs that the bundled plugin rebuilds as editable pages
  and layers
- published-version API playground with strict parameter materialization,
  multi-output requests, downloadable artifacts, and render history
- D1-backed immutable template versions, idempotent render jobs, failure state,
  and reload-safe history

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
  figma-importer/ development Figma plugin for editable Studio handoffs
docs/            product, architecture, API, WebMCP, demo, and ADRs
migrations/      D1 schema
```

Start with [docs/product-spec.md](docs/product-spec.md) and [docs/architecture.md](docs/architecture.md).

## License

MIT. Reference repositories informed behavior and architecture, but their code was not copied into this project. See [docs/reference-repositories.md](docs/reference-repositories.md).
