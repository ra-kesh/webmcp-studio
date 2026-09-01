import { builtInDesignTemplateRepository } from "@webmcp/document"
import type { SceneNode } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import { DocumentPreviewController } from "./document-preview-controller"
import { createDocumentPreviewIdentity } from "./document-preview-contract"
import type {
  DocumentDraftPreview,
  DocumentDraftRecord,
  DocumentDraftSummary,
} from "./document-draft-repository"

const recordFixture = (documentId = "document-preview") => {
  const document = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  const canonical = { ...document, id: documentId }
  const page = canonical.pages[0]
  const summary: DocumentDraftSummary = {
    schemaVersion: 1,
    documentId,
    name: canonical.name,
    recordVersion: 1,
    contentSnapshotId: `sha256-${"a".repeat(64)}`,
    draftSnapshotId: `sha256-${"b".repeat(64)}`,
    documentRevision: canonical.revision,
    createdAt: canonical.createdAt,
    savedAt: canonical.updatedAt,
    lastOpenedAt: canonical.updatedAt,
    activityAt: canonical.updatedAt,
    deletedAt: null,
    pageCount: canonical.pages.length,
    outputCount: canonical.outputs.length,
    firstPageId: page.id,
    firstPageName: page.name,
    firstPageWidth: page.width,
    firstPageHeight: page.height,
    encodedByteLength: 1,
    exportFormats: ["png", "pdf"],
    sourceKind: null,
    origin: { kind: "blank" },
    lastPublished: null,
  }
  const record: DocumentDraftRecord = {
    summary,
    envelope: {
      schemaVersion: 1,
      document: canonical,
      sourceContext: null,
    },
  }
  return { record, identity: createDocumentPreviewIdentity(summary) }
}

const previewFixture = (
  record: DocumentDraftRecord,
  blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
): DocumentDraftPreview => ({
  schemaVersion: 1,
  documentId: record.summary.documentId,
  contentSnapshotId: record.summary.contentSnapshotId,
  pageId: record.summary.firstPageId,
  rendererRevision: "renderer-thumbnail-v1",
  width: 170,
  height: 240,
  mimeType: "image/png",
  byteLength: blob.size,
  createdAt: "2026-08-29T03:00:00.000Z",
  blob,
})

