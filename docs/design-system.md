# Design system

## Decision

Use shadcn/ui source components with the Radix Nova style, neutral base, Geist Sans, Geist Mono, Lucide icons, Tailwind 4, and semantic CSS variables.

Vercel's current Geist component package is not a stable public dependency for this project, and the older Geist UI project is archived. The useful part is the design language: compact controls, clear hierarchy, disciplined spacing, and quiet color. shadcn gives us owned source code and Radix accessibility without forcing a visual editor into a dashboard kit.

The challenge build is light-only. Dark tokens may remain available in upstream components, but no dark-mode control or dark-mode QA belongs in the one-week scope.

## Two visual domains

The app chrome and the user's document are separate systems.

App chrome uses semantic tokens such as `background`, `foreground`, `muted`, `border`, `primary`, and `workspace`. It never reaches into template typography or colors.

Document artboards use the values stored in the canonical document. A wedding proposal may use olive and warm paper while the editor remains neutral. Changing the app theme must not alter exports.

## Metrics

- top bar: 48 px
- contextual bar: 44 px
- left output rail: 220 px
- right inspector: 320 px
- base radius: 10 px
- default control height: 32 px
- compact icon control: 28 px
- panel padding: 12 or 16 px
- dense list gap: 4 to 8 px

The editor prioritizes the artboard. Persistent side panels should not consume more than half the viewport at the minimum supported width.

## Component policy

Use shadcn components for buttons, fields, menus, dialogs, sheets, tabs, tooltips, badges, separators, scroll areas, alerts, and empty states. Add them through the shadcn CLI so their source and dependencies match the configured Radix base.

Build editor-specific composed components in `packages/ui`:

- `EditorShell`
- `ToolbarButton`
- `ArtboardRail` and `ArtboardThumbnail`
- `LayerTree` and `LayerRow`
- `InspectorSection`
- `PropertyRow`
- `NumericField`
- `ColorField`
- `AssetTile`
- `FieldBindingControl`
- `ChangeSetRail` and `ChangeOperation`
- `ValidationIssue`
- `RenderPreview`

These components arrange existing controls and product state. They do not fork button, input, tooltip, or menu behavior.

## Interaction rules

- Icon-only controls require an accessible label and tooltip.
- Consequential actions use text labels. Publishing should never be an unlabeled icon.
- Agent proposals use pending, accepted, and rejected states that remain understandable without color.
- Canvas shortcuts never make the same action inaccessible from a visible menu or button.
- Focus must return to the triggering control after dialogs and sheets close.
- The change review rail announces status updates and keeps keyboard focus stable.
- Motion is limited to panel transitions, change preview, and render completion. Respect reduced-motion settings.

## Typography

Geist Sans is the app typeface. Geist Mono is reserved for field keys, tool names, template IDs, JSON, cURL, and dimensions. Template text uses its own stored font family.

Use compact labels at 11 to 12 px, normal controls at 13 to 14 px, and page titles at 16 to 20 px. The canvas, not oversized chrome typography, carries the visual character.

## Token ownership

Tokens live in `packages/ui/src/styles/globals.css`. Components use semantic tokens instead of raw app colors. New component code may use raw values only when rendering a document property or visualizing user-selected color.
