import {
  builtInDesignTemplateRepository,
  documentSchema,
  localAssetSource,
  managedAssetSource,
  sceneNodeSchema,
} from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftValueResult,
  LocalMediaAdmissionReceipt,
  MigrateLocalMediaInput,
} from "./document-draft-repository"
import type { DocumentRouteAdmissionDependencies } from "./document-route-admission"
import { DocumentRouteAdmissionController } from "./document-route-admission"

const now = "2026-08-30T08:00:00.000Z"
const localAssetId = "route-admission-photo"
const managedAssetId = "asset-routeadmission01"
const localSource = localAssetSource(localAssetId)
const managedSource = managedAssetSource(managedAssetId)
const contentHash = "a".repeat(64)

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const summary = (
  documentId: string,
  options: Partial<DocumentDraftSummary> = {}
): DocumentDraftSummary => ({
  schemaVersion: 1,
  documentId,
  name: documentId,
  recordVersion: 1,
  contentSnapshotId: `sha256-${"1".repeat(64)}`,
  draftSnapshotId: `sha256-${"2".repeat(64)}`,
  documentRevision: 0,
  createdAt: now,
  savedAt: now,
  lastOpenedAt: now,
  activityAt: now,
  deletedAt: null,
  pageCount: 1,
  outputCount: 1,
  firstPageId: "page-1",
  firstPageName: "Page 1",
  firstPageWidth: 1240,
  firstPageHeight: 1754,
  encodedByteLength: 1024,
  exportFormats: ["png", "pdf"],
  sourceKind: null,
  origin: { kind: "blank" },
  lastPublished: null,
  ...options,
})

