import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMediaAssetHttpHandlers } from "./media-asset-http"
import { RenderAdmissionError } from "./render-admission-service"
import type { StudioPrincipal } from "./studio-principal"

const assetId = "asset-0123456789abcdef0123456789abcdef"
const now = "2026-08-28T00:00:00.000Z"
const asset = {
  id: assetId,
  name: "Portrait",
  mediaType: "image/png" as const,
  bytes: 68,
  width: 1,
  height: 1,
  createdAt: now,
  updatedAt: now,
  lastUsedAt: now,
  status: "ready" as const,
}

const png1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
)

const principal: StudioPrincipal = {
  id: "principal-a",
  budgetKey: "workspace-a",
  workspaceId: "workspace-a",
  expiresAt: "2026-08-29T00:00:00.000Z",
  mode: "local_demo",
  respond: (response) => {
    response.headers.set("x-principal-response", "yes")
    return response
  },
}

const repository = {
  list: vi.fn(),
  lookup: vi.fn(),
  upload: vi.fn(),
  storageUsage: vi.fn(),
  contentMetadata: vi.fn(),
  content: vi.fn(),
  deletionImpact: vi.fn(),
  markUsed: vi.fn(),
  archive: vi.fn(),
}

const completeUpload = vi.fn(async () => undefined)
const failUpload = vi.fn(async () => undefined)
const reserveUpload = vi.fn(
  async (
    _principal: StudioPrincipal,
    input: {
      reservationId: string
      estimatedStorageBytes: number
      currentStorageBytes: number
      currentAssetCount: number
    }
  ) => ({
    reservationId: input.reservationId,
    complete: completeUpload,
    fail: failUpload,
  })
)

const handlers = createMediaAssetHttpHandlers({
  db: {} as D1Database,
  bucket: {} as R2Bucket,
  requirePrincipal: async () => principal,
  repository,
  reserveUpload,
})

beforeEach(() => {
  vi.clearAllMocks()
  repository.storageUsage.mockResolvedValue({ bytes: 67, count: 1 })
  reserveUpload.mockResolvedValue({
    reservationId: "media-upload-upload-1",
    complete: completeUpload,
    fail: failUpload,
  })
})

