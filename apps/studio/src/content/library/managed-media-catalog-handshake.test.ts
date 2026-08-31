import { describe, expect, it, vi } from "vitest"
import {
  libraryMediaDetailSchema,
  projectPublicMediaDetail,
  publicMediaAssetSchema,
} from "@webmcp/document"
import type { LibraryMediaDetail } from "@webmcp/document"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import { resolveManagedMediaCatalogUpload } from "./managed-media-catalog-handshake"

const upload = publicMediaAssetSchema.parse({
  id: "asset-ManagedHandshake01",
  name: "Uploaded portrait",
  mediaType: "image/jpeg",
  bytes: 240_000,
  width: 1_200,
  height: 1_500,
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z",
  lastUsedAt: "2026-08-31T08:00:00.000Z",
  status: "ready",
})

const managedDetail = (catalogVersion = 7) =>
  projectPublicMediaDetail(upload, {
    catalogVersion,
    description: "Customer-provided workspace upload",
    categoryId: "workspace-upload",
    useCaseIds: [],
    formatFamily: "image",
    tags: [],
    provenance: {
      sourceName: "Workspace upload",
      sourceUrl: null,
      license: {
        id: "customer-provided",
        name: "Customer-provided; rights not verified",
        url: null,
      },
      attribution: { required: false, text: null },
      contentSha256: null,
    },
  })

const notDiscoverable = (requestId: string) =>
  new LibraryDiscoveryHttpError({
    code: "library_item_not_found",
    status: 404,
    message: "Managed media is not yet discoverable",
    requestId,
    retryable: false,
  })

describe("managed media catalog handshake", () => {
  it("waits for catalog ingestion and returns the exact managed catalog version", async () => {
    const detail = managedDetail(7)
    const lookupCurrent = vi
      .fn<
        (assetId: string, signal: AbortSignal) => Promise<LibraryMediaDetail>
      >()
      .mockRejectedValueOnce(notDiscoverable("request-current-1"))
      .mockRejectedValueOnce(notDiscoverable("request-current-2"))
      .mockResolvedValue(detail)
    const waitForRetry = vi.fn<
      (delayMs: number, signal: AbortSignal) => Promise<void>
    >(async () => {})
    const signal = new AbortController().signal

    const result = await resolveManagedMediaCatalogUpload(upload, {
      signal,
      retryDelaysMs: [10, 20],
      lookupCurrent,
      waitForRetry,
    })

    expect(result).toMatchObject({
      status: "ready",
      attempts: 3,
      detail: {
        summary: {
          id: upload.id,
          version: 7,
          mediaSource: "managed",
        },
        selectionIdentity: {
          source: "managed",
          assetId: upload.id,
          catalogVersion: 7,
          refetch: "required",
        },
      },
    })
    expect(lookupCurrent).toHaveBeenCalledTimes(3)
    expect(lookupCurrent).toHaveBeenCalledWith(upload.id, signal)
    expect(waitForRetry.mock.calls.map(([delay]) => delay)).toEqual([10, 20])
    expect(result.status === "ready" && Object.isFrozen(result.detail)).toBe(
      true
    )
    expect(
      result.status === "ready" && Object.isFrozen(result.detail.summary)
    ).toBe(true)
  })

  it("returns a typed not-yet-discoverable result with the final request identity", async () => {
    const lookupCurrent = vi
      .fn<
        (assetId: string, signal: AbortSignal) => Promise<LibraryMediaDetail>
      >()
      .mockRejectedValueOnce(notDiscoverable("request-current-1"))
      .mockRejectedValueOnce(notDiscoverable("request-current-2"))
      .mockRejectedValueOnce(notDiscoverable("request-current-final"))

    await expect(
      resolveManagedMediaCatalogUpload(upload, {
        signal: new AbortController().signal,
        retryDelaysMs: [0, 0],
        lookupCurrent,
        waitForRetry: async () => {},
      })
    ).resolves.toEqual({
      status: "not_yet_discoverable",
      assetId: upload.id,
      attempts: 3,
      requestId: "request-current-final",
    })
    expect(lookupCurrent).toHaveBeenCalledTimes(3)
  })

  it("fails closed on exact source, id, and upload metadata collisions", async () => {
    const ready = managedDetail()
    const wrongSource = libraryMediaDetailSchema.parse({
      ...structuredClone(ready),
      summary: {
        ...structuredClone(ready.summary),
        mediaSource: "curated",
        owner: { kind: "studio" },
      },
      selectionIdentity: {
        source: "curated",
        assetId: upload.id,
        version: ready.summary.version,
      },
    })
    const wrongId = libraryMediaDetailSchema.parse({
      ...structuredClone(ready),
      summary: {
        ...structuredClone(ready.summary),
        id: "asset-ManagedHandshake02",
        preview: {
          ...structuredClone(ready.summary.preview),
          itemId: "asset-ManagedHandshake02",
        },
      },
      selectionIdentity: {
        source: "managed",
        assetId: "asset-ManagedHandshake02",
        catalogVersion: ready.summary.version,
        refetch: "required",
      },
    })
    const wrongMetadata = projectPublicMediaDetail(
      { ...upload, bytes: upload.bytes + 1 },
      {
        catalogVersion: 7,
        description: "Customer-provided workspace upload",
        categoryId: "workspace-upload",
        useCaseIds: [],
        formatFamily: "image",
        tags: [],
        provenance: ready.summary.provenance,
      }
    )

    for (const [detail, reason] of [
      [wrongSource, "identity_mismatch"],
      [wrongId, "identity_mismatch"],
      [wrongMetadata, "metadata_mismatch"],
    ] as const) {
      await expect(
        resolveManagedMediaCatalogUpload(upload, {
          signal: new AbortController().signal,
          retryDelaysMs: [],
          lookupCurrent: async () => detail,
        })
      ).resolves.toEqual({
        status: "stale",
        assetId: upload.id,
        attempts: 1,
        reason,
      })
    }
  })

  it("honors cancellation before lookup and while waiting to retry", async () => {
    const beforeLookup = new AbortController()
    const beforeReason = new Error("cancel before lookup")
    beforeLookup.abort(beforeReason)
    const unusedLookup = vi.fn(async () => managedDetail())

    await expect(
      resolveManagedMediaCatalogUpload(upload, {
        signal: beforeLookup.signal,
        lookupCurrent: unusedLookup,
      })
    ).rejects.toBe(beforeReason)
    expect(unusedLookup).not.toHaveBeenCalled()

    const whileWaiting = new AbortController()
    const waitingReason = new Error("cancel while waiting")
    const lookupCurrent = vi.fn(async () => {
      throw notDiscoverable("request-current-abort")
    })

    await expect(
      resolveManagedMediaCatalogUpload(upload, {
        signal: whileWaiting.signal,
        retryDelaysMs: [100],
        lookupCurrent,
        waitForRetry: async (_delay, signal) => {
          whileWaiting.abort(waitingReason)
          signal.throwIfAborted()
        },
      })
    ).rejects.toBe(waitingReason)
    expect(lookupCurrent).toHaveBeenCalledTimes(1)
  })
})
