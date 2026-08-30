import { describe, expect, it } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import {
  STUDIO_LIBRARY_CATALOG_REVISION,
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogIndex,
} from "./catalog"
import { studioMediaManifest } from "./media/manifest"

const generation = "catalog-adapter-test"

const list = (
  query: Partial<Parameters<typeof studioLibraryCatalogIndex.list>[0]> = {}
) =>
  studioLibraryCatalogIndex.list({
    generation,
    limit: 50,
    ...query,
  })

describe("Studio library catalog", () => {
  it("indexes every active template and every curated media item exactly once", () => {
    const templates = list({ itemKinds: ["template"] })
    const media = list({ itemKinds: ["media"] })
    const combined = list()

    expect(builtInDesignTemplateRepository.list()).toHaveLength(21)
    expect(studioMediaManifest).toHaveLength(37)
    expect(templates).toMatchObject({ total: 21, nextCursor: null })
    expect(media).toMatchObject({ total: 37, nextCursor: null })
    expect(combined.total).toBe(58)
    expect(combined.items).toHaveLength(50)
    expect(combined.nextCursor).not.toBeNull()
    expect(STUDIO_LIBRARY_CATALOG_REVISION).toMatch(
      /^studio-library-[a-f0-9]{16}$/
    )

    const identities = [...templates.items, ...media.items].map(
      (item) => `${item.itemKind}:${item.id}@${item.version}`
    )
    expect(new Set(identities).size).toBe(58)
  })

  it("supports media discovery through search, categories, use cases, and tags", () => {
    const photos = list({
      itemKinds: ["media"],
      categoryIds: ["photograph"],
    })
    expect(photos.total).toBe(4)
    expect(photos.items.every((item) => item.categoryId === "photograph")).toBe(
      true
    )

    const proposalMedia = list({
      itemKinds: ["media"],
      useCaseIds: ["proposal"],
    })
    expect(proposalMedia.total).toBe(11)
    expect(
      proposalMedia.items.every((item) => item.useCaseIds.includes("proposal"))
    ).toBe(true)

    const cameraTag = list({ itemKinds: ["media"], search: "camera" })
    expect(cameraTag.total).toBe(2)
    expect(cameraTag.items.map((item) => item.id).sort()).toEqual([
      "camera",
      "video-camera",
    ])

    const rainforest = list({
      itemKinds: ["media"],
      search: "rainforest panorama",
    })
    expect(rainforest.items.map((item) => item.id)).toEqual([
      "oahu-rainforest-panorama",
    ])
  })

  it("keeps list summaries free of full documents, source bytes, and private locators", () => {
    const firstPage = list()
    const secondPage = list({ cursor: firstPage.nextCursor })

    for (const summary of [...firstPage.items, ...secondPage.items]) {
      expect(summary).not.toHaveProperty("document")
      expect(summary).not.toHaveProperty("previewDocument")
      expect(summary).not.toHaveProperty("src")
      expect(summary).not.toHaveProperty("sourceEvidence")
      expect(summary).not.toHaveProperty("originalUrl")
      expect(summary).not.toHaveProperty("r2Key")
      expect(summary).not.toHaveProperty("objectKey")

      const serialized = JSON.stringify(summary)
      expect(serialized).not.toContain("data:image")
      expect(serialized).not.toContain(";base64,")
      expect(serialized).not.toContain("blob:")
      expect(serialized).not.toContain("asset:local/")
      expect(serialized).not.toContain("asset:managed/")
      expect(serialized).not.toContain("/library/media/")
      expect(serialized).not.toContain('"nodes"')
      expect(serialized).not.toContain('"pages"')
    }
  })

  it("resolves exact immutable details without widening the list payload", () => {
    const templateSummary = list({ itemKinds: ["template"] }).items[0]
    const mediaSummary = list({ itemKinds: ["media"] }).items[0]
    if (templateSummary.itemKind !== "template") {
      throw new Error("Expected a template summary")
    }
    if (mediaSummary.itemKind !== "media") {
      throw new Error("Expected a media summary")
    }

    const templateDetail = getStudioLibraryCatalogDetail(
      "template",
      templateSummary.id,
      templateSummary.version
    )
    const mediaDetail = getStudioLibraryCatalogDetail(
      "media",
      mediaSummary.id,
      mediaSummary.version
    )

    expect(templateDetail?.summary).toEqual(templateSummary)
    expect(templateDetail?.materialization).toEqual({
      repository: "design_template",
      templateId: templateSummary.id,
      templateVersion: templateSummary.version,
      sourceContext:
        templateSummary.templateKind === "quotation_style"
          ? "quotation"
          : "none",
    })
    expect(mediaDetail?.summary).toEqual(mediaSummary)
    expect(mediaDetail?.selectionIdentity).toEqual({
      source: "curated",
      assetId: mediaSummary.id,
      version: mediaSummary.version,
    })
    expect(Object.isFrozen(templateDetail)).toBe(true)
    expect(Object.isFrozen(templateDetail?.summary)).toBe(true)
    expect(Object.isFrozen(mediaDetail)).toBe(true)
    expect(
      getStudioLibraryCatalogDetail("template", templateSummary.id, 999)
    ).toBeNull()
    expect(getStudioLibraryCatalogDetail("media", "missing-media")).toBeNull()
  })
})
