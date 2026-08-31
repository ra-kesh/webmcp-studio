import { describe, expect, it, vi } from "vitest"
import {
  libraryMediaDetailSchema,
  libraryMediaSummarySchema,
} from "@webmcp/document"
import type {
  LocalAssetAdmissionState,
  LocalAssetMetadataInventory,
  LocalAssetRecord,
  LocalAssetSummary,
} from "../../features/editor/local-asset-store"
import {
  createDeviceLocalMediaDiscoveryAdapter,
  DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
  DeviceLocalMediaDiscoveryError,
  projectDeviceLocalMediaInventory,
} from "./device-local-media-discovery-adapter"

const blob = new Blob(["verified-image"], { type: "image/png" })

const record = (
  overrides: Partial<LocalAssetRecord> = {}
): LocalAssetRecord => ({
  schemaVersion: 4,
  id: "asset-local-1",
  name: "Campaign photo.png",
  mediaType: "image/png",
  size: blob.size,
  width: 1200,
  height: 800,
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  lastUsedAt: "2026-08-31T10:00:00.000Z",
  archivedAt: null,
  revision: 4,
  integrity: "ready",
  blob,
  ...overrides,
})

const summary = (value: LocalAssetRecord = record()): LocalAssetSummary => {
  const { blob: _blob, ...metadata } = value
  return metadata
}

const inventory = (
  assets: LocalAssetMetadataInventory["assets"],
  overrides: Partial<LocalAssetMetadataInventory> = {}
): LocalAssetMetadataInventory => ({
  schemaVersion: 1,
  databaseVersion: 6,
  migrationState: "current",
  legacyRecordCount: 0,
  legacyMetadataRecordCount: 0,
  metadataRecordCount: assets.length,
  examinedMetadataCount: assets.length,
  unindexedMetadataCount: 0,
  truncated: false,
  assets,
  issues: [
    {
      assetId: "asset-quarantined",
      code: "corrupt_bytes",
      message: "Retained for recovery",
    },
  ],
  ...overrides,
})

const dependencies = (
  listed: LocalAssetMetadataInventory,
  admission: LocalAssetAdmissionState = {
    status: "ready",
    record: record(),
  }
) => ({
  listMetadataInventory: vi.fn(async () => listed),
  getMetadataSummary: vi.fn(async () => summary()),
  inspectRequested: vi.fn(async () => [admission]),
})

const expectCode = async (
  promise: Promise<unknown>,
  code: DeviceLocalMediaDiscoveryError["code"]
) => {
  await expect(promise).rejects.toMatchObject({
    name: "DeviceLocalMediaDiscoveryError",
    code,
  })
}

