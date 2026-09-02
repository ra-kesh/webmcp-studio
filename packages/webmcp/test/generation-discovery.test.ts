import { describe, expect, it } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import {
  projectGenerationEditableNodes,
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
      templateChanges: {
        targetDiscovery: "read_template.editableNodes",
        nodeOperations: ["set_text", "set_visibility", "asset_substitution"],
        pageOperations: ["insert_image"],
        privateTemplateBodyRequired: false,
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
    expect(capabilities.availableFonts).toEqual([
      "Geist Variable",
      "Inter Variable",
    ])
    expect(capabilities.availableFontFaces).toEqual([
      {
        faceId: "geist-variable-latin-normal-5.3.0",
        family: "Geist Variable",
        style: "normal",
        weight: { min: 100, max: 900 },
        source: "bundled",
        unicodeRange: expect.stringContaining("U+0000-00FF"),
        contentSha256:
          "19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1",
      },
      {
        faceId: "geist-variable-latin-italic-5.3.0",
        family: "Geist Variable",
        style: "italic",
        weight: { min: 100, max: 900 },
        source: "bundled",
        unicodeRange: expect.stringContaining("U+0000-00FF"),
        contentSha256:
          "9b10496762af92659f3b05d2b084b0c8f962c3ecdf637aa764e3b7fd17f5acaf",
      },
      {
        faceId: "inter-variable-latin-normal-5.3.0",
        family: "Inter Variable",
        style: "normal",
        weight: { min: 100, max: 900 },
        source: "google_fonts_cache",
        unicodeRange: expect.stringContaining("U+0000-00FF"),
        contentSha256:
          "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62",
      },
      {
        faceId: "inter-variable-latin-italic-5.3.0",
        family: "Inter Variable",
        style: "italic",
        weight: { min: 100, max: 900 },
        source: "google_fonts_cache",
        unicodeRange: expect.stringContaining("U+0000-00FF"),
        contentSha256:
          "7291b5970da2237441273c03b424a504b70b18f09791473fab99687dcc314720",
      },
    ])
    expect(capabilities.fontDiscovery).toMatchObject({
      sources: ["bundled", "google_fonts_cache"],
      renderTimeRemoteFetch: false,
    })
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

    const editorial = readGenerationTemplate("editorial-one-pager", 1)
    expect(editorial.editableNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "editorial-title",
          pageId: "editorial-one-pager-page",
          name: "Document title",
          type: "text",
          allowedChanges: ["set_visibility"],
          fieldBindings: [{ property: "text", fieldKey: "document_title" }],
        }),
        expect.objectContaining({
          id: "editorial-footer",
          pageId: "editorial-one-pager-page",
          name: "Footer",
          type: "text",
          allowedChanges: ["set_visibility", "set_text"],
          fieldBindings: [],
        }),
      ])
    )
    for (const node of editorial.editableNodes) {
      expect(Object.keys(node).sort()).toEqual(
        [
          "allowedChanges",
          "fieldBindings",
          "id",
          "name",
          "pageId",
          "type",
        ].sort()
      )
      expect(node).not.toHaveProperty("text")
      expect(node).not.toHaveProperty("src")
      expect(node).not.toHaveProperty("assetId")
      expect(node).not.toHaveProperty("x")
      expect(node).not.toHaveProperty("fill")
    }
  })

  it("projects image substitution targets without exposing image sources", () => {
    const nodes = projectGenerationEditableNodes(renderConformanceDocument)
    const image = nodes.find((node) => node.type === "image")

    expect(image).toMatchObject({
      type: "image",
      allowedChanges: expect.arrayContaining([
        "set_visibility",
        "asset_substitution",
      ]),
    })
    expect(image).not.toHaveProperty("src")
    expect(image).not.toHaveProperty("assetId")
    expect(image).not.toHaveProperty("placement")
    expect(image).not.toHaveProperty("alt")
  })
})
