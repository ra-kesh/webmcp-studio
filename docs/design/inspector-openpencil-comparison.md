# Inspector comparison: Studio and OpenPencil

This audit compares the five supplied Studio screenshots with the OpenPencil
properties panel and its source-level control recipes. The screenshots are
visual references only. Product behavior remains defined by Studio's document
and editor contracts.

## Foundation decision

Studio continues to load the exact published Vercel stylesheet:
<https://vercel.com/geist/vercel-brand.css>. Its semantic tokens remain the
visual foundation, following <https://vercel.com/design.md>.

The product root does **not** use the stylesheet's `vbg-report` class. That
class opts descendants into report-layout rules for buttons, inputs, selects,
textareas, prose, and tables. Applying it to an editor caused the visual
corruption captured in the screenshots. Studio consumes the public `--vbg-*`
tokens while its shared product components own editor geometry.

## Style and behavior comparison

| Before                                                                                                                                                                             | After                                                                                                                                                                                                                    | Why                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| The app body used `vbg-report light-theme studio-vbg-root`. Vercel report rules therefore targeted every editor button, input, select, and textarea.                               | The body uses only `studio-vbg-root`; the exact Vercel stylesheet is still loaded before Studio CSS.                                                                                                                     | Vercel report composition is opt-in. Tokens belong at product scope; report element recipes do not.                                 |
| A broad `all: revert-layer` boundary tried to undo the report rules. Higher-specificity selectors such as `.vbg-report.light-theme :is(button, .vbg-button)` still won.            | The ineffective reset is removed because the report selectors no longer match.                                                                                                                                           | Removing the opt-in class fixes the cascade at its source and avoids an override arms race.                                         |
| Inspector tabs received Vercel report button borders, white backgrounds, 14 px type, and report padding, producing the boxed segments in screenshots 1 and 3.                      | Tabs render as 39 px line tabs with 11 px type, transparent borders/backgrounds, compact horizontal padding, and one active underline.                                                                                   | Matches the line-tab grammar used by OpenPencil while retaining Studio's shared tab primitive and keyboard behavior.                |
| The right panel defaulted to 336 px and could not shrink below 280 px. The supplied OpenPencil panel is approximately 250 CSS px.                                                  | The panel defaults to 288 px, can shrink to 256 px, and can expand to 400 px.                                                                                                                                            | Reduces the default panel by 14.3% while leaving enough width for Studio's four inspector tabs and two-column property fields.      |
| `InspectorSection` applied generic `px-2` rules to every descendant input. Individual fields also applied `pl-7` and `pr-8`, so the winning class depended on generated CSS order. | `InspectorSection` no longer owns descendant input padding. Each control owns its complete geometry.                                                                                                                     | A section should arrange controls, not partially restyle their internals. This removes the X/Y/W/H, degree, and percent collisions. |
| Numeric prefixes and suffixes were absolutely positioned over a normal input. Values could start underneath `X`, `Y`, `W`, `H`, `°`, or `%`.                                       | Numeric fields are one 24 px flex control with separate in-flow leading, value, and suffix slots. The leading slot uses 5 px horizontal padding; the value truncates inside its own space; the suffix cannot overlap it. | This follows OpenPencil's compound number-field structure and makes every slot participate in layout.                               |
| Numeric controls were always text inputs. Dragging horizontally selected text or did nothing.                                                                                      | A non-editing number field is a `spinbutton` with `cursor: ew-resize`. Horizontal pointer movement beyond 2 px scrubs the value; a click without movement enters text editing.                                           | Matches OpenPencil's primary numeric interaction and preserves direct entry.                                                        |
| A drag would have required repeated commits, risking one history entry per pointer move.                                                                                           | Drag values are previewed at animation-frame cadence and committed exactly once on pointer-up. Pointer cancel restores the canonical value and cancels the preview.                                                      | Keeps canvas feedback immediate without polluting undo history.                                                                     |
| Numeric stepping used an implicit one-unit delta for every property.                                                                                                               | Geometry uses 1-unit steps; font weight uses 10; line height uses 0.01; letter spacing and stroke width use 0.1. Shift and Alt still provide coarse and fine keyboard stepping.                                          | Sensitivity now fits the semantic scale of each property.                                                                           |
| Opacity's text input used a separate absolute `%` overlay and had no scrub behavior.                                                                                               | Opacity uses the same compound number primitive, including an in-flow `%` suffix and horizontal scrubbing, paired with the existing slider.                                                                              | All visible numeric inputs now share the same editing grammar.                                                                      |
| The opacity section showed `100` and `%` on top of each other in screenshot 1.                                                                                                     | Runtime verification shows separate value and suffix slots inside a 64 px, 24 px-high control.                                                                                                                           | The suffix no longer relies on right padding surviving parent-level overrides.                                                      |
| The content textarea inherited Vercel's report minimum height and 14 px desktop type; the screenshot showed an oversized text block.                                               | Report textarea rules no longer match. The content editor remains 64 px minimum with 11 px type at desktop and can resize up to 160 px.                                                                                  | Keeps long copy editable without turning the inspector into a document form.                                                        |
| General report button rules made icon controls, segmented controls, visibility/lock buttons, and style actions look unrelated and unexpectedly large.                              | Shared Studio button, toggle-group, and select recipes own their size, hover, active, focus, and disabled states again.                                                                                                  | Restores one compact product grammar and preserves accessible shared primitives.                                                    |
| The source tried to recover compact inputs through one very long descendant selector on every section.                                                                             | Number, percent, color, text, select, and textarea controls each define their own full recipe.                                                                                                                           | Control ownership makes future small interaction details testable and prevents another cascade-wide scramble.                       |