describe("device-local media discovery adapter", () => {
  it("projects only current schema-ready metadata without durable organization", async () => {
    const ready = record()
    const missing = record({
      id: "asset-missing",
      integrity: "missing_bytes",
    })
    const archived = record({
      id: "asset-archived",
      archivedAt: "2026-08-31T11:00:00.000Z",
    })
    const incomplete = record({
      id: "asset-incomplete",
      width: null,
      height: null,
    })
    const source = inventory([ready, missing, archived, incomplete])
    const ports = dependencies(source)
    const adapter = createDeviceLocalMediaDiscoveryAdapter(ports)

    const result = await adapter.list()
    const summaries = result.items

    expect(ports.listMetadataInventory).toHaveBeenCalledWith({
      includeArchived: true,
      limit: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
    })
    expect(ports.inspectRequested).not.toHaveBeenCalled()
    expect(ports.getMetadataSummary).not.toHaveBeenCalled()
    expect(summaries).toHaveLength(1)
    const parsedSummary = libraryMediaSummarySchema.parse(summaries[0])
    expect(parsedSummary).toMatchObject({
      itemKind: "media",
      id: ready.id,
      version: ready.revision,
      mediaSource: "local",
      selectable: true,
      permissions: {
        canView: true,
        canUse: true,
        canFavorite: false,
        canAddToCollection: false,
      },
      preferences: {
        favorite: false,
        lastUsedAt: ready.lastUsedAt,
        collectionIds: [],
      },
      dimensions: { width: ready.width, height: ready.height },
      preview: {
        kind: "live_fallback",
        resourcePath: null,
        mediaType: null,
      },
    })
    expect(parsedSummary.provenance).toMatchObject({
      sourceName: "Device-local upload",
      sourceUrl: null,
      contentSha256: null,
    })
    expect(source.issues).toEqual([
      expect.objectContaining({ assetId: "asset-quarantined" }),
    ])
    expect(result.status).toMatchObject({
      migrationState: "current",
      metadataRecordCount: 4,
      examinedMetadataCount: 4,
      projectedItemCount: 1,
      archivedRecordCount: 1,
      unavailableRecordCount: 2,
      truncated: false,
      issues: [expect.objectContaining({ assetId: "asset-quarantined" })],
    })
  })

  it("returns strict metadata detail without opening or decoding Blob storage", async () => {
    const current = record()
    const ports = dependencies(inventory([current]))
    ports.getMetadataSummary.mockResolvedValueOnce(summary(current))
    const adapter = createDeviceLocalMediaDiscoveryAdapter(ports)

    const detail = await adapter.getDetail(current.id, current.revision)

    expect(ports.getMetadataSummary).toHaveBeenCalledWith(current.id, undefined)
    expect(ports.inspectRequested).not.toHaveBeenCalled()
    expect(libraryMediaDetailSchema.parse(detail)).toEqual(detail)
    expect(detail).toMatchObject({
      summary: {
        id: current.id,
        version: current.revision,
        mediaSource: "local",
      },
      selectionIdentity: {
        source: "local",
        assetId: current.id,
        revision: current.revision,
      },
    })
  })

  it("returns the same verified record after an exact revision recheck", async () => {
    const current = record()
    const ports = dependencies(inventory([current]), {
      status: "ready",
      record: current,
    })
    const adapter = createDeviceLocalMediaDiscoveryAdapter(ports)

    const selection = await adapter.recheckSelection({
      source: "local",
      assetId: current.id,
      revision: current.revision,
    })

    expect(ports.inspectRequested).toHaveBeenCalledWith([current.id], undefined)
    expect(selection.record).toBe(current)
    expect(libraryMediaDetailSchema.parse(selection.detail)).toEqual(
      selection.detail
    )
    expect(selection.detail).toMatchObject({
      summary: {
        id: current.id,
        version: current.revision,
        mediaSource: "local",
      },
      selectionIdentity: {
        source: "local",
        assetId: current.id,
        revision: current.revision,
      },
    })
  })

  it("rejects a changed revision instead of silently selecting newer bytes", async () => {
    const listed = record({ revision: 4 })
    const changed = record({
      revision: 5,
      updatedAt: "2026-08-31T12:00:00.000Z",
    })
    const ports = dependencies(inventory([listed]))
    ports.getMetadataSummary.mockResolvedValueOnce(summary(changed))
    const adapter = createDeviceLocalMediaDiscoveryAdapter(ports)

    await expectCode(
      adapter.getDetail(listed.id, listed.revision),
      "local_media_revision_mismatch"
    )
  })

  it("rejects archived, missing, quarantined, absent, and unavailable exact records", async () => {
    const current = record()
    const cases: ReadonlyArray<
      readonly [
        LocalAssetAdmissionState,
        DeviceLocalMediaDiscoveryError["code"],
      ]
    > = [
      [
        {
          status: "ready",
          record: record({
            archivedAt: "2026-08-31T12:00:00.000Z",
            revision: current.revision,
          }),
        },
        "local_media_archived",
      ],
      [
        {
          status: "missing_bytes",
          summary: record({ integrity: "missing_bytes" }),
          issue: {
            assetId: current.id,
            code: "missing_bytes",
            message: "Missing",
          },
        },
        "local_media_missing_bytes",
      ],
      [
        {
          status: "quarantined",
          issue: {
            assetId: current.id,
            code: "corrupt_bytes",
            message: "Quarantined",
          },
          expectation: { records: [] },
        },
        "local_media_quarantined",
      ],
      [{ status: "absent" }, "local_media_absent"],
      [
        {
          status: "unavailable",
          code: "local_media_local_repository_unavailable",
          message: "Unavailable",
        },
        "local_media_repository_unavailable",
      ],
      [
        {
          status: "unavailable",
          code: "local_media_local_repository_changed",
          message: "Changed",
        },
        "local_media_repository_changed",
      ],
    ]

    for (const [state, code] of cases) {
      const adapter = createDeviceLocalMediaDiscoveryAdapter(
        dependencies(inventory([current]), state)
      )
      await expectCode(
        adapter.recheckSelection({
          source: "local",
          assetId: current.id,
          revision: current.revision,
        }),
        code
      )
    }
  })

  it("does not transfer another browser profile's local availability claim", async () => {
    const firstProfile = record()
    const first = createDeviceLocalMediaDiscoveryAdapter(
      dependencies(inventory([firstProfile]))
    )
    const { items } = await first.list()
    const [portableSummary] = items
    const second = createDeviceLocalMediaDiscoveryAdapter(
      dependencies(inventory([]), { status: "absent" })
    )

    await expectCode(
      second.recheckSelection({
        source: "local",
        assetId: portableSummary.id,
        revision: portableSummary.version,
      }),
      "local_media_absent"
    )
  })

  it("rejects a mismatched repository response and honors abort before and after reads", async () => {
    const current = record()
    const mismatch = record({ id: "asset-other" })
    const adapter = createDeviceLocalMediaDiscoveryAdapter(
      dependencies(inventory([current]), { status: "ready", record: mismatch })
    )
    await expectCode(
      adapter.recheckSelection({
        source: "local",
        assetId: current.id,
        revision: current.revision,
      }),
      "local_media_integrity_unavailable"
    )

    const tooMany = dependencies(inventory([current]))
    tooMany.inspectRequested.mockResolvedValueOnce([
      { status: "ready", record: current },
      { status: "ready", record: current },
    ])
    await expectCode(
      createDeviceLocalMediaDiscoveryAdapter(tooMany).recheckSelection({
        source: "local",
        assetId: current.id,
        revision: current.revision,
      }),
      "local_media_integrity_unavailable"
    )

    await expectCode(
      adapter.getDetail("../private", 0),
      "local_media_identity_invalid"
    )
    await expect(adapter.getDetail("../private", 0)).rejects.toBeInstanceOf(
      DeviceLocalMediaDiscoveryError
    )

    const preAborted = new AbortController()
    preAborted.abort(new DOMException("Stopped", "AbortError"))
    await expect(adapter.list(preAborted.signal)).rejects.toMatchObject({
      name: "AbortError",
    })

    const delayed = new AbortController()
    const delayedPorts = dependencies(inventory([current]))
    delayedPorts.listMetadataInventory.mockImplementationOnce(async () => {
      delayed.abort(new DOMException("Stopped", "AbortError"))
      return inventory([current])
    })
    await expect(
      createDeviceLocalMediaDiscoveryAdapter(delayedPorts).list(delayed.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps the pure inventory projection free of Blob and private locator fields", () => {
    const result = projectDeviceLocalMediaInventory(inventory([record()]))
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("blob:")
    expect(serialized).not.toContain("blobUrl")
    expect(serialized).not.toContain("indexedDB")
    expect(serialized).not.toContain("asset:local/")
  })

  it("bounds the browser-owned overlay", () => {
    const records = Array.from(
      { length: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT + 1 },
      (_, index) => record({ id: `asset-local-${index + 1}` })
    )

    const result = projectDeviceLocalMediaInventory(
      inventory(records, {
        metadataRecordCount: records.length,
        examinedMetadataCount: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
        migrationState: "scan_truncated",
        truncated: true,
      })
    )

    expect(result.items).toHaveLength(DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT)
    expect(result.items.at(-1)?.id).toBe(
      `asset-local-${DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT}`
    )
    expect(result.status).toMatchObject({
      migrationState: "scan_truncated",
      metadataRecordCount: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT + 1,
      examinedMetadataCount: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
      projectedItemCount: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
      truncated: true,
    })
  })

  it("propagates migration, partial-scan, and integrity truth end to end", async () => {
    const source = inventory(
      [record({ archivedAt: "2026-08-31T12:00:00.000Z" })],
      {
        migrationState: "legacy_pending",
        legacyRecordCount: 3,
        legacyMetadataRecordCount: 2,
        metadataRecordCount: 1_050,
        examinedMetadataCount: 1_000,
        unindexedMetadataCount: 4,
        truncated: true,
        issues: [
          {
            assetId: "asset-corrupt-metadata",
            code: "corrupt_metadata",
            message: "Could not validate metadata",
          },
        ],
      }
    )
    const result = await createDeviceLocalMediaDiscoveryAdapter(
      dependencies(source)
    ).list()

    expect(result.items).toEqual([])
    expect(result.status).toEqual({
      schemaVersion: 1,
      databaseVersion: 6,
      migrationState: "legacy_pending",
      legacyRecordCount: 3,
      legacyMetadataRecordCount: 2,
      metadataRecordCount: 1_050,
      examinedMetadataCount: 1_000,
      unindexedMetadataCount: 4,
      projectedItemCount: 0,
      archivedRecordCount: 1,
      unavailableRecordCount: 0,
      truncated: true,
      issues: [
        {
          assetId: "asset-corrupt-metadata",
          code: "corrupt_metadata",
          message: "Could not validate metadata",
        },
      ],
    })

    const metadataUpgrade = await createDeviceLocalMediaDiscoveryAdapter(
      dependencies(
        inventory([], {
          migrationState: "metadata_upgrade_pending",
          legacyMetadataRecordCount: 5,
          metadataRecordCount: 9,
          examinedMetadataCount: 5,
          unindexedMetadataCount: 4,
          issues: [],
        })
      )
    ).list()
    expect(metadataUpgrade.status).toMatchObject({
      migrationState: "metadata_upgrade_pending",
      legacyMetadataRecordCount: 5,
      metadataRecordCount: 9,
      examinedMetadataCount: 5,
      unindexedMetadataCount: 4,
      truncated: false,
      issues: [],
    })
  })
})
