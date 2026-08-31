import { describe, expect, it, vi } from "vitest"
import {
  projectCuratedMediaDetail,
  projectLocalMediaDetail,
  projectPublicMediaDetail,
} from "@webmcp/document"
import type {
  LibraryMediaDetail,
  LocalLibraryMediaMetadata,
  MediaAssetLookup,
  PublicMediaAsset,
  WorkspaceLibraryMediaMetadata,
} from "@webmcp/document"
import type { ExactDeviceLocalMediaSelection } from "../../content/library/device-local-media-discovery-adapter"
import { studioMediaManifest } from "../../content/library/media/manifest"
import type { VerifiedCuratedMediaContent } from "../../content/library/media/curated-media-content"
import type { LocalAssetRecord } from "./local-asset-store"
import {
  LibraryMediaActionPreparationError,
  prepareExactLibraryMediaAction,
} from "./library-media-action-preparation"
import type {
  LibraryMediaActionPreparationPorts,
  LibraryMediaActionPreparationRequest,
} from "./library-media-action-preparation"

const now = "2026-08-31T00:00:00.000Z"
const curatedItem = studioMediaManifest[0]

const curatedDetail = () =>
  projectCuratedMediaDetail(curatedItem, {
    curatedRank: 0,
    preferences: { favorite: false, lastUsedAt: null, collectionIds: [] },
  })

const curatedContent = (): VerifiedCuratedMediaContent => ({
  identity: {
    assetId: curatedItem.id,
    version: curatedItem.version,
    contentSha256: curatedItem.contentSha256,
  },
  item: curatedItem,
  canonicalSource: curatedItem.resourcePath,
  bytes: new Uint8Array(curatedItem.bytes),
  src: `data:${curatedItem.mimeType};base64,verified-preview`,
})

const managedAsset: PublicMediaAsset = {
  id: "asset-managedprepare01",
  name: "Managed proposal.png",
  mediaType: "image/png",
  bytes: 4,
  width: 1_200,
  height: 800,
  createdAt: now,
  updatedAt: now,
  lastUsedAt: now,
  status: "ready",
}

const managedMetadata: WorkspaceLibraryMediaMetadata = {
  catalogVersion: 4,
  description: "Workspace proposal image",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["proposal"],
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
}

const managedDetail = () =>
  projectPublicMediaDetail(managedAsset, managedMetadata)

const managedRecord = (): MediaAssetLookup => ({
  ...managedAsset,
  selectable: true,
})