describe("DocumentPreviewController", () => {
  it("publishes an exact stored preview without reading the document body", async () => {
    const { identity, record } = recordFixture()
    const preview = previewFixture(record)
    const getDocument = vi.fn()
    const createObjectURL = vi.fn(() => "blob:stored-preview")
    const revokeObjectURL = vi.fn()
    const readPreview = vi.fn(async () => ({
      ok: true as const,
      status: "ready" as const,
      preview,
    }))
    const controller = new DocumentPreviewController({
      readPreview,
      getDocument,
      putPreview: vi.fn(),
      createObjectURL,
      revokeObjectURL,
    })

    controller.retain(identity)
    controller.retain(identity)
    await vi.waitFor(() => {
      expect(controller.getSnapshot(identity)).toEqual({
        status: "ready",
        url: "blob:stored-preview",
        cached: true,
      })
    })
    expect(getDocument).not.toHaveBeenCalled()
    expect(readPreview).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledWith(preview.blob)

    controller.dispose()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:stored-preview"
    )
  })

  it("uses an explicit live fallback in development without calling the renderer or preview storage", async () => {
    const { identity, record } = recordFixture("document-local-preview")
    const produce = vi.fn()
    const putPreview = vi.fn()
    const controller = new DocumentPreviewController({
      readPreview: vi.fn(async () => ({
        ok: true as const,
        status: "missing" as const,
      })),
      getDocument: vi.fn(async () => ({
        ok: true as const,
        status: "found" as const,
        record,
      })),
      putPreview,
      produce,
      liveFallback: true,
    })

    controller.retain(identity)
    await vi.waitFor(() => {
      expect(controller.getSnapshot(identity)).toMatchObject({
        status: "live_fallback",
        pageId: record.summary.firstPageId,
      })
    })
    expect(produce).not.toHaveBeenCalled()
    expect(putPreview).not.toHaveBeenCalled()
    controller.dispose()
  })

  it("isolates a preview read failure to the card and retries only on command", async () => {
    const { identity } = recordFixture("document-preview-failure")
    const readPreview = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "storage_unavailable",
        failure: {
          kind: "storage_unavailable",
          message: "Preview storage is temporarily unavailable.",
        },
      })
      .mockResolvedValueOnce({ ok: true, status: "not_active" })
    const controller = new DocumentPreviewController({
      readPreview,
      getDocument: vi.fn(),
      putPreview: vi.fn(),
    })

    const initialRelease = controller.retain(identity)
    await vi.waitFor(() => {
      expect(controller.getSnapshot(identity)).toEqual({
        status: "failed",
        message: "Preview storage is temporarily unavailable.",
        retryable: true,
      })
    })
    expect(readPreview).toHaveBeenCalledTimes(1)

    initialRelease()
    await Promise.resolve()
    controller.retain(identity)
    await Promise.resolve()
    expect(readPreview).toHaveBeenCalledTimes(1)

    controller.retry(identity)
    await vi.waitFor(() => {
      expect(controller.getSnapshot(identity)).toEqual({ status: "deferred" })
    })
    expect(readPreview).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it("never revokes an object URL while its preview still has a consumer", async () => {
    const fixtures = Array.from({ length: 3 }, (_, index) =>
      recordFixture(`document-lru-${index}`)
    )
    let urlIndex = 0
    const revokeObjectURL = vi.fn()
    const controller = new DocumentPreviewController({
      readPreview: vi.fn(async (identity) => {
        const fixture = fixtures.find(
          ({ record }) => record.summary.documentId === identity.documentId
        )
        if (!fixture) throw new Error("Unknown fixture")
        return {
          ok: true as const,
          status: "ready" as const,
          preview: previewFixture(fixture.record),
        }
      }),
      getDocument: vi.fn(),
      putPreview: vi.fn(),
      createObjectURL: vi.fn(() => `blob:lru-${++urlIndex}`),
      revokeObjectURL,
      maxEntries: 2,
    })

    const releases = fixtures.map(({ identity }) => controller.retain(identity))
    await vi.waitFor(() => {
      expect(controller.getSnapshot(fixtures[2].identity).status).toBe("ready")
    })
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(controller.getSnapshot(fixtures[0].identity)).toMatchObject({
      status: "ready",
      url: "blob:lru-1",
    })

    releases[0]?.()
    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:lru-1")
    })
    expect(controller.getSnapshot(fixtures[0].identity)).toEqual({
      status: "deferred",
    })
    for (const release of releases.slice(1)) release()
    controller.dispose()
  })

  it("materializes local and managed image aliases for the live fallback", async () => {
    const fixture = recordFixture("document-fallback-assets")
    const image: Extract<SceneNode, { type: "image" }> = {
      id: "local-image",
      type: "image",
      name: "Local image",
      assetId: "local-preview-asset",
      src: "asset:local/local-preview-asset",
      alt: "Local image",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      decorative: false,
    }
    const record = {
      ...fixture.record,
      envelope: {
        ...fixture.record.envelope,
        document: {
          ...fixture.record.envelope.document,
          pages: fixture.record.envelope.document.pages.map((page, index) =>
            index === 0
              ? { ...page, nodeIds: ["local-image", "managed-image"] }
              : page
          ),
          nodes: [
            image,
            {
              ...image,
              id: "managed-image",
              assetId: "asset-managedpreview01",
              src: "asset:managed/asset-managedpreview01",
            },
          ],
        },
      },
    }
    const revokeObjectURL = vi.fn()
    const controller = new DocumentPreviewController({
      readPreview: vi.fn(async () => ({
        ok: true as const,
        status: "missing" as const,
      })),
      getDocument: vi.fn(async () => ({
        ok: true as const,
        status: "found" as const,
        record,
      })),
      putPreview: vi.fn(),
      liveFallback: true,
      loadLocalAsset: vi.fn(async () => new Blob(["local"])),
      createObjectURL: vi.fn(() => "blob:local-preview"),
      revokeObjectURL,
    })

    controller.retain(fixture.identity)
    await vi.waitFor(() => {
      expect(controller.getSnapshot(fixture.identity).status).toBe(
        "live_fallback"
      )
    })
    const state = controller.getSnapshot(fixture.identity)
    if (state.status !== "live_fallback") throw new Error("Expected fallback")
    expect(
      state.document.nodes.find((node) => node.id === "local-image")
    ).toMatchObject({ src: "blob:local-preview" })
    expect(
      state.document.nodes.find((node) => node.id === "managed-image")
    ).toMatchObject({
      src: "/v1/studio/assets/asset-managedpreview01/content",
    })

    controller.dispose()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:local-preview"
    )
  })

  it("deduplicates consumers and admits at most three exact preview jobs", async () => {
    const identities = Array.from(
      { length: 4 },
      (_, index) => recordFixture(`document-concurrency-${index}`).identity
    )
    const resolvers: Array<
      (result: { ok: true; status: "not_active" }) => void
    > = []
    const readPreview = vi.fn(
      () =>
        new Promise<{ ok: true; status: "not_active" }>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const controller = new DocumentPreviewController({
      readPreview,
      getDocument: vi.fn(),
      putPreview: vi.fn(),
      concurrency: 3,
    })

    for (const identity of identities) controller.retain(identity)
    await vi.waitFor(() => expect(readPreview).toHaveBeenCalledTimes(3))

    resolvers[0]?.({ ok: true, status: "not_active" })
    await vi.waitFor(() => expect(readPreview).toHaveBeenCalledTimes(4))
    for (const resolve of resolvers.slice(1)) {
      resolve({ ok: true, status: "not_active" })
    }
    controller.dispose()
  })
})
