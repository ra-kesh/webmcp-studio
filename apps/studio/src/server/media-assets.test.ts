import { describe, expect, it } from "vitest"
import {
  managedAssetIdFromSource,
  managedAssetSource,
  mediaAssetDataUri,
  validateMediaUpload,
} from "./media-assets"
import type { MediaAssetError } from "./media-assets"

const png1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
)

const upload = (bytes: Uint8Array, type: string, name = "portrait.png") =>
  Object.assign(new Blob([Uint8Array.from(bytes).buffer], { type }), { name })

const jpeg = (width: number, height: number) =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ])

const webp = (width: number, height: number) => {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode("RIFF"), 0)
  new DataView(bytes.buffer).setUint32(4, 22, true)
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8)
  new DataView(bytes.buffer).setUint32(16, 10, true)
  const write24 = (offset: number, value: number) => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
    bytes[offset + 2] = (value >> 16) & 0xff
  }
  write24(24, width - 1)
  write24(27, height - 1)
  return bytes
}

describe("authoritative media upload validation", () => {
  it("accepts complete PNG, JPEG, and WebP bytes and derives dimensions", async () => {
    await expect(
      validateMediaUpload(upload(png1x1, "image/png"))
    ).resolves.toMatchObject({
      mediaType: "image/png",
      width: 1,
      height: 1,
      byteLength: png1x1.length,
    })
    await expect(
      validateMediaUpload(upload(jpeg(640, 480), "image/jpeg", "photo.jpg"))
    ).resolves.toMatchObject({
      mediaType: "image/jpeg",
      width: 640,
      height: 480,
    })
    await expect(
      validateMediaUpload(upload(webp(321, 123), "image/webp", "photo.webp"))
    ).resolves.toMatchObject({
      mediaType: "image/webp",
      width: 321,
      height: 123,
    })
  })

  it("rejects SVG/GIF, MIME spoofing, truncation, and missing image endings", async () => {
    await expect(
      validateMediaUpload(
        upload(
          new TextEncoder().encode("<svg width='1' height='1'/>>"),
          "image/svg+xml"
        )
      )
    ).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 })
    await expect(
      validateMediaUpload(upload(png1x1, "image/jpeg"))
    ).rejects.toMatchObject({ code: "media_type_mismatch", status: 415 })
    await expect(
      validateMediaUpload(upload(png1x1.slice(0, 24), "image/png"))
    ).rejects.toMatchObject({ code: "media_type_mismatch", status: 415 })
    await expect(
      validateMediaUpload(upload(jpeg(20, 20).slice(0, -2), "image/jpeg"))
    ).rejects.toMatchObject({ code: "media_type_mismatch", status: 415 })
  })

  it("rejects excessive dimensions and originals without a bounded renderer-safe rendition", async () => {
    await expect(
      validateMediaUpload(
        upload(webp(16_384, 6_103), "image/webp", "boundary.webp")
      )
    ).resolves.toMatchObject({ width: 16_384, height: 6_103 })
    const tooWide = jpeg(16_385, 10)
    await expect(
      validateMediaUpload(upload(tooWide, "image/jpeg", "wide.jpg"))
    ).rejects.toMatchObject({ code: "invalid_image_dimensions", status: 422 })
    await expect(
      validateMediaUpload(
        upload(webp(16_384, 6_104), "image/webp", "too-many-pixels.webp")
      )
    ).rejects.toMatchObject({ code: "invalid_image_dimensions", status: 422 })
    expect(() =>
      mediaAssetDataUri("image/png", new Uint8Array(4_600_000))
    ).toThrowError(
      expect.objectContaining<Partial<MediaAssetError>>({
        code: "asset_not_renderable",
      })
    )
  })

  it("normalizes visible names and hashes identity-relevant metadata", async () => {
    const validated = await validateMediaUpload(
      upload(png1x1, "image/png", " original.png "),
      " Portrait hero "
    )
    expect(validated.name).toBe("Portrait hero")
    expect(validated.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(validated.requestHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("managed media identity", () => {
  it("round-trips only stable opaque IDs", () => {
    const id = "asset-0123456789abcdef0123456789abcdef"
    expect(managedAssetSource(id)).toBe(`asset:managed/${id}`)
    expect(managedAssetIdFromSource(`asset:managed/${id}`)).toBe(id)
    expect(managedAssetIdFromSource("asset:managed/../private")).toBeNull()
  })
})