const localMetadata: LocalLibraryMediaMetadata = {
  description: "Device-local proposal image",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["proposal"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    sourceName: "Device-local upload",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
}

const localRecord = (): LocalAssetRecord => ({
  schemaVersion: 4,
  id: "local-prepare-image",
  name: "Local proposal.png",
  mediaType: "image/png",
  size: 4,
  width: 1_200,
  height: 800,
  createdAt: now,
  updatedAt: now,
  lastUsedAt: now,
  archivedAt: null,
  revision: 7,
  integrity: "ready",
  blob: new Blob([new Uint8Array(4)], { type: "image/png" }),
})

const localSelection = (): ExactDeviceLocalMediaSelection => {
  const record = localRecord()
  return {
    detail: projectLocalMediaDetail(record, localMetadata),
    record,
  }
}

const request = (
  detail: LibraryMediaDetail,
  overrides: Partial<LibraryMediaActionPreparationRequest> = {}
): LibraryMediaActionPreparationRequest => ({
  correlationId: "media-action-attempt-1",
  detail,
  target: { type: "insert", pageId: "page-1" },
  ...overrides,
})

const ports = (
  exactDetail: LibraryMediaDetail,
  overrides: Partial<LibraryMediaActionPreparationPorts> = {}
): LibraryMediaActionPreparationPorts => ({
  getExactDetail: vi.fn(async () => exactDetail),
  resolveCurated: vi.fn(async () => curatedContent()),
  getManagedRecord: vi.fn(async () => managedRecord()),
  verifyManagedResource: vi.fn(async (record) => ({
    assetId: record.id,
    src: `asset:managed/${record.id}`,
    width: record.width,
    height: record.height,
    contentHash: "b".repeat(64),
  })),
  recheckLocal: vi.fn(async () => localSelection()),
  ...overrides,
})

const controller = () => new AbortController()

describe("exact library media action preparation", () => {
  it("admits curated bytes only as an immutable canonical source", async () => {
    const detail = curatedDetail()
    const dependencies = ports(detail)

    const prepared = await prepareExactLibraryMediaAction(
      request(detail, {
        target: { type: "assign_field", fieldId: "field-hero" },
      }),
      dependencies,
      controller().signal
    )

    expect(prepared).toMatchObject({
      source: "curated",
      correlationId: "media-action-attempt-1",
      catalogVersion: curatedItem.version,
      contentHash: curatedItem.contentSha256,
      target: { type: "assign_field", fieldId: "field-hero" },
      asset: {
        assetId: curatedItem.id,
        src: curatedItem.resourcePath,
        width: curatedItem.width,
        height: curatedItem.height,
      },
      mimeType: curatedItem.mimeType,
      bytes: curatedItem.bytes,
    })
    expect(prepared.asset.src).not.toMatch(/^data:/)
    expect(dependencies.getExactDetail).toHaveBeenCalledWith(
      curatedItem.id,
      curatedItem.version,
      expect.any(AbortSignal)
    )
    expect(dependencies.getManagedRecord).not.toHaveBeenCalled()
    expect(dependencies.recheckLocal).not.toHaveBeenCalled()
  })

  it("admits managed media only after exact catalog, repository, and resource checks", async () => {
    const detail = managedDetail()
    const dependencies = ports(detail)

    const prepared = await prepareExactLibraryMediaAction(
      request(detail, {
        target: {
          type: "replace",
          pageId: "page-1",
          nodeId: "image-1",
        },
      }),
      dependencies,
      controller().signal
    )

    expect(prepared).toMatchObject({
      source: "managed",
      catalogVersion: managedMetadata.catalogVersion,
      contentHash: "b".repeat(64),
      asset: {
        assetId: managedAsset.id,
        src: `asset:managed/${managedAsset.id}`,
        width: managedAsset.width,
        height: managedAsset.height,
      },
    })
    expect(dependencies.getExactDetail).toHaveBeenCalledBefore(
      dependencies.getManagedRecord as ReturnType<typeof vi.fn>
    )
    expect(dependencies.getManagedRecord).toHaveBeenCalledBefore(
      dependencies.verifyManagedResource as ReturnType<typeof vi.fn>
    )
    expect(dependencies.resolveCurated).not.toHaveBeenCalled()
    expect(dependencies.recheckLocal).not.toHaveBeenCalled()
  })

  it("admits only the exact device-local revision and verified Blob", async () => {
    const selection = localSelection()
    const dependencies = ports(selection.detail, {
      recheckLocal: vi.fn(async () => selection),
    })

    const prepared = await prepareExactLibraryMediaAction(
      request(selection.detail),
      dependencies,
      controller().signal
    )

    expect(prepared).toMatchObject({
      source: "local",
      revision: selection.record.revision,
      asset: {
        assetId: selection.record.id,
        src: `asset:local/${selection.record.id}`,
        width: selection.record.width,
        height: selection.record.height,
      },
      previewBlob: selection.record.blob,
    })
    expect(dependencies.recheckLocal).toHaveBeenCalledWith(
      {
        source: "local",
        assetId: selection.record.id,
        revision: selection.record.revision,
      },
      expect.any(AbortSignal)
    )
    expect(dependencies.getExactDetail).not.toHaveBeenCalled()
    expect(dependencies.getManagedRecord).not.toHaveBeenCalled()
  })

  it("fails closed when exact catalog identity or source metadata changes", async () => {
    const detail = curatedDetail()
    const changed = curatedDetail()
    changed.summary.id = "different-curated-id"
    changed.selectionIdentity.assetId = "different-curated-id"
    const dependencies = ports(changed)

    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({
      code: "preparation_exact_detail_mismatch",
    })
    expect(dependencies.resolveCurated).not.toHaveBeenCalled()
  })

  it("does not admit a same-ID/version result from another source namespace", async () => {
    const requested = curatedDetail()
    const managedCollision = managedDetail()
    managedCollision.summary.id = requested.summary.id
    managedCollision.summary.version = requested.summary.version
    managedCollision.selectionIdentity.assetId = requested.summary.id
    managedCollision.summary.preview = {
      ...managedCollision.summary.preview,
      itemId: requested.summary.id,
      itemVersion: requested.summary.version,
    }
    const dependencies = ports(managedCollision)

    await expect(
      prepareExactLibraryMediaAction(
        request(requested),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({ code: "preparation_exact_detail_mismatch" })
    expect(dependencies.resolveCurated).not.toHaveBeenCalled()
  })

  it.each([
    [
      "hash",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        identity: { ...content.identity, contentSha256: "f".repeat(64) },
      }),
    ],
    [
      "canonical path",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        canonicalSource: "/library/media/other/v1/" + "f".repeat(64) + ".png",
      }),
    ],
    [
      "dimensions",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        item: { ...content.item, width: content.item.width + 1 },
      }),
    ],
    [
      "MIME",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        item: { ...content.item, mimeType: "image/png" },
      }),
    ],
    [
      "byte size",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        bytes: new Uint8Array(content.bytes.byteLength + 1),
      }),
    ],
    [
      "provenance",
      (content: VerifiedCuratedMediaContent): VerifiedCuratedMediaContent => ({
        ...content,
        item: {
          ...content.item,
          provenance: {
            ...content.item.provenance,
            sourceName: "Wrong source",
          },
        },
      }),
    ],
  ])("rejects curated %s mismatch", async (_label, mismatch) => {
    const detail = curatedDetail()
    const content = mismatch(curatedContent())
    const dependencies = ports(detail, {
      resolveCurated: vi.fn(async () => content),
    })

    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({
      code: "preparation_curated_content_mismatch",
    })
  })

  it("rejects archived managed records before resource verification", async () => {
    const detail = managedDetail()
    const dependencies = ports(detail, {
      getManagedRecord: vi.fn(async () => ({
        ...managedRecord(),
        status: "archived" as const,
        selectable: false,
      })),
    })

    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({
      code: "preparation_managed_record_unavailable",
    })
    expect(dependencies.verifyManagedResource).not.toHaveBeenCalled()
  })

  it("rejects managed repository and resource mismatches", async () => {
    const detail = managedDetail()
    const repositoryMismatch = ports(detail, {
      getManagedRecord: vi.fn(async () => ({
        ...managedRecord(),
        bytes: managedAsset.bytes + 1,
      })),
    })
    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        repositoryMismatch,
        controller().signal
      )
    ).rejects.toMatchObject({ code: "preparation_managed_record_mismatch" })

    const resourceMismatch = ports(detail, {
      verifyManagedResource: vi.fn(async (record) => ({
        assetId: record.id,
        src: "asset:managed/asset-wrongresource01",
        width: record.width,
        height: record.height,
        contentHash: "b".repeat(64),
      })),
    })
    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        resourceMismatch,
        controller().signal
      )
    ).rejects.toMatchObject({ code: "preparation_managed_resource_mismatch" })
  })

  it("rejects a changed local revision and never falls through to a server source", async () => {
    const selection = localSelection()
    const dependencies = ports(selection.detail, {
      recheckLocal: vi.fn(async () => ({
        ...selection,
        record: {
          ...selection.record,
          revision: selection.record.revision + 1,
        },
      })),
    })

    await expect(
      prepareExactLibraryMediaAction(
        request(selection.detail),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({ code: "preparation_local_record_mismatch" })
    expect(dependencies.getExactDetail).not.toHaveBeenCalled()
    expect(dependencies.getManagedRecord).not.toHaveBeenCalled()
  })

  it("aborts before work and fences a fetch that settles after cancellation", async () => {
    const detail = curatedDetail()
    let settle!: (detail: LibraryMediaDetail) => void
    const dependencies = ports(detail, {
      getExactDetail: vi.fn(
        () =>
          new Promise<LibraryMediaDetail>((resolve) => {
            settle = resolve
          })
      ),
    })
    const alreadyAborted = controller()
    alreadyAborted.abort(new DOMException("cancelled", "AbortError"))
    await expect(
      prepareExactLibraryMediaAction(
        request(detail),
        dependencies,
        alreadyAborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(dependencies.getExactDetail).not.toHaveBeenCalled()

    const midFlight = controller()
    const preparation = prepareExactLibraryMediaAction(
      request(detail),
      dependencies,
      midFlight.signal
    )
    midFlight.abort(new DOMException("changed selection", "AbortError"))
    settle(detail)
    await expect(preparation).rejects.toMatchObject({ name: "AbortError" })
    expect(dependencies.resolveCurated).not.toHaveBeenCalled()
  })

  it.each(["curated_resolve", "managed_probe", "local_recheck"] as const)(
    "fences a %s result that settles after cancellation",
    async (stage) => {
      const detail =
        stage === "curated_resolve"
          ? curatedDetail()
          : stage === "managed_probe"
            ? managedDetail()
            : localSelection().detail
      let settle!: (value: unknown) => void
      const pending = new Promise<unknown>((resolve) => {
        settle = resolve
      })
      const dependencies = ports(detail, {
        ...(stage === "curated_resolve"
          ? {
              resolveCurated: vi.fn(
                () => pending as Promise<VerifiedCuratedMediaContent>
              ),
            }
          : {}),
        ...(stage === "managed_probe"
          ? {
              verifyManagedResource: vi.fn(
                () =>
                  pending as ReturnType<
                    LibraryMediaActionPreparationPorts["verifyManagedResource"]
                  >
              ),
            }
          : {}),
        ...(stage === "local_recheck"
          ? {
              recheckLocal: vi.fn(
                () => pending as Promise<ExactDeviceLocalMediaSelection>
              ),
            }
          : {}),
      })
      const cancellation = controller()
      const preparation = prepareExactLibraryMediaAction(
        request(detail),
        dependencies,
        cancellation.signal
      )
      await vi.waitFor(() => {
        const invoked =
          stage === "curated_resolve"
            ? dependencies.resolveCurated
            : stage === "managed_probe"
              ? dependencies.verifyManagedResource
              : dependencies.recheckLocal
        expect(invoked).toHaveBeenCalledOnce()
      })
      cancellation.abort(new DOMException("cancelled", "AbortError"))
      settle(
        stage === "curated_resolve"
          ? curatedContent()
          : stage === "managed_probe"
            ? {
                assetId: managedAsset.id,
                src: `asset:managed/${managedAsset.id}`,
                width: managedAsset.width,
                height: managedAsset.height,
                contentHash: "b".repeat(64),
              }
            : localSelection()
      )
      await expect(preparation).rejects.toMatchObject({ name: "AbortError" })
    }
  )

  it("rejects invalid correlation and action targets before any source read", async () => {
    const detail = curatedDetail()
    const dependencies = ports(detail)
    await expect(
      prepareExactLibraryMediaAction(
        request(detail, { correlationId: "invalid correlation" }),
        dependencies,
        controller().signal
      )
    ).rejects.toBeInstanceOf(LibraryMediaActionPreparationError)
    expect(dependencies.getExactDetail).not.toHaveBeenCalled()

    await expect(
      prepareExactLibraryMediaAction(
        request(detail, {
          target: { type: "insert", pageId: "" },
        }),
        dependencies,
        controller().signal
      )
    ).rejects.toMatchObject({ code: "preparation_request_invalid" })
    expect(dependencies.getExactDetail).not.toHaveBeenCalled()
  })
})