const envelope = (
  documentId: string,
  withLocalImage = false
): CurrentDraftEnvelope => {
  const base = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  if (!withLocalImage) {
    return {
      schemaVersion: 1,
      document: documentSchema.parse({
        ...base,
        id: documentId,
        name: documentId,
      }),
      sourceContext: null,
    }
  }
  const page = base.pages[0]
  const image = sceneNodeSchema.parse({
    id: "route-admission-image",
    type: "image",
    name: "Route admission image",
    assetId: localAssetId,
    src: localSource,
    alt: "Route admission image",
    altProvenance: "authored",
    decorative: false,
    placement: {
      mode: "manual",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    x: 40,
    y: 40,
    width: 240,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  })
  return {
    schemaVersion: 1,
    document: documentSchema.parse({
      ...base,
      id: documentId,
      name: documentId,
      pages: base.pages.map((candidate) =>
        candidate.id === page.id
          ? { ...candidate, nodeIds: [...candidate.nodeIds, image.id] }
          : candidate
      ),
      nodes: [...base.nodes, image],
    }),
    sourceContext: null,
  }
}

const envelopeWithLocalAliases = (
  documentId: string,
  localAssetIds: readonly string[]
): CurrentDraftEnvelope => {
  const base = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  const page = base.pages[0]
  const images = localAssetIds.map((assetId, index) =>
    sceneNodeSchema.parse({
      id: `route-image-${index}`,
      type: "image",
      name: `Route image ${index}`,
      assetId,
      src: localAssetSource(assetId),
      alt: `Route image ${index}`,
      altProvenance: "authored",
      decorative: false,
      placement: {
        mode: "manual",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      x: index,
      y: index,
      width: 20,
      height: 20,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    })
  )
  return {
    schemaVersion: 1,
    document: documentSchema.parse({
      ...base,
      id: documentId,
      name: documentId,
      pages: base.pages.map((candidate) =>
        candidate.id === page.id
          ? {
              ...candidate,
              nodeIds: [
                ...candidate.nodeIds,
                ...images.map((image) => image.id),
              ],
            }
          : candidate
      ),
      nodes: [...base.nodes, ...images],
    }),
    sourceContext: null,
  }
}

const record = (
  documentId: string,
  options: {
    local?: boolean
    summary?: Partial<DocumentDraftSummary>
    envelope?: CurrentDraftEnvelope
  } = {}
): DocumentDraftRecord => ({
  summary: summary(documentId, options.summary),
  envelope: options.envelope ?? envelope(documentId, options.local),
})

const found = (value: DocumentDraftRecord): DocumentDraftReadResult => ({
  ok: true,
  status: "found",
  record: value,
})

const touched = (
  value: DocumentDraftRecord
): DraftValueResult<DocumentDraftRecord> => ({ ok: true, value })

const receiptFor = (
  input: MigrateLocalMediaInput,
  result: DocumentDraftRecord
): LocalMediaAdmissionReceipt => ({
  schemaVersion: 1,
  receiptId: input.receiptId,
  kind: "local_media_admission",
  documentId: input.source.documentId,
  createdAt: input.createdAt,
  acknowledgedAt: null,
  restoredAt: null,
  source: input.source,
  result: {
    documentId: result.summary.documentId,
    recordVersion: result.summary.recordVersion,
    contentSnapshotId: result.summary.contentSnapshotId,
    draftSnapshotId: result.summary.draftSnapshotId,
    deletedAt: result.summary.deletedAt,
  },
  aliases: input.aliases,
  preimage: envelope(input.source.documentId, true),
  managedUses: [
    {
      assetId: managedAssetId,
      idempotencyKey: "admission-use:test-route-admission",
      requestId: null,
      usedAt: null,
      assetRevision: null,
    },
  ],
})

const dependencies = (
  overrides: Partial<DocumentRouteAdmissionDependencies> = {}
): DocumentRouteAdmissionDependencies => ({
  get: vi.fn(async (documentId: string) => found(record(documentId))),
  touchOpened: vi.fn(async (documentId: string) => touched(record(documentId))),
  getPendingReceipt: vi.fn(async () => ({
    ok: true as const,
    status: "missing" as const,
  })),
  inspectLocalAssets: vi.fn(async (assetIds) =>
    assetIds.map(() => ({ status: "absent" as const }))
  ),
  resolvePromotions: vi.fn(async (assetIds: readonly string[]) => ({
    requestId: "request-route-admission",
    results: assetIds.map((id) => ({
      localAssetId: id,
      promotion: null,
    })),
  })),
  hashBlob: vi.fn(async () => contentHash),
  migrateLocalMedia: vi.fn(async () => {
    throw new Error("Unexpected migration")
  }),
  markManagedUsed: vi.fn(async (assetId) => ({
    assetId,
    requestId: "request-used-route-admission",
    idempotencyKey: "admission-use:test-route-admission",
    usedAt: now,
    assetRevision: 2,
  })),
  updateManagedUse: vi.fn(async () => ({
    ok: false as const,
    reason: "missing" as const,
  })),
  createOperationId: () => "receipt-route-admission",
  now: () => now,
  ...overrides,
})

const mappedResolution = (status: "ready" | "archived" = "ready") => ({
  requestId: "request-route-admission",
  results: [
    {
      localAssetId,
      promotion: {
        localAssetId,
        contentSha256: contentHash,
        asset: {
          id: managedAssetId,
          name: "Managed route image",
          mediaType: "image/png" as const,
          bytes: 128,
          width: 40,
          height: 30,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now,
          status,
          selectable: status === "ready",
          revision: 1,
        },
      },
    },
  ],
})

describe("DocumentRouteAdmissionController", () => {
  it("installs the verified head before touching recency", async () => {
    const verified = record("document-a")
    const touchOpened = vi.fn(async () => touched(verified))
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(verified)),
        touchOpened,
      })
    )

    const admitted = await controller.admit("document-a")
    expect(admitted).toMatchObject({
      status: "opened",
      record: verified,
      media: { status: "not_needed" },
    })
    expect(touchOpened).not.toHaveBeenCalled()
    if (admitted.status !== "opened") return
    await expect(
      controller.confirmInstalled(admitted, admitted.record)
    ).resolves.toEqual({ status: "confirmed", warning: null })
    expect(touchOpened).toHaveBeenCalledOnce()
  })

  it("can reopen the authoritative record without recovery after a precommit admission failure", async () => {
    const verified = record("document-a", { local: true })
    const inspectLocalAssets = vi.fn(async () => {
      throw new Error("Injected local inspection failure")
    })
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(verified)),
        inspectLocalAssets,
      })
    )

    await expect(controller.admit("document-a")).rejects.toThrow(
      "Injected local inspection failure"
    )
    await expect(
      controller.admit("document-a", { recover: false })
    ).resolves.toMatchObject({
      status: "opened",
      record: verified,
      media: {
        status: "deferred",
        migratedLocalAssetIds: [],
      },
    })
    expect(inspectLocalAssets).toHaveBeenCalledOnce()
  })

  it("projects missing, deleted, recovery, and unavailable reads without media work", async () => {
    const cases: readonly [DocumentDraftReadResult, string][] = [
      [{ ok: true, status: "missing" }, "missing"],
      [
        {
          ok: false,
          reason: "corrupt_record",
          quarantineId: "quarantine-a",
          failure: { kind: "corrupt_record", message: "corrupt" },
        },
        "recovery_required",
      ],
      [
        {
          ok: false,
          reason: "storage_unavailable",
          failure: { kind: "storage_unavailable", message: "offline" },
        },
        "unavailable",
      ],
    ]
    for (const [read, expectedStatus] of cases) {
      const inspectLocalAssets = vi.fn()
      const controller = new DocumentRouteAdmissionController(
        dependencies({
          get: vi.fn(async () => read),
          inspectLocalAssets,
        })
      )
      expect((await controller.admit("document-a")).status).toBe(expectedStatus)
      expect(inspectLocalAssets).not.toHaveBeenCalled()
    }

    const deleted = record("document-a", {
      summary: { deletedAt: "2026-08-30T09:00:00.000Z" },
    })
    const controller = new DocumentRouteAdmissionController(
      dependencies({ get: vi.fn(async () => found(deleted)) })
    )
    await expect(controller.admit("document-a")).resolves.toMatchObject({
      status: "deleted",
    })
  })

  it.each(["ready", "archived"] as const)(
    "migrates an absent local alias to an exact %s Studio mapping before install",
    async (status) => {
      const source = record(`document-${status}`, { local: true })
      let migratedRecord: DocumentDraftRecord | null = null
      const migrateLocalMedia = vi.fn(async (input: MigrateLocalMediaInput) => {
        migratedRecord = record(source.summary.documentId, {
          summary: {
            recordVersion: 2,
            contentSnapshotId: `sha256-${"3".repeat(64)}`,
            draftSnapshotId: `sha256-${"4".repeat(64)}`,
            documentRevision: input.resultEnvelope.document.revision,
          },
          envelope: input.resultEnvelope,
        })
        return {
          ok: true as const,
          status: "migrated" as const,
          record: migratedRecord,
          receipt: receiptFor(input, migratedRecord),
        }
      })
      const updateManagedUse = vi.fn(async (input) => {
        const migrationInput = migrateLocalMedia.mock.calls[0][0]
        const managedUseRecord = record(source.summary.documentId, {
          summary: {
            recordVersion: 2,
            contentSnapshotId: `sha256-${"3".repeat(64)}`,
            draftSnapshotId: `sha256-${"4".repeat(64)}`,
          },
          envelope: migrationInput.resultEnvelope,
        })
        return {
          ok: true as const,
          status: "updated" as const,
          receipt: {
            ...receiptFor(migrationInput, managedUseRecord),
            managedUses: [
              {
                assetId: input.assetId,
                idempotencyKey: input.idempotencyKey,
                requestId: input.requestId,
                usedAt: input.usedAt,
                assetRevision: input.assetRevision,
              },
            ],
          },
        }
      })
      const deps = dependencies({
        get: vi.fn(async () => found(source)),
        touchOpened: vi.fn(async () => {
          if (!migratedRecord) throw new Error("Expected migrated record")
          return touched(migratedRecord)
        }),
        resolvePromotions: vi.fn(async () => mappedResolution(status)),
        migrateLocalMedia,
        updateManagedUse,
      })
      const controller = new DocumentRouteAdmissionController(deps)

      const admitted = await controller.admit(source.summary.documentId)
      expect(admitted).toMatchObject({
        status: "opened",
        record: { summary: { recordVersion: 2 } },
        media: {
          status: "migrated",
          migratedLocalAssetIds: [localAssetId],
        },
      })
      expect(migrateLocalMedia).toHaveBeenCalledOnce()
      expect(migrateLocalMedia.mock.calls[0][0].aliases).toMatchObject([
        {
          localAssetId,
          managedAssetId,
          managedStatus: status,
          localState: "absent",
          relationship: "no_local_bytes",
          mappingRequestId: "request-route-admission",
        },
      ])
      expect(
        migrateLocalMedia.mock.calls[0][0].resultEnvelope.document.nodes.find(
          (node) => node.id === "route-admission-image"
        )
      ).toMatchObject({ assetId: managedAssetId, src: managedSource })
      expect(deps.touchOpened).not.toHaveBeenCalled()
      if (admitted.status !== "opened") throw new Error("Expected opened")
      await controller.confirmInstalled(admitted, admitted.record)
      expect(deps.markManagedUsed).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(updateManagedUse).toHaveBeenCalledOnce())
      expect(deps.touchOpened).toHaveBeenCalledOnce()
    }
  )

  it("opens unchanged when an absent local alias becomes a different ready file before migration CAS", async () => {
    const source = record("document-local-state-race", { local: true })
    const inspectLocalAssets = vi
      .fn()
      .mockResolvedValueOnce([{ status: "absent" as const }])
      .mockResolvedValueOnce([
        {
          status: "ready" as const,
          record: {
            schemaVersion: 4 as const,
            id: localAssetId,
            name: "Restored-different.png",
            mediaType: "image/png",
            size: 9,
            width: 1,
            height: 1,
            createdAt: now,
            updatedAt: "2026-08-30T08:01:00.000Z",
            lastUsedAt: "2026-08-30T08:01:00.000Z",
            archivedAt: null,
            revision: 2,
            integrity: "ready" as const,
            blob: new Blob(["different"], { type: "image/png" }),
          },
        },
      ])
    const migrateLocalMedia = vi.fn()
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        inspectLocalAssets,
        resolvePromotions: vi.fn(async () => mappedResolution()),
        migrateLocalMedia,
      })
    )

    await expect(
      controller.admit(source.summary.documentId)
    ).resolves.toMatchObject({
      status: "opened",
      record: source,
      warning: { kind: "local_media_recovery_deferred" },
      media: {
        status: "deferred",
        migratedLocalAssetIds: [],
        message: expect.stringContaining("device image state changed"),
      },
    })
    expect(inspectLocalAssets).toHaveBeenCalledTimes(2)
    expect(migrateLocalMedia).not.toHaveBeenCalled()
  })

  it("rehashes an unchanged ready record before migration and refuses swapped bytes", async () => {
    const source = record("document-ready-hash-race", { local: true })
    const ready = {
      status: "ready" as const,
      record: {
        schemaVersion: 4 as const,
        id: localAssetId,
        name: "Ready.png",
        mediaType: "image/png",
        size: 4,
        width: 1,
        height: 1,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        archivedAt: null,
        revision: 1,
        integrity: "ready" as const,
        blob: new Blob(["same"], { type: "image/png" }),
      },
    }
    const hashBlob = vi
      .fn()
      .mockResolvedValueOnce(contentHash)
      .mockResolvedValueOnce("b".repeat(64))
    const migrateLocalMedia = vi.fn()
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        inspectLocalAssets: vi.fn(async () => [ready]),
        resolvePromotions: vi.fn(async () => mappedResolution()),
        hashBlob,
        migrateLocalMedia,
      })
    )

    await expect(
      controller.admit(source.summary.documentId)
    ).resolves.toMatchObject({
      status: "opened",
      record: source,
      media: { status: "deferred", migratedLocalAssetIds: [] },
    })
    expect(hashBlob).toHaveBeenCalledTimes(2)
    expect(migrateLocalMedia).not.toHaveBeenCalled()
  })

  it("opens unchanged when the exact quarantine set changes before migration CAS", async () => {
    const source = record("document-quarantine-race", { local: true })
    const quarantined = (recordId: string, detectedAt: string) => ({
      status: "quarantined" as const,
      issue: {
        assetId: localAssetId,
        code: "missing_bytes" as const,
        message: "Saved image bytes are missing.",
      },
      expectation: {
        records: [
          {
            recordId,
            detectedAt,
            issueCode: "missing_bytes" as const,
          },
        ],
      },
    })
    const inspectLocalAssets = vi
      .fn()
      .mockResolvedValueOnce([
        quarantined("quarantine-before", "2026-08-30T08:00:00.000Z"),
      ])
      .mockResolvedValueOnce([
        quarantined("quarantine-after", "2026-08-30T08:01:00.000Z"),
      ])
    const migrateLocalMedia = vi.fn()
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        inspectLocalAssets,
        resolvePromotions: vi.fn(async () => mappedResolution()),
        migrateLocalMedia,
      })
    )

    await expect(
      controller.admit(source.summary.documentId)
    ).resolves.toMatchObject({
      status: "opened",
      record: source,
      media: { status: "deferred", migratedLocalAssetIds: [] },
    })
    expect(inspectLocalAssets).toHaveBeenCalledTimes(2)
    expect(migrateLocalMedia).not.toHaveBeenCalled()
  })

  it("opens unresolved, unavailable, and conflicting aliases unchanged", async () => {
    const source = record("document-unresolved", { local: true })
    const cases = [
      {
        local: [{ status: "absent" as const }],
        resolve: {
          requestId: "request-unmapped",
          results: [{ localAssetId, promotion: null }],
        },
        outcome: "missing_unmapped",
      },
      {
        local: [{ status: "absent" as const }],
        resolve: new Error("offline"),
        outcome: "mapping_unavailable",
      },
      {
        local: [
          {
            status: "ready" as const,
            record: {
              schemaVersion: 4 as const,
              id: localAssetId,
              name: "Different.png",
              mediaType: "image/png",
              size: 9,
              width: 1,
              height: 1,
              createdAt: now,
              updatedAt: now,
              lastUsedAt: now,
              archivedAt: null,
              revision: 1,
              integrity: "ready" as const,
              blob: new Blob(["different"], { type: "image/png" }),
            },
          },
        ],
        resolve: mappedResolution("ready"),
        outcome: "identity_conflict",
      },
    ]

    for (const testCase of cases) {
      const migrateLocalMedia = vi.fn()
      const controller = new DocumentRouteAdmissionController(
        dependencies({
          get: vi.fn(async () => found(source)),
          inspectLocalAssets: vi.fn(async () => testCase.local),
          resolvePromotions: vi.fn(async () => {
            if (testCase.resolve instanceof Error) throw testCase.resolve
            return testCase.resolve
          }),
          hashBlob: vi.fn(async () => "b".repeat(64)),
          migrateLocalMedia,
        })
      )
      const admitted = await controller.admit(source.summary.documentId)
      expect(admitted).toMatchObject({
        status: "opened",
        record: source,
        media: {
          status: "unchanged",
          unresolved: [{ outcome: testCase.outcome }],
        },
      })
      expect(migrateLocalMedia).not.toHaveBeenCalled()
    }
  })

  it("uses stable 100-ID mapping chunks and never migrates a successful prefix", async () => {
    const aliases = Array.from(
      { length: 101 },
      (_, index) => `route-batch-${String(index).padStart(3, "0")}`
    )
    const source = record("document-batched", {
      envelope: envelopeWithLocalAliases("document-batched", aliases),
    })
    const calls: string[][] = []
    const resolvePromotions = vi.fn(async (chunk: readonly string[]) => {
      calls.push([...chunk])
      if (chunk.length === 1) throw new Error("second batch unavailable")
      return {
        requestId: "request-first-batch",
        results: chunk.map((id) => ({ localAssetId: id, promotion: null })),
      }
    })
    const migrateLocalMedia = vi.fn()
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        inspectLocalAssets: vi.fn(async (ids) =>
          ids.map(() => ({ status: "absent" as const }))
        ),
        resolvePromotions,
        migrateLocalMedia,
      })
    )

    const admitted = await controller.admit(source.summary.documentId)
    expect(calls).toEqual([aliases.slice(0, 100), aliases.slice(100)])
    expect(admitted).toMatchObject({
      status: "opened",
      record: source,
      media: {
        status: "unchanged",
        aliasCount: 101,
      },
    })
    if (admitted.status === "opened") {
      expect(admitted.media.unresolved).toHaveLength(101)
      expect(
        admitted.media.unresolved.every(
          (item) => item.outcome === "mapping_unavailable"
        )
      ).toBe(true)
    }
    expect(migrateLocalMedia).not.toHaveBeenCalled()
  })

  it("aborts and awaits a superseded mapping operation before starting the next route", async () => {
    const sourceA = record("document-a", { local: true })
    const sourceB = record("document-b")
    const mappingStarted = deferred<void>()
    const mappingStopped = deferred<void>()
    const resolvePromotions = vi.fn(
      (_assetIds: readonly string[], options?: { signal?: AbortSignal }) => {
        mappingStarted.resolve()
        return new Promise<ReturnType<typeof mappedResolution>>((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              mappingStopped.resolve()
              reject(options.signal?.reason)
            },
            { once: true }
          )
        })
      }
    )
    const get = vi.fn(async (documentId: string) =>
      found(documentId === "document-a" ? sourceA : sourceB)
    )
    const controller = new DocumentRouteAdmissionController(
      dependencies({ get, resolvePromotions })
    )

    const openingA = controller.admit("document-a")
    await mappingStarted.promise
    const openingB = controller.admit("document-b")
    await mappingStopped.promise
    await expect(openingA).resolves.toEqual({
      status: "superseded",
      documentId: "document-a",
    })
    await expect(openingB).resolves.toMatchObject({
      status: "opened",
      record: sourceB,
    })
    expect(get.mock.calls.map(([documentId]) => documentId)).toEqual([
      "document-a",
      "document-b",
    ])
  })

  it("rereads and replans the complete document at most twice after stale-head migration races", async () => {
    const records = [1, 2, 3].map((version) =>
      record("document-stale-replan", {
        local: true,
        summary: {
          recordVersion: version,
          contentSnapshotId: `sha256-${String(version).repeat(64)}`,
          draftSnapshotId: `sha256-${String(version + 3).repeat(64)}`,
        },
      })
    )
    let readIndex = 0
    const get = vi.fn(async () =>
      found(records[Math.min(readIndex++, records.length - 1)])
    )
    let migrationAttempt = 0
    const migrateLocalMedia = vi.fn(async (input: MigrateLocalMediaInput) => {
      migrationAttempt += 1
      if (migrationAttempt < 3) {
        return {
          ok: false as const,
          reason: "stale_head" as const,
          current: records[migrationAttempt].summary,
        }
      }
      const migratedRecord = record(input.source.documentId, {
        summary: {
          recordVersion: input.source.recordVersion + 1,
          contentSnapshotId: `sha256-${"8".repeat(64)}`,
          draftSnapshotId: `sha256-${"9".repeat(64)}`,
        },
        envelope: input.resultEnvelope,
      })
      return {
        ok: true as const,
        status: "migrated" as const,
        record: migratedRecord,
        receipt: receiptFor(input, migratedRecord),
      }
    })
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get,
        resolvePromotions: vi.fn(async () => mappedResolution()),
        migrateLocalMedia,
      })
    )

    const admitted = await controller.admit("document-stale-replan")
    expect(admitted).toMatchObject({
      status: "opened",
      record: { summary: { recordVersion: 4 } },
      media: { status: "migrated" },
    })
    expect(get).toHaveBeenCalledTimes(3)
    expect(migrateLocalMedia).toHaveBeenCalledTimes(3)
    expect(
      migrateLocalMedia.mock.calls.map(([input]) => input.source.recordVersion)
    ).toEqual([1, 2, 3])
  })

  it("opens before Recent reconciliation and retries the same pending receipt on a later confirmed open", async () => {
    const source = record("document-commit-wins", { local: true })
    const migratedRecord = record(source.summary.documentId, {
      summary: {
        recordVersion: 2,
        contentSnapshotId: `sha256-${"3".repeat(64)}`,
        draftSnapshotId: `sha256-${"4".repeat(64)}`,
      },
    })
    let durableReceipt: LocalMediaAdmissionReceipt | null = null
    const migrateLocalMedia = vi.fn(async (input: MigrateLocalMediaInput) => {
      durableReceipt = receiptFor(input, migratedRecord)
      return {
        ok: true as const,
        status: "migrated" as const,
        record: migratedRecord,
        receipt: durableReceipt,
      }
    })
    let useAttempt = 0
    const markManagedUsed = vi.fn((assetId: string) => {
      useAttempt += 1
      if (useAttempt > 1) {
        return Promise.resolve({
          assetId,
          requestId: "request-used-replayed",
          idempotencyKey: "admission-use:test-route-admission",
          usedAt: now,
          assetRevision: 2,
        })
      }
      return Promise.reject(new Error("Recent is temporarily unavailable"))
    })
    const updateManagedUse = vi.fn(async (input) => ({
      ok: true as const,
      status: "updated" as const,
      receipt: {
        ...durableReceipt!,
        managedUses: [
          {
            assetId: input.assetId,
            idempotencyKey: input.idempotencyKey,
            requestId: input.requestId,
            usedAt: input.usedAt,
            assetRevision: input.assetRevision,
          },
        ],
      },
    }))
    const getPendingReceipt = vi.fn(async () =>
      durableReceipt
        ? ({ ok: true, status: "found", receipt: durableReceipt } as const)
        : ({ ok: true, status: "missing" } as const)
    )
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(durableReceipt ? migratedRecord : source)),
        touchOpened: vi.fn(async () => touched(migratedRecord)),
        getPendingReceipt,
        resolvePromotions: vi.fn(async () => mappedResolution()),
        migrateLocalMedia,
        markManagedUsed,
        updateManagedUse,
      })
    )

    const firstOpen = await controller.admit(source.summary.documentId)
    expect(firstOpen).toMatchObject({
      status: "opened",
      media: { status: "migrated" },
    })
    expect(markManagedUsed).not.toHaveBeenCalled()
    if (firstOpen.status !== "opened") throw new Error("Expected opened")
    await controller.confirmInstalled(firstOpen, firstOpen.record)
    await vi.waitFor(() => expect(markManagedUsed).toHaveBeenCalledOnce())
    expect(updateManagedUse).not.toHaveBeenCalled()

    const secondOpen = await controller.admit(source.summary.documentId)
    expect(secondOpen).toMatchObject({
      status: "opened",
      record: migratedRecord,
      media: {
        status: "receipt_pending",
        receipt: { receiptId: "receipt-route-admission" },
      },
    })
    if (secondOpen.status !== "opened") throw new Error("Expected opened")
    await controller.confirmInstalled(secondOpen, secondOpen.record)
    await vi.waitFor(() => expect(markManagedUsed).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(updateManagedUse).toHaveBeenCalledOnce())
    expect(migrateLocalMedia).toHaveBeenCalledOnce()
  })

  it("opens a restored device-only receipt unchanged and skips managed Recent", async () => {
    const restoredRecord = record("document-restored", { local: true })
    const input = {
      receiptId: "receipt-route-admission",
      source: {
        documentId: restoredRecord.summary.documentId,
        recordVersion: 1,
        contentSnapshotId: restoredRecord.summary.contentSnapshotId,
        draftSnapshotId: restoredRecord.summary.draftSnapshotId,
        deletedAt: null,
      },
      resultEnvelope: restoredRecord.envelope,
      aliases: [],
      createdAt: now,
    } as MigrateLocalMediaInput
    const restoredReceipt = {
      ...receiptFor(input, restoredRecord),
      restoredAt: now,
    }
    const deps = dependencies({
      get: vi.fn(async () => found(restoredRecord)),
      getPendingReceipt: vi.fn(async () => ({
        ok: true as const,
        status: "found" as const,
        receipt: restoredReceipt,
      })),
    })
    const controller = new DocumentRouteAdmissionController(deps)

    const admitted = await controller.admit(restoredRecord.summary.documentId)
    expect(admitted).toMatchObject({
      status: "opened",
      record: restoredRecord,
      media: {
        status: "receipt_pending",
        migratedLocalAssetIds: [],
        receipt: { restoredAt: now },
        message: expect.stringContaining("device-only"),
      },
    })
    if (admitted.status !== "opened") throw new Error("Expected opened")
    await controller.confirmInstalled(admitted, admitted.record)
    expect(deps.inspectLocalAssets).not.toHaveBeenCalled()
    expect(deps.markManagedUsed).not.toHaveBeenCalled()
  })

  it("never touches a different or superseded installed head and reports touch failure as a warning", async () => {
    const source = record("document-touch")
    const touchFailure = {
      kind: "storage_unavailable",
      message: "Recent activity is unavailable.",
    } as const
    const touchOpened = vi.fn(async () => ({
      ok: false as const,
      reason: "storage_unavailable" as const,
      failure: touchFailure,
    }))
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        touchOpened,
      })
    )
    const admission = await controller.admit(source.summary.documentId)
    if (admission.status !== "opened") throw new Error("Expected opened")

    await expect(
      controller.confirmInstalled(admission, record("another-document"))
    ).resolves.toEqual({ status: "superseded" })
    expect(touchOpened).not.toHaveBeenCalled()

    await expect(
      controller.confirmInstalled(admission, admission.record)
    ).resolves.toEqual({ status: "confirmed", warning: touchFailure })
    expect(touchOpened).toHaveBeenCalledOnce()

    await controller.supersede()
    await expect(
      controller.confirmInstalled(admission, admission.record)
    ).resolves.toEqual({ status: "superseded" })
    expect(touchOpened).toHaveBeenCalledOnce()
  })

  it("rejects a touch that reveals an advanced head and does not start its pending use receipt", async () => {
    const source = record("document-touch-advanced")
    const advanced = record(source.summary.documentId, {
      summary: {
        recordVersion: 2,
        contentSnapshotId: `sha256-${"3".repeat(64)}`,
        draftSnapshotId: `sha256-${"4".repeat(64)}`,
      },
    })
    const markManagedUsed = vi.fn()
    const controller = new DocumentRouteAdmissionController(
      dependencies({
        get: vi.fn(async () => found(source)),
        touchOpened: vi.fn(async () => touched(advanced)),
        markManagedUsed,
      })
    )
    const admitted = await controller.admit(source.summary.documentId)
    if (admitted.status !== "opened") throw new Error("Expected opened")
    const receiptInput: MigrateLocalMediaInput = {
      source: {
        documentId: source.summary.documentId,
        recordVersion: source.summary.recordVersion,
        contentSnapshotId: source.summary.contentSnapshotId,
        draftSnapshotId: source.summary.draftSnapshotId,
        deletedAt: null,
      },
      resultEnvelope: source.envelope,
      aliases: [],
      receiptId: "receipt-touch-advanced",
      createdAt: now,
    }
    const admissionWithReceipt = {
      ...admitted,
      media: {
        status: "migrated" as const,
        aliasCount: 0,
        migratedLocalAssetIds: [],
        unresolved: [],
        receipt: receiptFor(receiptInput, source),
        message: null,
      },
    }

    await expect(
      controller.confirmInstalled(admissionWithReceipt, source)
    ).resolves.toEqual({ status: "superseded" })
    expect(markManagedUsed).not.toHaveBeenCalled()
  })
})
