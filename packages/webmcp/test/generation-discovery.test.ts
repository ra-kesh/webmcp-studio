import { describe, expect, it } from "vitest"
import {
  readBlankDocumentPresets,
  readDesignPlanSchema,
  readGenerationCapabilities,
  readGenerationTemplate,
  searchGenerationTemplates,
} from "../src"

describe("generation discovery", () => {
  it("publishes a bounded runtime contract without executable inputs", () => {
    const capabilities = readGenerationCapabilities()
    expect(capabilities).toMatchObject({
      designPlanVersion: 1,
      startModes: ["blank", "template"],
      executableInput: { jsx: false, html: false, css: false, scripts: false },
      review: {
        isolatedCandidate: true,
        currentDocumentMutationBeforeApproval: false,
      },
      limits: {
        maxRequestBytes: 524_288,
        maxPages: 20,
        maxNodes: 1_000,
        maxGroupDepth: 16,
        maxReferences: 4,
        maxNormalizedDesignGuideBytes: 65_536,
      },
    })
    expect(capabilities.availableFonts).toEqual(["Geist Variable"])
    expect(
      readBlankDocumentPresets().presets.map((preset) => preset.id)
    ).toEqual(["portrait", "square", "story"])
    expect(readDesignPlanSchema()).toMatchObject({
      version: 1,
      localIds: { canonicalIdsAccepted: false },
      resources: { components: false },
    })
  })

  it("searches compact exact template identities and never returns bodies", () => {
    const page = searchGenerationTemplates({ query: "proposal", limit: 5 })
    expect(page.templates.length).toBeGreaterThan(0)
    const first = page.templates[0]!
    expect(typeof first.id).toBe("string")
    expect(typeof first.version).toBe("number")
    expect(typeof first.preview).toBe("object")
    expect(first).not.toHaveProperty("document")
    expect(first).not.toHaveProperty("previewDocument")

    const detail = readGenerationTemplate(first.id, first.version)
    expect(detail).toMatchObject({ id: first.id, version: first.version })
    expect(detail).not.toHaveProperty("document")
    expect(detail).not.toHaveProperty("previewDocument")
    expect(JSON.stringify(detail)).not.toContain("data:image")
    expect(JSON.stringify(detail)).not.toContain("asset:managed/")
  })
})
