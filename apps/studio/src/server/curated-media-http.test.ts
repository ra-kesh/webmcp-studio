import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"
import { studioMediaManifest } from "../content/library/media/manifest"
import { legacyCuratedMediaCompatibilityItems } from "../content/library/media/curated-media-content"
import { handleCuratedMediaContentRequest } from "./curated-media-http"

const item = studioMediaManifest.at(0)
if (!item) throw new Error("Curated media manifest is empty")
const publicFile = new URL(`../../public${item.resourcePath}`, import.meta.url)

const environment = async () => {
  const bytes = new Uint8Array(await readFile(publicFile))
  const fetch = vi.fn(async (request: Request) => {
    expect(new URL(request.url).origin).toBe("https://studio.test")
    expect(new URL(request.url).pathname).toBe(item.resourcePath)
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Length": String(bytes.byteLength),
        "Content-Type": item.mimeType,
      },
    })
  })
  return { env: { CURATED_MEDIA: { fetch } } as unknown as Env, fetch, bytes }
}

const environmentFor = async (
  target: (typeof legacyCuratedMediaCompatibilityItems)[number]
) => {
  const bytes = new Uint8Array(
    await readFile(
      new URL(`../../public${target.resourcePath}`, import.meta.url)
    )
  )
  const fetch = vi.fn(async (request: Request) => {
    expect(new URL(request.url).origin).toBe("https://studio.test")
    expect(new URL(request.url).pathname).toBe(target.resourcePath)
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Length": String(bytes.byteLength),
        "Content-Type": target.mimeType,
      },
    })
  })
  return { env: { CURATED_MEDIA: { fetch } } as unknown as Env, fetch, bytes }
}

describe("curated media content HTTP", () => {
  it("serves immutable verified bytes with exact identity and security headers", async () => {
    const { env, fetch, bytes } = await environment()
    const response = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content"),
      env,
      item.id,
      item.version
    )

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get("Content-Type")).toBe(item.mimeType)
    expect(response.headers.get("Content-Length")).toBe(String(item.bytes))
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(response.headers.get("ETag")).toBe(`"sha256-${item.contentSha256}"`)
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("supports HEAD and exact conditional requests without exposing bytes", async () => {
    const { env } = await environment()
    const head = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content", { method: "HEAD" }),
      env,
      item.id,
      item.version
    )
    expect(head.status).toBe(200)
    expect(head.headers.get("Content-Length")).toBe(String(item.bytes))
    expect(await head.text()).toBe("")

    const notModified = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content", {
        headers: { "If-None-Match": `"sha256-${item.contentSha256}"` },
      }),
      env,
      item.id,
      item.version
    )
    expect(notModified.status).toBe(304)
    expect(notModified.headers.get("Content-Length")).toBeNull()
    expect(await notModified.text()).toBe("")
  })

  it("serves all six immutable published v1 paths through GET and HEAD", async () => {
    for (const legacy of legacyCuratedMediaCompatibilityItems) {
      const { env, fetch, bytes } = await environmentFor(legacy)
      const get = await handleCuratedMediaContentRequest(
        new Request("https://studio.test/content"),
        env,
        legacy.id,
        legacy.version
      )
      expect(get.status).toBe(200)
      expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes)
      expect(get.headers.get("Content-Length")).toBe(String(legacy.bytes))
      expect(get.headers.get("ETag")).toBe(`"sha256-${legacy.contentSha256}"`)

      const head = await handleCuratedMediaContentRequest(
        new Request("https://studio.test/content", { method: "HEAD" }),
        env,
        legacy.id,
        legacy.version
      )
      expect(head.status).toBe(200)
      expect(await head.text()).toBe("")
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  })

  it("returns bounded failures for unknown identities, integrity drift, and methods", async () => {
    const { env } = await environment()
    const missing = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content"),
      env,
      item.id,
      item.version + 1
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "curated_media_not_found" })

    const driftedEnv = {
      CURATED_MEDIA: {
        fetch: async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "Content-Length": "3",
              "Content-Type": item.mimeType,
            },
          }),
      },
    } as unknown as Env
    const drifted = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content"),
      driftedEnv,
      item.id,
      item.version
    )
    expect(drifted.status).toBe(422)
    expect(await drifted.json()).toEqual({
      error: "curated_media_integrity_failed",
    })

    const method = await handleCuratedMediaContentRequest(
      new Request("https://studio.test/content", { method: "POST" }),
      env,
      item.id,
      item.version
    )
    expect(method.status).toBe(405)
    expect(method.headers.get("Allow")).toBe("GET, HEAD")
  })
})