describe("media asset HTTP contract", () => {
  it("looks up ready or archived metadata inside the principal workspace", async () => {
    repository.lookup.mockResolvedValue({ ...asset, selectable: true })
    const response = await handlers.lookup(
      new Request(`https://studio.test/v1/studio/assets/${assetId}`),
      assetId
    )

    expect(repository.lookup).toHaveBeenCalledWith("workspace-a", assetId)
    expect(await response.json()).toEqual({
      asset: { ...asset, selectable: true },
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("lists a workspace collection/query with the shared public shape", async () => {
    repository.list.mockResolvedValue({
      assets: [asset],
      nextCursor: "next",
      storage: { bytes: 67, count: 1 },
    })
    const response = await handlers.list(
      new Request(
        "https://studio.test/v1/studio/assets?collection=recent&query=portrait&limit=20"
      )
    )
    expect(repository.list).toHaveBeenCalledWith("workspace-a", {
      collection: "recent",
      query: "portrait",
      limit: 20,
      cursor: null,
    })
    expect(await response.json()).toEqual({
      assets: [asset],
      nextCursor: "next",
      storage: { bytes: 67, count: 1 },
    })
    expect(response.headers.get("x-principal-response")).toBe("yes")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("rejects unsupported collections before repository access", async () => {
    const response = await handlers.list(
      new Request("https://studio.test/v1/studio/assets?collection=private-r2")
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_collection",
        message: "Asset collection must be uploads or recent",
      },
    })
    expect(repository.list).not.toHaveBeenCalled()
  })

  it("validates multipart bytes before forwarding an idempotent upload", async () => {
    repository.upload.mockResolvedValue({ asset, created: true })
    const form = new FormData()
    form.set("file", new File([png1x1], "portrait.png", { type: "image/png" }))
    form.set("name", "Portrait")
    const request = new Request("https://studio.test/v1/studio/assets", {
      method: "POST",
      headers: {
        "Idempotency-Key": "upload-1",
        "Content-Length": "512",
      },
      body: form,
    })
    const response = await handlers.upload(request)
    expect(response.status).toBe(201)
    expect(repository.upload).toHaveBeenCalledWith(
      "workspace-a",
      expect.objectContaining({
        name: "Portrait",
        mediaType: "image/png",
        width: 1,
        height: 1,
      }),
      "upload-1"
    )
    expect(reserveUpload).toHaveBeenCalledWith(principal, {
      reservationId: expect.stringMatching(/^media-upload-[0-9a-f-]{36}$/),
      estimatedStorageBytes: 512,
      currentStorageBytes: 67,
      currentAssetCount: 1,
    })
    expect(completeUpload).toHaveBeenCalledWith(68)
    expect(await response.json()).toEqual({ asset })
  })

  it("uses an independent admission reservation for concurrent idempotent attempts", async () => {
    repository.upload.mockResolvedValue({ asset, created: true })
    const createRequest = () => {
      const form = new FormData()
      form.set(
        "file",
        new File([png1x1], "portrait.png", { type: "image/png" })
      )
      return new Request("https://studio.test/v1/studio/assets", {
        method: "POST",
        headers: {
          "Idempotency-Key": "shared-upload-key",
          "Content-Length": "512",
        },
        body: form,
      })
    }

    const [first, second] = await Promise.all([
      handlers.upload(createRequest()),
      handlers.upload(createRequest()),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const reservationIds = reserveUpload.mock.calls.map(
      ([, request]) => request.reservationId
    )
    expect(reservationIds).toHaveLength(2)
    expect(new Set(reservationIds).size).toBe(2)
    expect(repository.upload).toHaveBeenCalledTimes(2)
    expect(repository.upload).toHaveBeenNthCalledWith(
      1,
      "workspace-a",
      expect.any(Object),
      "shared-upload-key"
    )
    expect(repository.upload).toHaveBeenNthCalledWith(
      2,
      "workspace-a",
      expect.any(Object),
      "shared-upload-key"
    )
  })

  it("rejects workspace upload admission before parsing multipart bytes", async () => {
    reserveUpload.mockRejectedValue(
      new RenderAdmissionError("upload_workspace_storage_exceeded", 0)
    )
    const request = new Request("https://studio.test/v1/studio/assets", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=unparsed",
        "Content-Length": "512",
      },
      body: "not parsed",
    })
    const response = await handlers.upload(request)
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: { code: "upload_workspace_storage_exceeded" },
    })
    expect(repository.upload).not.toHaveBeenCalled()
  })

  it("serves private immutable content with ETag and avoids R2 on a conditional hit", async () => {
    repository.contentMetadata.mockResolvedValue({
      asset,
      contentHash: "a".repeat(64),
      r2Key: "must-not-leak",
    })
    const response = await handlers.content(
      new Request(`https://studio.test/v1/studio/assets/${assetId}/content`, {
        headers: { "If-None-Match": `"sha256-${"a".repeat(64)}"` },
      }),
      assetId
    )
    expect(response.status).toBe(304)
    expect(response.headers.get("cache-control")).toContain("private")
    expect(response.headers.get("etag")).toBe(`"sha256-${"a".repeat(64)}"`)
    expect(repository.content).not.toHaveBeenCalled()
    expect(JSON.stringify([...response.headers])).not.toContain("must-not-leak")
  })

  it("returns exact deletion impact and enforces both archive preconditions", async () => {
    const impact = {
      assetId,
      revision: 3,
      token: "b".repeat(64),
      canArchive: true,
      currentReferences: 0,
      publishedReferences: 0,
      references: [],
    }
    repository.deletionImpact.mockResolvedValue(impact)
    let response = await handlers.deletionImpact(
      new Request(
        `https://studio.test/v1/studio/assets/${assetId}/deletion-impact`
      ),
      assetId
    )
    expect(await response.json()).toEqual({ impact })

    response = await handlers.archive(
      new Request(`https://studio.test/v1/studio/assets/${assetId}`, {
        method: "DELETE",
      }),
      assetId
    )
    expect(response.status).toBe(412)
    expect(repository.archive).not.toHaveBeenCalled()

    repository.archive.mockResolvedValue({
      assetId,
      status: "archived",
      revision: 4,
    })
    response = await handlers.archive(
      new Request(`https://studio.test/v1/studio/assets/${assetId}`, {
        method: "DELETE",
        headers: {
          "If-Match": '"asset-revision-3"',
          "X-Asset-Impact-Token": "b".repeat(64),
        },
      }),
      assetId
    )
    expect(repository.archive).toHaveBeenCalledWith(
      "workspace-a",
      assetId,
      3,
      "b".repeat(64)
    )
    expect(await response.json()).toEqual({
      assetId,
      status: "archived",
      revision: 4,
    })
  })

  it("marks successful insertion/replacement use and returns current metadata", async () => {
    repository.markUsed.mockResolvedValue({ ...asset, lastUsedAt: now })
    const response = await handlers.markUsed(
      new Request(`https://studio.test/v1/studio/assets/${assetId}/used`, {
        method: "POST",
      }),
      assetId
    )
    expect(repository.markUsed).toHaveBeenCalledWith("workspace-a", assetId)
    expect(await response.json()).toEqual({ asset })
  })
})
