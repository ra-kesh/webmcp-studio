import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const rootSource = readFileSync(
  new URL("./__root.tsx", import.meta.url),
  "utf8"
)
const globalStyles = readFileSync(
  new URL("../../../../packages/ui/src/styles/globals.css", import.meta.url),
  "utf8"
)
const foundationNotes = readFileSync(
  new URL(
    "../../../../docs/design/vercel-editor-foundation.md",
    import.meta.url
  ),
  "utf8"
)

describe("Vercel editor design foundation", () => {
  it("loads the published foundation unchanged at the application root", () => {
    expect(rootSource).toContain('"https://vercel.com/geist/vercel-brand.css"')
    expect(rootSource).toContain(
      'className="vbg-report light-theme studio-vbg-root"'
    )
    expect(rootSource).toContain('data-studio-density="compact"')
  })

  it("derives Studio semantics from VBG tokens without a second palette", () => {
    expect(globalStyles).toContain(
      "--studio-accent: var(--vbg-focus, oklch(0.5761 0.2508 258.23))"
    )
    expect(globalStyles).toContain(
      "--background: var(--vbg-surface-primary, oklch(1 0 0))"
    )
    expect(globalStyles).toContain("--radius: var(--vbg-radius, 0.5rem)")
    expect(globalStyles).toContain("all: revert-layer")
  })

  it("records both authoritative Vercel sources", () => {
    expect(foundationNotes).toContain(
      "https://vercel.com/geist/vercel-brand.css"
    )
    expect(foundationNotes).toContain("https://vercel.com/design.md")
  })
})