## Runtime measurements after the fix

The local rendered editor was inspected at a 1280 × 720 viewport with a
rectangle and a text layer selected.

| Before                                                             | After                                                                                                                                                     | Why                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Screenshot panel: about 336 CSS px.                                | Rendered right panel: exactly 288 px.                                                                                                                     | Confirms the new shell default is active, not only declared in source.          |
| Tabs appeared as bordered boxes.                                   | Each tab has an 11 px computed font, transparent background, and transparent 1 px border.                                                                 | Confirms Vercel report button rules no longer win.                              |
| X/Y/W/H values visibly collided with their prefixes.               | Each geometry field is 24 px high and 123 px wide in the two-column grid; computed padding on the compound root is 0 because its child slots own spacing. | Confirms labels and values occupy different layout slots.                       |
| Numeric inputs had an ordinary text cursor and no drag affordance. | Every inspected number field computes to `cursor: ew-resize` while not editing.                                                                           | Confirms the scrub affordance is present across geometry and appearance fields. |
| Textarea computed at 14 px on desktop.                             | It is explicitly pinned to 11 px at the desktop breakpoint.                                                                                               | Removes the last responsive type override inside the typography content field.  |

## Intentional differences from OpenPencil

- Studio keeps a 288 px default rather than duplicating OpenPencil's roughly
  250 px width. Studio has four top-level tabs and longer product-specific
  labels; 256 px remains available as the compact user-resized width.
- Studio keeps the opacity slider as a fast visual alternative. The adjacent
  number control now supports the same scrub interaction as other properties.
- Studio exposes document-specific concepts such as shared text/paint styles,
  source-backed fields, and Review. Those sections keep their functionality,
  but use the same 11 px labels, 24 px controls, compact spacing, and Vercel
  token foundation.

## Verification contract

- Server-rendered control tests guard the compound field slots and prevent a
  return to absolute prefix/suffix overlays.
- Mounted interaction tests cover drag preview, one-time pointer-up commit,
  click-to-edit, and pointer-cancel restoration.
- Shell tests guard the 256 / 288 / 400 px right-panel limits.
- Foundation tests guard the exact Vercel stylesheet URL and ensure the product
  root never opts into `vbg-report`.
