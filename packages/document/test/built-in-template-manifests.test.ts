import { describe, expect, it } from "vitest"
import {
  builtInDesignTemplateDefinitions,
  builtInDesignTemplateRepository,
  builtInTemplateManifestSchema,
  composeQuotationDocumentForVersion,
  DesignTemplateRepository,
  northstarQuotationPayload,
  quotationStyleContent,
  templateDocumentContent,
  verifyTemplateManifestChecksum,
} from "../src"

describe("built-in template manifests", () => {
  it("covers the required jobs with 18 active starter compositions", () => {
    const starters = builtInDesignTemplateRepository
      .list({ kind: "document_starter" })
      .filter((item) => item.catalogStatus !== "retired")

    expect(starters).toHaveLength(18)
    expect(new Set(starters.map((item) => item.category))).toEqual(
      new Set([
        "Briefs",
        "Carousels",
        "Documents",
        "Invitations",
        "Media kits",
        "Presentations",
        "Proposals",
        "Reports",
        "Social",
        "Social posts",
        "Stories",
      ])
    )

    const structuralSignatures = starters.map((item) =>
      JSON.stringify(
        item.previewDocument.pages.map((page) => ({
          dimensions: [page.width, page.height],
          nodeTypes: page.nodeIds.map(
            (nodeId) =>
              item.previewDocument.nodes.find((node) => node.id === nodeId)!
                .type
          ),
          groupRuns: item.previewDocument.groups
            .filter((group) => group.pageId === page.id)
            .map((group) => group.nodeIds.length),
        }))
      )
    )
    expect(new Set(structuralSignatures).size).toBe(starters.length)
  })

  it("verifies every precomputed content hash with platform SHA-256", async () => {
    for (const definition of builtInDesignTemplateDefinitions) {
      const content =
        definition.kind === "document_starter"
          ? templateDocumentContent(definition.document)
          : quotationStyleContent(
              definition.quotationTemplateId,
              definition.composerVersion,
              definition.manifest.contentIdentity.kind === "quotation_style" &&
                definition.manifest.contentIdentity.preview === "canonical"
                ? (composeQuotationDocumentForVersion(
                    northstarQuotationPayload,
                    definition.quotationTemplateId,
                    definition.composerVersion
                  ) ?? null)
                : null
            )
      await expect(
        verifyTemplateManifestChecksum(definition.manifest, content),
        `${definition.id}@${definition.version}`
      ).resolves.toBeUndefined()
    }
  })

  it("rejects content that no longer matches a versioned checksum", async () => {
    const definition = builtInDesignTemplateDefinitions.find(
      (item) => item.id === "signal-creative-brief"
    )!
    if (definition.kind !== "document_starter") {
      throw new Error("Expected a document starter fixture")
    }
    await expect(
      verifyTemplateManifestChecksum(
        definition.manifest,
        `${templateDocumentContent(definition.document)}changed`
      )
    ).rejects.toThrow("checksum does not match")
  })

  it("keeps manifest format, source and canonical profile aligned", () => {
    for (const definition of builtInDesignTemplateDefinitions) {
      expect(
        builtInTemplateManifestSchema.safeParse(definition.manifest).success
      ).toBe(true)
      expect(definition.source.url ?? null).toBe(
        definition.manifest.provenance.sourceUrl
      )
      expect(definition.source.name).toBe(
        definition.manifest.provenance.sourceName
      )
      expect(definition.source.license).toBe(
        definition.manifest.provenance.license.name
      )
      expect(definition.manifest.job).not.toMatch(/lorem ipsum/i)
      expect(definition.manifest.provenance.sourceUrl).toBeNull()
      expect(definition.manifest.provenance.license.url).toBeNull()
    }
  })

  it("attaches every generated paint style and variable to visible template content", () => {
    const generatedStarters = builtInDesignTemplateDefinitions.filter(
      (definition) =>
        definition.kind === "document_starter" &&
        definition.id !== "editorial-one-pager" &&
        definition.id !== "bold-square-announcement"
    )

    expect(generatedStarters).toHaveLength(16)
    for (const definition of generatedStarters) {
      if (definition.kind !== "document_starter") continue

      const usedPaintStyleIds = new Set(
        definition.document.nodes.flatMap((node) =>
          "paintStyleId" in node && node.paintStyleId ? [node.paintStyleId] : []
        )
      )
      expect(definition.document.paintStyles.length).toBeGreaterThan(0)
      expect(
        definition.document.paintStyles.every((style) =>
          usedPaintStyleIds.has(style.id)
        ),
        `${definition.id}@${definition.version} contains an unattached paint style`
      ).toBe(true)

      const paintStyleIds = new Set(
        definition.document.paintStyles.map((style) => style.id)
      )
      const variableIds = new Set(
        definition.document.variables.map((variable) => variable.id)
      )
      expect(
        definition.document.variableBindings.every(
          (binding) =>
            binding.target.kind === "paint_style" &&
            paintStyleIds.has(binding.target.styleId) &&
            usedPaintStyleIds.has(binding.target.styleId) &&
            variableIds.has(binding.variableId)
        ),
        `${definition.id}@${definition.version} contains an inert variable binding`
      ).toBe(true)
    }
  })

  it("rejects incomplete provenance, profile drift and source mismatch", () => {
    const definition = structuredClone(
      builtInDesignTemplateDefinitions.find(
        (item) => item.id === "editorial-proposal"
      )!
    )
    if (definition.kind !== "document_starter") {
      throw new Error("Expected a document starter fixture")
    }

    const incomplete = structuredClone(definition)
    incomplete.manifest.provenance.sourceUrl =
      "https://studio.example/invented-source"
    expect(
      builtInTemplateManifestSchema.safeParse(incomplete.manifest).success
    ).toBe(false)

    const drifted = structuredClone(definition)
    drifted.document.groups.pop()
    expect(
      () => new DesignTemplateRepository([drifted], northstarQuotationPayload)
    ).toThrow("document profile does not match")

    const contentDrift = structuredClone(definition)
    const textNode = contentDrift.document.nodes.find(
      (node) => node.type === "text"
    )
    if (!textNode || textNode.type !== "text") {
      throw new Error("Expected template text fixture")
    }
    textNode.text = `${textNode.text} changed`
    expect(
      () =>
        new DesignTemplateRepository([contentDrift], northstarQuotationPayload)
    ).toThrow("checksum does not match")

    const mismatchedSource = structuredClone(definition)
    mismatchedSource.source.url = "https://other.example/template"
    expect(
      () =>
        new DesignTemplateRepository(
          [mismatchedSource],
          northstarQuotationPayload
        )
    ).toThrow("source metadata does not match")

    const mismatchedLicense = structuredClone(definition)
    mismatchedLicense.source.license = "Internal"
    expect(
      () =>
        new DesignTemplateRepository(
          [mismatchedLicense],
          northstarQuotationPayload
        )
    ).toThrow("source metadata does not match")

    const wrongFormat = structuredClone(definition)
    wrongFormat.manifest.formatFamily = "social-square"
    expect(
      () =>
        new DesignTemplateRepository([wrongFormat], northstarQuotationPayload)
    ).toThrow("does not match the canonical page dimensions")

    const wrongIdentity = structuredClone(definition)
    if (wrongIdentity.manifest.contentIdentity.kind !== "document") {
      throw new Error("Expected a document identity fixture")
    }
    wrongIdentity.manifest.contentIdentity.documentId = "another-document"
    expect(
      () =>
        new DesignTemplateRepository([wrongIdentity], northstarQuotationPayload)
    ).toThrow("content identity does not match")

    const quotation = structuredClone(
      builtInDesignTemplateDefinitions.find(
        (item) => item.id === "quotation-midnight-film" && item.version === 3
      )!
    )
    if (
      quotation.kind !== "quotation_style" ||
      quotation.manifest.contentIdentity.kind !== "quotation_style"
    ) {
      throw new Error("Expected a quotation style fixture")
    }
    quotation.manifest.contentIdentity.composerVersion = 1
    expect(
      () => new DesignTemplateRepository([quotation], northstarQuotationPayload)
    ).toThrow("content identity does not match")
  })

  it("keeps old exact starter and quotation identities resolvable", () => {
    expect(
      builtInDesignTemplateRepository.get("editorial-one-pager", 1)
    ).toMatchObject({
      id: "editorial-one-pager",
      version: 1,
      kind: "document_starter",
    })
    expect(
      builtInDesignTemplateRepository.get("bold-square-announcement", 1)
    ).toMatchObject({
      id: "bold-square-announcement",
      version: 1,
      kind: "document_starter",
    })
    expect(
      builtInDesignTemplateRepository.get("quotation-editorial-olive", 1)
    ).toMatchObject({
      version: 1,
      kind: "quotation_style",
      catalogStatus: "retired",
    })
  })
})
