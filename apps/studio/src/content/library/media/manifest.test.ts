import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { parseStudioMediaManifest, studioMediaManifest } from "./manifest"

const publicFileUrl = (resourcePath: string) =>
  new URL(`../../../../public${resourcePath}`, import.meta.url)

const mutableCopy = <Value>(value: Value): Value => structuredClone(value)

describe("Studio curated media manifest", () => {
  it("provides a useful 37-item catalog without private or remote content locators", () => {
    expect(studioMediaManifest).toHaveLength(37)
    expect(new Set(studioMediaManifest.map((item) => item.id)).size).toBe(37)
    expect(
      new Set(studioMediaManifest.map((item) => item.resourcePath)).size
    ).toBe(37)
    expect(new Set(studioMediaManifest.map((item) => item.categoryId))).toEqual(
      new Set([
        "background",
        "texture",
        "illustration",
        "graphic-element",
        "photograph",
      ])
    )
    for (const item of studioMediaManifest) {
      expect(item.resourcePath).toMatch(
        /^\/library\/media\/.+\.(?:svg|jpg|png|webp)$/
      )
      const extension =
        item.mimeType === "image/svg+xml"
          ? "svg"
          : item.mimeType === "image/jpeg"
            ? "jpg"
            : item.mimeType === "image/png"
              ? "png"
              : "webp"
      expect(item.resourcePath).toBe(
        `/library/media/${item.id}/v${item.version}/${item.contentSha256}.${extension}`
      )
      expect(item.resourcePath).not.toMatch(/^(?:data|blob|https?):/)
      expect(item.tags.length).toBeGreaterThanOrEqual(2)
      expect(item.useCaseIds.length).toBeGreaterThanOrEqual(1)
      expect(item.provenance.contentSha256).toBe(item.contentSha256)
      expect(item.name).not.toMatch(/Aditi|Kabir|Northstar|customer/i)
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.provenance)).toBe(true)
      if (item.sourceEvidence) {
        expect(Object.isFrozen(item.sourceEvidence)).toBe(true)
      }
    }
  })

  it("binds every manifest identity to the exact immutable file bytes and dimensions", async () => {
    for (const item of studioMediaManifest) {
      const bytes = await readFile(publicFileUrl(item.resourcePath))
      expect(bytes.byteLength, item.id).toBe(item.bytes)
      expect(createHash("sha256").update(bytes).digest("hex"), item.id).toBe(
        item.contentSha256
      )
      if (item.mimeType === "image/svg+xml") {
        const source = bytes.toString("utf8")
        const viewBox = source.match(
          /viewBox=["']0 0 ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)["']/
        )
        expect(viewBox, item.id).not.toBeNull()
        expect(Number(viewBox?.[1]), item.id).toBe(item.width)
        expect(Number(viewBox?.[2]), item.id).toBe(item.height)
      } else {
        const metadata = await sharp(bytes).metadata()
        expect(metadata.format, item.id).toBe("jpeg")
        expect(metadata.width, item.id).toBe(item.width)
        expect(metadata.height, item.id).toBe(item.height)
      }
    }
  })

  it("retains the six Studio originals and records exact OpenMoji attribution", () => {
    const studioOriginals = studioMediaManifest.filter(
      (item) => item.provenance.license.id === "studio-original-artwork"
    )
    const openMoji = studioMediaManifest.filter(
      (item) => item.provenance.sourceName === "OpenMoji"
    )

    expect(studioOriginals.map((item) => item.id).sort()).toEqual([
      "dusk-blocks",
      "floral-linework",
      "linen-paper",
      "olive-botanical",
      "sandstone-arches",
      "warm-grain",
    ])
    expect(openMoji).toHaveLength(24)
    for (const item of openMoji) {
      expect(item.provenance.sourceUrl).toContain(
        "/aeb8bb3a59e2de39c754ac79180c8131c906acea/"
      )
      expect(item.provenance.license).toEqual({
        id: "cc-by-sa-4.0",
        name: "Creative Commons Attribution-ShareAlike 4.0",
        url: "https://creativecommons.org/licenses/by-sa/4.0/",
      })
      expect(item.provenance.attribution.required).toBe(true)
      expect(item.provenance.attribution.text).toMatch(
        /^OpenMoji artwork by .+, licensed under CC BY-SA 4\.0\.$/
      )
    }
  })

  it("pins seven exact CC0 Wikimedia originals with offline rights evidence", async () => {
    const photographs = studioMediaManifest.filter(
      (item) => item.provenance.license.id === "cc0-1.0"
    )

    expect(photographs).toHaveLength(7)
    expect(photographs.map((item) => item.id).sort()).toEqual([
      "dordogne-valley",
      "marmolada-snow",
      "metal-water-drops",
      "oahu-rainforest-panorama",
      "silver-water-waves",
      "spring-daffodil-field",
      "sunlit-yellow-textile",
    ])
    for (const item of photographs) {
      const evidence = item.sourceEvidence
      expect(item.mimeType).toBe("image/jpeg")
      expect(item.formatFamily).toBe("raster")
      expect(item.provenance.sourceName).toBe("Wikimedia Commons")
      expect(item.provenance.license).toEqual({
        id: "cc0-1.0",
        name: "Creative Commons CC0 1.0 Universal Public Domain Dedication",
        url: "https://creativecommons.org/publicdomain/zero/1.0/",
      })
      expect(item.provenance.attribution.required).toBe(false)
      expect(item.provenance.attribution.text).toContain(evidence?.creatorName)
      expect(evidence).toMatchObject({
        provider: "Wikimedia Commons",
        retrievedAt: "2026-08-31T00:00:00.000Z",
        originalBytesPreserved: true,
      })
      expect(evidence?.filePageUrl).toBe(item.provenance.sourceUrl)
      expect(evidence?.originalUrl).toMatch(
        /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//
      )

      const bytes = await readFile(publicFileUrl(item.resourcePath))
      expect(createHash("sha1").update(bytes).digest("hex"), item.id).toBe(
        evidence?.sourceContentSha1
      )
    }

    const firstEvidence = photographs[0]!.sourceEvidence!
    expect(() =>
      Object.assign(firstEvidence, { creatorName: "mutated creator" })
    ).toThrow()
    expect(firstEvidence.creatorName).not.toBe("mutated creator")
  })

  it("rejects missing provenance, unsafe paths, mismatched hashes, and incomplete attribution", () => {
    const source = mutableCopy(studioMediaManifest[0]!)

    const missingProvenance = { ...source } as Record<string, unknown>
    delete missingProvenance.provenance
    expect(() => parseStudioMediaManifest([missingProvenance])).toThrow()

    expect(() =>
      parseStudioMediaManifest([
        { ...source, resourcePath: "https://example.com/private.svg" },
      ])
    ).toThrow()

    expect(() =>
      parseStudioMediaManifest([
        { ...source, resourcePath: `/library/media/${source.id}.svg` },
      ])
    ).toThrow(/version.*SHA-256/i)

    expect(() =>
      parseStudioMediaManifest([
        {
          ...source,
          provenance: {
            ...source.provenance,
            contentSha256: "f".repeat(64),
          },
        },
      ])
    ).toThrow(/checksum/i)

    const external = mutableCopy(
      studioMediaManifest.find(
        (item) => item.provenance.sourceName === "OpenMoji"
      )!
    )
    expect(() =>
      parseStudioMediaManifest([
        {
          ...external,
          provenance: {
            ...external.provenance,
            attribution: { required: false, text: null },
          },
        },
      ])
    ).toThrow(/attribution/i)

    expect(() =>
      parseStudioMediaManifest([
        {
          ...external,
          provenance: {
            ...external.provenance,
            license: {
              id: "unclear-stock-license",
              name: "Unclear stock license",
              url: "https://example.com/license",
            },
          },
        },
      ])
    ).toThrow()
  })

  it("rejects raster identity mismatches and incomplete Wikimedia evidence", () => {
    const photograph = mutableCopy(
      studioMediaManifest.find(
        (item) => item.provenance.license.id === "cc0-1.0"
      )!
    )

    expect(() =>
      parseStudioMediaManifest([
        { ...photograph, resourcePath: photograph.resourcePath + ".jpg" },
      ])
    ).toThrow()
    expect(() =>
      parseStudioMediaManifest([{ ...photograph, mimeType: "image/png" }])
    ).toThrow(/identity and checksum/i)
    expect(() =>
      parseStudioMediaManifest([{ ...photograph, formatFamily: "vector" }])
    ).toThrow(/Vector media must be SVG/i)
    expect(() =>
      parseStudioMediaManifest([{ ...photograph, sourceEvidence: null }])
    ).toThrow(/exact Wikimedia source evidence/i)
    expect(() =>
      parseStudioMediaManifest([
        {
          ...photograph,
          sourceEvidence: {
            ...photograph.sourceEvidence!,
            sourceContentSha1: "not-a-sha1",
          },
        },
      ])
    ).toThrow()
    expect(() =>
      parseStudioMediaManifest([
        {
          ...photograph,
          sourceEvidence: {
            ...photograph.sourceEvidence!,
            originalUrl: "https://example.com/photo.jpg",
          },
        },
      ])
    ).toThrow(/original upload host/i)
    expect(() =>
      parseStudioMediaManifest([
        {
          ...photograph,
          provenance: {
            ...photograph.provenance,
            sourceUrl:
              "https://commons.wikimedia.org/wiki/File:Different_photo.jpg",
          },
        },
      ])
    ).toThrow(/exact Wikimedia source evidence/i)
    expect(() =>
      parseStudioMediaManifest([
        {
          ...photograph,
          provenance: {
            ...photograph.provenance,
            license: {
              ...photograph.provenance.license,
              url: "https://example.com/cc0",
            },
          },
        },
      ])
    ).toThrow(/exact Wikimedia source evidence/i)
  })

  it("rejects duplicate immutable identities and path reuse across identities", () => {
    const first = mutableCopy(studioMediaManifest[0]!)
    const second = mutableCopy(studioMediaManifest[1]!)
    expect(() => parseStudioMediaManifest([first, first])).toThrow(
      /duplicate identities/i
    )
    expect(() =>
      parseStudioMediaManifest([
        first,
        { ...second, resourcePath: first.resourcePath },
      ])
    ).toThrow(/identity and checksum/i)
  })
})
