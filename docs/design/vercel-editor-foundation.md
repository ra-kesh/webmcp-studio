# Vercel editor foundation

Studio's application chrome uses Vercel's published visual foundation as its
design authority.

- CSS source: <https://vercel.com/geist/vercel-brand.css>
- Design guidance: <https://vercel.com/design.md>

The application loads the published stylesheet unchanged at the root. The
shared UI package maps its semantic colors, type, spacing, radii, focus states,
and control dimensions to the public `--vbg-*` tokens.

The published file also contains opt-in report composition rules under the
`vbg-report` class. Studio intentionally does not put that class on the product
root: doing so would restyle every button, input, select, and textarea as report
content. The public `:root` token contract remains active, while shared product
components own their compact geometry and interaction states.

Studio remains an interaction-dense editor. Compact toolbar and inspector
sizes are a product-specific density layer built from the Vercel spacing and
control tokens. Selection and focus may use `--vbg-focus`; other chrome stays
monochrome. Document artwork keeps its own authored colors.

Do not add a second palette, arbitrary radii, decorative gradients, glass
effects, or ornamental shadows. New shared controls should use semantic UI
tokens rather than raw color values.
