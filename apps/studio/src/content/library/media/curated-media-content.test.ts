import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"
import { studioMediaManifest, studioMediaManifestItemSchema } from "./manifest"
import {
  curatedMediaContentPath,
  legacyCuratedMediaCompatibilityItems,
  resolveCuratedMediaContent,
} from "./curated-media-content"
import type { CuratedMediaContentError } from "./curated-media-content"

const publicFile = (resourcePath: string) =>
  new URL(`../../../../public${resourcePath}`, import.meta.url)

const exactResponse = async (
  resourcePath: string,
  overrides: {
    bytes?: Uint8Array
    mimeType?: string
    declaredLength?: number
    responsePath?: string
  } = {}
) => {
  const item = [
    ...studioMediaManifest,
    ...legacyCuratedMediaCompatibilityItems,
  ].find((candidate) => candidate.resourcePath === resourcePath)!
  const bytes =
    overrides.bytes ?? new Uint8Array(await readFile(publicFile(resourcePath)))
  const response = new Response(bytes.slice().buffer, {
    headers: {
      "Content-Length": String(overrides.declaredLength ?? bytes.byteLength),
      "Content-Type": overrides.mimeType ?? item.mimeType,
    },
  })
  if (overrides.responsePath) {
    Object.defineProperty(response, "url", {
      value: new URL(overrides.responsePath, "https://assets.test").href,
    })
  }
  return response
}

describe("curated media exact content", () => {
  it("exhaustively resolves all 37 manifest identities from only their approved first-party files", async () => {
    for (const item of studioMediaManifest) {
      const fetchResource = vi.fn((resourcePath: string) =>
        exactResponse(resourcePath)
      )
      const content = await resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        fetchResource
      )

      expect(fetchResource).toHaveBeenCalledOnce()
      expect(fetchResource).toHaveBeenCalledWith(item.resourcePath, undefined)
      expect(content.identity).toEqual({
        assetId: item.id,
        version: item.version,
        contentSha256: item.contentSha256,
      })
      expect(content.canonicalSource).toBe(item.resourcePath)
      expect(content.bytes.byteLength).toBe(item.bytes)
      expect(createHash("sha256").update(content.bytes).digest("hex")).toBe(
        item.contentSha256
      )
      expect(content.src).toMatch(
        item.mimeType === "image/svg+xml"
          ? /^data:image\/svg\+xml;charset=utf-8,/
          : new RegExp(`^data:${item.mimeType};base64,`)
      )
      expect(curatedMediaContentPath(item.id, item.version)).toBe(
        `/v1/studio/library/media/${encodeURIComponent(item.id)}/versions/${item.version}/content`
      )
    }
  })

  it("keeps every published legacy v1 identity bound to its exact first-party bytes", async () => {
    expect(legacyCuratedMediaCompatibilityItems).toHaveLength(6)
    for (const item of legacyCuratedMediaCompatibilityItems) {
      expect(studioMediaManifestItemSchema.safeParse(item).success).toBe(true)
      const fetchResource = vi.fn((resourcePath: string) =>
        exactResponse(resourcePath)
      )
      const content = await resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        fetchResource
      )

      expect(fetchResource).toHaveBeenCalledWith(item.resourcePath, undefined)
      expect(content.identity).toEqual({
        assetId: item.id,
        version: 1,
        contentSha256: item.contentSha256,
      })
      expect(content.canonicalSource).toBe(item.resourcePath)
      expect(content.bytes.byteLength).toBe(item.bytes)
      expect(createHash("sha256").update(content.bytes).digest("hex")).toBe(
        item.contentSha256
      )
      expect(content.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    }
  })

  it("rejects unknown IDs, wrong versions, response paths, MIME types, lengths, and hashes", async () => {
    const item = studioMediaManifest.at(0)
    if (!item) throw new Error("Curated media manifest is empty")
    const valid = (resourcePath: string) => exactResponse(resourcePath)

    await expect(
      resolveCuratedMediaContent(
        { assetId: "unknown-curated-item", version: 1 },
        valid
      )
    ).rejects.toMatchObject({ reason: "identity_invalid" })
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version + 1 },
        valid
      )
    ).rejects.toMatchObject({ reason: "identity_invalid" })
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        (path) =>
          exactResponse(path, { responsePath: "/library/media/wrong.svg" })
      )
    ).rejects.toMatchObject({ reason: "resource_path_mismatch" })
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        (path) => exactResponse(path, { mimeType: "image/png" })
      )
    ).rejects.toMatchObject({ reason: "mime_type_mismatch" })
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        (path) => exactResponse(path, { declaredLength: item.bytes + 1 })
      )
    ).rejects.toMatchObject({ reason: "byte_length_mismatch" })

    const bytes = new Uint8Array(await readFile(publicFile(item.resourcePath)))
    bytes[bytes.length - 1] ^= 1
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        (path) => exactResponse(path, { bytes })
      )
    ).rejects.toMatchObject({ reason: "content_hash_mismatch" })
  })

  it("contains abort and unavailable-resource failures without producing content", async () => {
    const item = studioMediaManifest.at(0)
    if (!item) throw new Error("Curated media manifest is empty")
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        async () => new Response(null, { status: 404 })
      )
    ).rejects.toMatchObject({
      reason: "resource_unavailable",
    } satisfies Partial<CuratedMediaContentError>)
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        async () => {
          throw new Error("static asset binding unavailable")
        }
      )
    ).rejects.toMatchObject({
      reason: "resource_unavailable",
    } satisfies Partial<CuratedMediaContentError>)

    const controller = new AbortController()
    controller.abort()
    await expect(
      resolveCuratedMediaContent(
        { assetId: item.id, version: item.version },
        (path) => exactResponse(path),
        controller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" })
  })
})
