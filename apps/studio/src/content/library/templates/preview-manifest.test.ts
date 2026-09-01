import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  STUDIO_TEMPLATE_PREVIEW_MAX_HEIGHT,
  STUDIO_TEMPLATE_PREVIEW_MAX_WIDTH,
  assertStudioTemplatePreviewManifestCoverage,
  listStudioTemplatePreviewSpecifications,
  parseStudioTemplatePreviewManifest,
  studioTemplatePreviewManifest,
  studioTemplatePreviewManifestSchema,
  templatePreviewKey,
  type StudioTemplatePreviewManifest,
} from "./preview-manifest"
import { studioPageThumbnailRendererRevision } from "../../../features/editor/page-thumbnail-raster-producer"

const sha = "a".repeat(64)

function manifestForCurrentTemplates(): StudioTemplatePreviewManifest {
  const entries = listStudioTemplatePreviewSpecifications().map(
    (specification) => ({
      key: specification.key,
      preview: {
        kind: "raster" as const,
        itemId: specification.template.id,
        itemVersion: specification.template.version,
        pageId: specification.pageId,
        width: specification.width,
        height: specification.height,
        resourcePath: `/library/previews/templates/generations/${sha}/${specification.template.id}/v${specification.template.version}/${specification.pageId}.${sha.slice(0, 16)}.png`,
        mediaType: "image/png" as const,
        contentSha256: sha,
        rendererRevision: studioPageThumbnailRendererRevision,
      },
    })
  )
  return {
    schemaVersion: 1,
    generation: sha,
    rendererRevision: studioPageThumbnailRendererRevision,
    entries,
  }
}

describe("Studio template preview manifest", () => {
  it("binds the checked-in production manifest to exact PNG bytes", async () => {
    const manifest = parseStudioTemplatePreviewManifest(
      JSON.parse(
        await readFile(
          new URL(
            "../../../../public/library/previews/templates/manifest.json",
            import.meta.url
          ),
          "utf8"
        )
      ) as unknown
    )
    expect(studioTemplatePreviewManifest).toEqual(manifest)
    expect(manifest.entries).toHaveLength(21)
    for (const { key, preview } of manifest.entries) {
      const bytes = await readFile(
        new URL(`../../../../public${preview.resourcePath}`, import.meta.url)
      )
      expect(createHash("sha256").update(bytes).digest("hex"), key).toBe(
        preview.contentSha256
      )
      expect([...bytes.subarray(0, 8)], key).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ])
      const dimensions = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      )
      expect(dimensions.getUint32(16), key).toBe(preview.width)
      expect(dimensions.getUint32(20), key).toBe(preview.height)
      expect(preview.mediaType).toBe("image/png")
    }
  })

  it("covers every active exact template version and preview page", () => {
    const specifications = listStudioTemplatePreviewSpecifications()
    expect(specifications).toHaveLength(21)
    expect(new Set(specifications.map(({ key }) => key)).size).toBe(21)
    for (const specification of specifications) {
      expect(specification.key).toBe(
        templatePreviewKey(
          specification.template.id,
          specification.template.version
        )
      )
      expect(specification.width).toBeLessThanOrEqual(
        STUDIO_TEMPLATE_PREVIEW_MAX_WIDTH
      )
      expect(specification.height).toBeLessThanOrEqual(
        STUDIO_TEMPLATE_PREVIEW_MAX_HEIGHT
      )
    }
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage(manifestForCurrentTemplates())
    ).not.toThrow()
  })

  it("rejects missing, extra, stale, and wrong-page records", () => {
    const complete = manifestForCurrentTemplates()
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage({
        ...complete,
        entries: complete.entries.slice(1),
      })
    ).toThrow(/Missing:/)
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage({
        ...complete,
        entries: [
          ...complete.entries,
          {
            ...complete.entries[0]!,
            key: "template:extra-template@1",
            preview: {
              ...complete.entries[0]!.preview,
              itemId: "extra-template",
              resourcePath: complete.entries[0]!.preview.resourcePath!.replace(
                complete.entries[0]!.preview.itemId,
                "extra-template"
              ),
            },
          },
        ],
      })
    ).toThrow(/Extra:/)
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage({
        ...complete,
        rendererRevision: "renderer-thumbnail-v0",
      })
    ).toThrow(/stale/)
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage({
        ...complete,
        entries: complete.entries.map((entry, index) =>
          index === 0
            ? { ...entry, preview: { ...entry.preview, pageId: "wrong-page" } }
            : entry
        ),
      })
    ).toThrow(/wrong pageId/)
  })

  it("keeps schema parsing available to regenerate a stale catalog while consumers reject its coverage", () => {
    const stale = {
      ...manifestForCurrentTemplates(),
      entries: manifestForCurrentTemplates().entries.slice(1),
    }

    expect(() => parseStudioTemplatePreviewManifest(stale)).not.toThrow()
    expect(() =>
      assertStudioTemplatePreviewManifestCoverage(
        parseStudioTemplatePreviewManifest(stale)
      )
    ).toThrow(/Missing:/)
  })

  it("rejects paths outside the immutable generation and duplicate resources", () => {
    const complete = manifestForCurrentTemplates()
    const unsafe = structuredClone(complete)
    unsafe.entries[0]!.preview.resourcePath = "/previews/latest.png"
    expect(() => studioTemplatePreviewManifestSchema.parse(unsafe)).toThrow(
      /generation and hash/
    )

    const duplicate = structuredClone(complete)
    duplicate.entries[1]!.preview.resourcePath =
      duplicate.entries[0]!.preview.resourcePath
    expect(() => studioTemplatePreviewManifestSchema.parse(duplicate)).toThrow(
      /unique/
    )
  })
})
