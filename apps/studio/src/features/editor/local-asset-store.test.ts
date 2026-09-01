import "fake-indexeddb/auto"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  LocalAssetQuotaError,
  archiveLocalAsset,
  assertLocalAssetCapacity,
  deleteLocalAsset,
  getLocalAssetRecord,
  getLocalAssetMetadataSummary,
  hasLocalAssetBlob,
  hasLocalAsset,
  inspectRequestedLocalAssets,
  listLocalAssetMetadataInventory,
  listLocalAssetSummaries,
  listLocalAssetInventory,
  localAssetStorageSummary,
  localAssetSource,
  restoreLocalAssetBlob,
  saveLocalAsset,
} from "./local-asset-store"

const DATABASE_NAME = "webmcp-studio-assets"

const deferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const deleteDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

const openLegacyDatabase = (record: object | object[]) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("assets", { keyPath: "id" })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction("assets", "readwrite")
      for (const entry of Array.isArray(record) ? record : [record]) {
        transaction.objectStore("assets").put(entry)
      }
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })

const openVersionThreeDatabase = ({
  legacyRecord,
  metadata,
  blob,
}: {
  legacyRecord: object
  metadata?: object
  blob?: unknown
}) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore("assets", { keyPath: "id" })
      database.createObjectStore("asset-metadata", { keyPath: "id" })
      database.createObjectStore("asset-blobs")
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(
        ["assets", "asset-metadata", "asset-blobs"],
        "readwrite"
      )
      transaction.objectStore("assets").put(legacyRecord)
      if (metadata) transaction.objectStore("asset-metadata").put(metadata)
      if (blob !== undefined) {
        transaction.objectStore("asset-blobs").put(blob, "asset-1")
      }
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })

const updateCurrentAssetStorage = async (
  assetId: string,
  update: { metadata?: unknown; blob?: unknown; deleteBlob?: boolean }
) => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction(
    ["asset-metadata", "asset-blobs"],
    "readwrite"
  )
  if (update.metadata !== undefined) {
    transaction.objectStore("asset-metadata").put(update.metadata)
  }
  if (update.blob !== undefined) {
    transaction.objectStore("asset-blobs").put(update.blob, assetId)
  }
  if (update.deleteBlob) {
    transaction.objectStore("asset-blobs").delete(assetId)
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

const quarantineCount = async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction("asset-quarantine", "readonly")
  const request = transaction.objectStore("asset-quarantine").count()
  const count = await new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return count
}

afterEach(async () => {
  vi.restoreAllMocks()
  await deleteDatabase()
})

describe("local asset store", () => {
  it("lists bounded metadata without opening Blob storage and defers decode to exact inspection", async () => {
    const file = new File(["image"], "image.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-metadata-only", {
      width: 10,
      height: 20,
    })
    const transactions = vi.spyOn(IDBDatabase.prototype, "transaction")
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll")
    const createObjectUrl = vi.spyOn(URL, "createObjectURL")
    const verifyBlob = vi.fn(async () => ({ width: 10, height: 20 }))

    const inventory = await listLocalAssetMetadataInventory({ limit: 1 })
    const metadata = await getLocalAssetMetadataSummary("asset-metadata-only")

    expect(inventory).toMatchObject({
      schemaVersion: 1,
      databaseVersion: 6,
      migrationState: "current",
      legacyRecordCount: 0,
      legacyMetadataRecordCount: 0,
      metadataRecordCount: 1,
      examinedMetadataCount: 1,
      unindexedMetadataCount: 0,
      truncated: false,
      assets: [
        expect.objectContaining({
          id: "asset-metadata-only",
          width: 10,
          height: 20,
          integrity: "ready",
        }),
      ],
      issues: [],
    })
    expect(getAll).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({
      id: "asset-metadata-only",
      width: 10,
      height: 20,
      revision: 1,
    })
    expect(createObjectUrl).not.toHaveBeenCalled()
    expect(
      transactions.mock.calls.flatMap(([names]) =>
        typeof names === "string" ? [names] : Array.from(names)
      )
    ).not.toContain("asset-blobs")
    expect(verifyBlob).not.toHaveBeenCalled()

    transactions.mockClear()
    const [selected] = await inspectRequestedLocalAssets(
      ["asset-metadata-only"],
      { verifyBlob }
    )

    expect(selected).toMatchObject({
      status: "ready",
      record: {
        id: "asset-metadata-only",
        blob: expect.objectContaining({ size: file.size, type: file.type }),
      },
    })
    expect(verifyBlob).toHaveBeenCalledOnce()
    expect(verifyBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: file.size, type: file.type })
    )
    expect(createObjectUrl).not.toHaveBeenCalled()
    expect(
      transactions.mock.calls.flatMap(([names]) =>
        typeof names === "string" ? [names] : Array.from(names)
      )
    ).toContain("asset-blobs")
  })

  it("reconciles decoded dimension drift with a new revision before exact selection", async () => {
    const file = new File(["image"], "dimension-drift.png", {
      type: "image/png",
    })
    await saveLocalAsset(file, "asset-dimension-drift", {
      width: 10,
      height: 20,
    })

    await expect(
      inspectRequestedLocalAssets(["asset-dimension-drift"], {
        verifyBlob: async () => ({ width: 30, height: 40 }),
      })
    ).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        code: "local_media_local_repository_changed",
      }),
    ])
    await expect(
      getLocalAssetMetadataSummary("asset-dimension-drift")
    ).resolves.toMatchObject({
      width: 30,
      height: 40,
      revision: 2,
    })
    await expect(
      inspectRequestedLocalAssets(["asset-dimension-drift"], {
        verifyBlob: async () => ({ width: 30, height: 40 }),
      })
    ).resolves.toEqual([
      expect.objectContaining({
        status: "ready",
        record: expect.objectContaining({
          width: 30,
          height: 40,
          revision: 2,
        }),
      }),
    ])
  })

  it("reports normalized split-store metadata without claiming it is current schema", async () => {
    const file = new File(["image"], "legacy-metadata.png", {
      type: "image/png",
    })
    await saveLocalAsset(file, "asset-legacy-metadata", {
      width: 10,
      height: 20,
    })
    await updateCurrentAssetStorage("asset-legacy-metadata", {
      metadata: {
        schemaVersion: 3,
        id: "asset-legacy-metadata",
        name: "legacy-metadata.png",
        mediaType: "image/png",
        size: file.size,
        width: 10,
        height: 20,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
        lastUsedAt: "2026-08-30T00:00:00.000Z",
        archivedAt: null,
        revision: 1,
      },
    })

    await expect(listLocalAssetMetadataInventory()).resolves.toMatchObject({
      migrationState: "metadata_upgrade_pending",
      legacyMetadataRecordCount: 1,
      metadataRecordCount: 1,
      assets: [
        expect.objectContaining({
          schemaVersion: 4,
          id: "asset-legacy-metadata",
        }),
      ],
    })
  })

  it("bounds the metadata cursor and reports an intentionally partial scan", async () => {
    await saveLocalAsset(
      new File(["older"], "older.png", { type: "image/png" }),
      "asset-older",
      {
        width: 10,
        height: 20,
        now: "2026-08-30T00:00:00.000Z",
      }
    )
    await saveLocalAsset(
      new File(["newer"], "newer.png", { type: "image/png" }),
      "asset-newer",
      {
        width: 10,
        height: 20,
        now: "2026-08-31T00:00:00.000Z",
      }
    )

    await expect(
      listLocalAssetMetadataInventory({ limit: 1 })
    ).resolves.toMatchObject({
      migrationState: "scan_truncated",
      metadataRecordCount: 2,
      truncated: true,
      assets: [expect.objectContaining({ id: "asset-newer" })],
    })
    await expect(
      listLocalAssetMetadataInventory({ limit: 1_001 })
    ).rejects.toThrow("1-1000 item limit")
  })

  it("reports pending legacy migration without reading or migrating legacy bytes during discovery", async () => {
    const blob = new Blob(["legacy-image"], { type: "image/png" })
    await openLegacyDatabase({
      id: "legacy-metadata-only",
      blob,
      name: "legacy.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll")

    const beforeSelection = await listLocalAssetMetadataInventory()

    expect(beforeSelection).toMatchObject({
      migrationState: "legacy_pending",
      legacyRecordCount: 1,
      metadataRecordCount: 0,
      assets: [],
    })
    expect(getAll).not.toHaveBeenCalled()

    const verifyBlob = vi.fn(async () => ({ width: 1, height: 1 }))
    const [selected] = await inspectRequestedLocalAssets(
      ["legacy-metadata-only"],
      { verifyBlob }
    )
    expect(selected).toMatchObject({
      status: "unavailable",
      code: "local_media_local_repository_changed",
    })
    expect(verifyBlob).toHaveBeenCalledWith(blob)
    await expect(
      inspectRequestedLocalAssets(["legacy-metadata-only"], { verifyBlob })
    ).resolves.toEqual([
      expect.objectContaining({
        status: "ready",
        record: expect.objectContaining({
          id: "legacy-metadata-only",
          blob,
          width: 1,
          height: 1,
          revision: 2,
        }),
      }),
    ])
    await expect(listLocalAssetMetadataInventory()).resolves.toMatchObject({
      migrationState: "current",
      legacyRecordCount: 0,
      metadataRecordCount: 1,
      assets: [expect.objectContaining({ id: "legacy-metadata-only" })],
    })
  })

  it("inspects only requested aliases in exact order and keeps missing bytes distinct", async () => {
    const first = new File(["first"], "first.png", { type: "image/png" })
    const missing = new File(["missing"], "missing.png", {
      type: "image/png",
    })
    const unrelated = new File(["unrelated"], "unrelated.png", {
      type: "image/png",
    })
    await saveLocalAsset(first, "asset-first", { width: 1, height: 1 })
    await saveLocalAsset(missing, "asset-missing", { width: 1, height: 1 })
    await saveLocalAsset(unrelated, "asset-unrelated", {
      width: 1,
      height: 1,
    })
    await updateCurrentAssetStorage("asset-missing", { deleteBlob: true })
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll")
    const verifyBlob = vi.fn(async () => ({ width: 1, height: 1 }))

    const states = await inspectRequestedLocalAssets(
      ["asset-absent", "asset-first", "asset-missing"],
      { verifyBlob }
    )

    expect(states).toEqual([
      { status: "absent" },
      {
        status: "ready",
        record: expect.objectContaining({
          id: "asset-first",
          blob: expect.objectContaining({ size: first.size, type: first.type }),
        }),
      },
      {
        status: "missing_bytes",
        summary: expect.objectContaining({
          id: "asset-missing",
          integrity: "missing_bytes",
        }),
        issue: expect.objectContaining({
          assetId: "asset-missing",
          code: "missing_bytes",
        }),
      },
    ])
    expect(verifyBlob).toHaveBeenCalledTimes(1)
    expect(verifyBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: first.size, type: first.type })
    )
    expect(getAll).toHaveBeenCalledTimes(3)
    expect(getAll.mock.calls.every((call) => call[1] === 101)).toBe(true)
  })

  it("restores missing bytes only against the exact inspected revision", async () => {
    const original = new File(["same-image"], "original.png", {
      type: "image/png",
    })
    await saveLocalAsset(original, "asset-restore", {
      width: 10,
      height: 20,
      now: "2026-08-30T00:00:00.000Z",
    })
    await updateCurrentAssetStorage("asset-restore", { deleteBlob: true })
    const [state] = await inspectRequestedLocalAssets(["asset-restore"], {
      verifyBlob: async () => ({ width: 10, height: 20 }),
    })
    expect(state.status).toBe("missing_bytes")
    if (state.status !== "missing_bytes")
      throw new Error("Expected missing bytes")

    const restored = await restoreLocalAssetBlob({
      assetId: "asset-restore",
      file: original,
      expected: {
        status: "missing_bytes",
        revision: state.summary.revision,
        updatedAt: state.summary.updatedAt,
      },
      expectedContentSha256: "a".repeat(64),
      contentSha256: "a".repeat(64),
      width: 10,
      height: 20,
      now: "2026-08-30T00:01:00.000Z",
    })

    expect(restored).toEqual({
      ok: true,
      status: "restored",
      record: expect.objectContaining({
        id: "asset-restore",
        revision: 2,
        updatedAt: "2026-08-30T00:01:00.000Z",
        blob: original,
      }),
    })
    await expect(getLocalAssetRecord("asset-restore")).resolves.toEqual(
      expect.objectContaining({ id: "asset-restore", revision: 2 })
    )
    await expect(hasLocalAssetBlob("asset-restore")).resolves.toBe(true)
  })

  it("does not overwrite a local alias that changed after inspection", async () => {
    const original = new File(["same-image"], "original.png", {
      type: "image/png",
    })
    await saveLocalAsset(original, "asset-restore-race", {
      width: 10,
      height: 20,
      now: "2026-08-30T00:00:00.000Z",
    })
    await updateCurrentAssetStorage("asset-restore-race", { deleteBlob: true })
    const [state] = await inspectRequestedLocalAssets(["asset-restore-race"], {
      verifyBlob: async () => ({ width: 10, height: 20 }),
    })
    if (state.status !== "missing_bytes")
      throw new Error("Expected missing bytes")
    await saveLocalAsset(
      new File(["newer-image"], "newer.png", { type: "image/png" }),
      "asset-restore-race",
      { width: 30, height: 40, now: "2026-08-30T00:01:00.000Z" }
    )

    await expect(
      restoreLocalAssetBlob({
        assetId: "asset-restore-race",
        file: original,
        expected: {
          status: "missing_bytes",
          revision: state.summary.revision,
          updatedAt: state.summary.updatedAt,
        },
        expectedContentSha256: "a".repeat(64),
        contentSha256: "a".repeat(64),
        width: 10,
        height: 20,
      })
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "state_changed" })
    )
    await expect(getLocalAssetRecord("asset-restore-race")).resolves.toEqual(
      expect.objectContaining({ name: "newer.png", width: 30, height: 40 })
    )
  })

  it("rejects a different selected file before touching local storage", async () => {
    await expect(
      restoreLocalAssetBlob({
        assetId: "asset-absent-restore",
        file: new File(["different"], "different.png", {
          type: "image/png",
        }),
        expected: { status: "absent" },
        expectedContentSha256: "a".repeat(64),
        contentSha256: "b".repeat(64),
        width: 10,
        height: 20,
      })
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "identity_mismatch" })
    )
    await expect(hasLocalAsset("asset-absent-restore")).resolves.toBe(false)
  })

  it("restores an exact quarantined identity while retaining its forensic record", async () => {
    const file = new File(["recoverable-image"], "recoverable.png", {
      type: "image/png",
    })
    await saveLocalAsset(file, "asset-quarantined-restore", {
      width: 10,
      height: 20,
    })
    const [quarantined] = await inspectRequestedLocalAssets(
      ["asset-quarantined-restore"],
      { verifyBlob: async () => Promise.reject(new Error("decode failed")) }
    )
    expect(quarantined).toEqual(
      expect.objectContaining({ status: "quarantined" })
    )
    if (quarantined.status !== "quarantined") {
      throw new Error("Expected quarantined image")
    }

    await expect(
      restoreLocalAssetBlob({
        assetId: "asset-quarantined-restore",
        file,
        expected: {
          status: "quarantined",
          quarantine: quarantined.expectation,
        },
        expectedContentSha256: "a".repeat(64),
        contentSha256: "a".repeat(64),
        width: 10,
        height: 20,
      })
    ).resolves.toEqual(
      expect.objectContaining({ ok: true, status: "restored" })
    )
    await expect(
      getLocalAssetRecord("asset-quarantined-restore")
    ).resolves.toEqual(
      expect.objectContaining({ integrity: "ready", revision: 1 })
    )
    await expect(quarantineCount()).resolves.toBe(1)
  })

  it("refuses a stale quarantine expectation after the alias is re-quarantined", async () => {
    const first = new File(["first-image"], "first.png", {
      type: "image/png",
    })
    await saveLocalAsset(first, "asset-quarantine-race", {
      width: 10,
      height: 20,
    })
    const [firstState] = await inspectRequestedLocalAssets(
      ["asset-quarantine-race"],
      { verifyBlob: async () => Promise.reject(new Error("decode failed")) }
    )
    if (firstState.status !== "quarantined") {
      throw new Error("Expected first quarantine")
    }
    await restoreLocalAssetBlob({
      assetId: "asset-quarantine-race",
      file: first,
      expected: {
        status: "quarantined",
        quarantine: firstState.expectation,
      },
      expectedContentSha256: "a".repeat(64),
      contentSha256: "a".repeat(64),
      width: 10,
      height: 20,
    })
    await saveLocalAsset(
      new File(["newer-image"], "newer.png", { type: "image/png" }),
      "asset-quarantine-race",
      { width: 30, height: 40 }
    )
    const [newerState] = await inspectRequestedLocalAssets(
      ["asset-quarantine-race"],
      { verifyBlob: async () => Promise.reject(new Error("decode failed")) }
    )
    expect(newerState.status).toBe("quarantined")

    await expect(
      restoreLocalAssetBlob({
        assetId: "asset-quarantine-race",
        file: first,
        expected: {
          status: "quarantined",
          quarantine: firstState.expectation,
        },
        expectedContentSha256: "a".repeat(64),
        contentSha256: "a".repeat(64),
        width: 10,
        height: 20,
      })
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "state_changed" })
    )
    await expect(
      getLocalAssetRecord("asset-quarantine-race")
    ).resolves.toBeNull()
    await expect(quarantineCount()).resolves.toBe(2)
  })

  it("migrates only requested legacy aliases without scanning the retained library", async () => {
    await openLegacyDatabase([
      {
        id: "legacy-requested",
        blob: new Blob(["requested"], { type: "image/png" }),
        name: "requested.png",
        mediaType: "image/png",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "legacy-unrelated",
        blob: new Blob(["unrelated"], { type: "image/png" }),
        name: "unrelated.png",
        mediaType: "image/png",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ])

    await expect(
      inspectRequestedLocalAssets(["legacy-requested"], {
        verifyBlob: async () => ({ width: 1, height: 1 }),
      })
    ).resolves.toEqual([
      {
        status: "unavailable",
        code: "local_media_local_repository_changed",
        message:
          "The saved image dimensions changed during verification. Retry with the updated local revision.",
      },
    ])
    await expect(
      inspectRequestedLocalAssets(["legacy-requested"], {
        verifyBlob: async () => ({ width: 1, height: 1 }),
      })
    ).resolves.toEqual([
      {
        status: "ready",
        record: expect.objectContaining({
          id: "legacy-requested",
          width: 1,
          height: 1,
          revision: 2,
        }),
      },
    ])
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("assets", "readonly")
    const keys = transaction.objectStore("assets").getAllKeys()
    await expect(
      new Promise<IDBValidKey[]>((resolve, reject) => {
        keys.onsuccess = () => resolve(keys.result)
        keys.onerror = () => reject(keys.error)
      })
    ).resolves.toEqual(["legacy-unrelated"])
    database.close()
  })

  it("quarantines only proven corrupt requested bytes and remembers that state", async () => {
    const corrupt = new File(["corrupt"], "corrupt.png", {
      type: "image/png",
    })
    const healthy = new File(["healthy"], "healthy.png", {
      type: "image/png",
    })
    await saveLocalAsset(corrupt, "asset-corrupt", { width: 1, height: 1 })
    await saveLocalAsset(healthy, "asset-healthy", { width: 1, height: 1 })

    await expect(
      inspectRequestedLocalAssets(["asset-corrupt"], {
        verifyBlob: async () => {
          throw new Error("decode failed")
        },
      })
    ).resolves.toEqual([
      expect.objectContaining({
        status: "quarantined",
        issue: expect.objectContaining({
          assetId: "asset-corrupt",
          code: "corrupt_bytes",
        }),
      }),
    ])
    await expect(
      inspectRequestedLocalAssets(["asset-corrupt"], {
        verifyBlob: async () => ({ width: 1, height: 1 }),
      })
    ).resolves.toEqual([
      expect.objectContaining({
        status: "quarantined",
        issue: expect.objectContaining({
          assetId: "asset-corrupt",
          code: "corrupt_bytes",
        }),
      }),
    ])
    await expect(getLocalAssetRecord("asset-healthy")).resolves.toEqual(
      expect.objectContaining({ id: "asset-healthy" })
    )
    expect(await quarantineCount()).toBe(1)
  })

  it("returns ordered unavailable states when local storage cannot be read", async () => {
    await saveLocalAsset(
      new File(["ready"], "ready.png", { type: "image/png" }),
      "asset-ready"
    )
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("storage unavailable")
    })

    await expect(
      inspectRequestedLocalAssets(["asset-ready", "asset-absent"])
    ).resolves.toEqual([
      {
        status: "unavailable",
        code: "local_media_local_repository_unavailable",
        message: "Studio could not inspect saved images on this device.",
      },
      {
        status: "unavailable",
        code: "local_media_local_repository_unavailable",
        message: "Studio could not inspect saved images on this device.",
      },
    ])
  })

  it("rejects invalid, duplicate, empty, and over-limit requested alias sets", async () => {
    await expect(inspectRequestedLocalAssets([])).rejects.toBeInstanceOf(
      RangeError
    )
    await expect(
      inspectRequestedLocalAssets(["asset-one", "asset-one"])
    ).rejects.toBeInstanceOf(TypeError)
    await expect(inspectRequestedLocalAssets(["../escape"])).rejects.toThrow()
    await expect(
      inspectRequestedLocalAssets(
        Array.from({ length: 5_001 }, (_, index) => `asset-${index}`)
      )
    ).rejects.toBeInstanceOf(RangeError)
  })

  it("waits for a requested byte check to acknowledge cancellation", async () => {
    const file = new File(["ready"], "ready.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-ready")
    const controller = new AbortController()
    let finishVerification: () => void = () => {}
    const verification = new Promise<void>((resolve) => {
      finishVerification = resolve
    })
    const reason = new DOMException("Superseded", "AbortError")
    const inspection = inspectRequestedLocalAssets(["asset-ready"], {
      signal: controller.signal,
      verifyBlob: async () => {
        await verification
        return { width: 1, height: 1 }
      },
    })
    const rejection = expect(inspection).rejects.toBe(reason)
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(false))

    controller.abort(reason)
    finishVerification()

    await rejection
  })

  it("waits for every concurrent requested byte check after cancellation", async () => {
    await saveLocalAsset(
      new File(["first"], "first.png", { type: "image/png" }),
      "asset-first"
    )
    await saveLocalAsset(
      new File(["second"], "second.png", { type: "image/png" }),
      "asset-second"
    )
    const gates = [deferred(), deferred()]
    let verificationCount = 0
    const controller = new AbortController()
    const reason = new DOMException("Superseded", "AbortError")
    const inspection = inspectRequestedLocalAssets(
      ["asset-first", "asset-second"],
      {
        signal: controller.signal,
        verificationConcurrency: 2,
        verifyBlob: async () => {
          const gate = gates[verificationCount]
          verificationCount += 1
          await gate.promise
          return { width: 1, height: 1 }
        },
      }
    )
    await vi.waitFor(() => expect(verificationCount).toBe(2))
    let settled = false
    void inspection.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    controller.abort(reason)
    gates[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    gates[1].resolve()

    await expect(inspection).rejects.toBe(reason)
  })

  it("uses the shared bounded local alias contract before writing bytes", async () => {
    const file = new File(["image"], "image.png", { type: "image/png" })

    expect(localAssetSource("valid.local-id:1")).toBe(
      "asset:local/valid.local-id:1"
    )
    expect(() => localAssetSource("../escape")).toThrow()
    await expect(saveLocalAsset(file, "../escape")).rejects.toThrow()
    expect(await listLocalAssetSummaries()).toEqual([])
  })

  it("quarantines a legacy row whose alias cannot enter a document", async () => {
    const blob = new Blob(["legacy-image"], { type: "image/png" })
    await openLegacyDatabase({
      id: "../escape",
      blob,
      name: "legacy.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })

    const inventory = await listLocalAssetInventory()

    expect(inventory.assets).toEqual([])
    expect(inventory.issues).toEqual([])
    expect(await quarantineCount()).toBe(1)
  })

  it("migrates a version 1 row into separate metadata and blob stores", async () => {
    const blob = new Blob(["legacy-image"], { type: "image/png" })
    await openLegacyDatabase({
      id: "legacy-1",
      blob,
      name: "legacy.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })

    const summaries = await listLocalAssetSummaries()
    const record = await getLocalAssetRecord("legacy-1")

    expect(summaries).toEqual([
      expect.objectContaining({
        schemaVersion: 4,
        id: "legacy-1",
        name: "legacy.png",
        size: blob.size,
      }),
    ])
    expect(await record?.blob.text()).toBe("legacy-image")
    const migratedDatabase = await new Promise<IDBDatabase>(
      (resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }
    )
    const legacyTransaction = migratedDatabase.transaction("assets", "readonly")
    const legacyCount = legacyTransaction.objectStore("assets").count()
    expect(
      await new Promise<number>((resolve, reject) => {
        legacyCount.onsuccess = () => resolve(legacyCount.result)
        legacyCount.onerror = () => reject(legacyCount.error)
      })
    ).toBe(0)
    migratedDatabase.close()
  })

  it("migrates before a direct canvas asset load", async () => {
    const blob = new Blob(["legacy-image"], { type: "image/png" })
    await openLegacyDatabase({
      id: "legacy-direct",
      blob,
      name: "legacy.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })

    const record = await getLocalAssetRecord("legacy-direct")

    expect(await record?.blob.text()).toBe("legacy-image")
  })

  it("shares one safe migration across concurrent reads", async () => {
    const blob = new Blob(["legacy-image"], { type: "image/png" })
    await openLegacyDatabase({
      id: "legacy-concurrent",
      blob,
      name: "legacy.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })

    const [record, summaries] = await Promise.all([
      getLocalAssetRecord("legacy-concurrent"),
      listLocalAssetSummaries(),
    ])

    expect(await record?.blob.text()).toBe("legacy-image")
    expect(summaries.map((summary) => summary.id)).toEqual([
      "legacy-concurrent",
    ])
  })

  it("does not start a retry open until a cancelled database open settles", async () => {
    const actualOpen = indexedDB.open.bind(indexedDB)
    const lateDatabase = {
      close: vi.fn(),
      onversionchange: null,
      transaction: vi.fn(),
    } as unknown as IDBDatabase
    const pendingRequest = {
      result: lateDatabase,
      error: null,
      transaction: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    } as unknown as IDBOpenDBRequest
    let openCount = 0
    vi.spyOn(indexedDB, "open").mockImplementation(
      (name: string, version?: number) => {
        openCount += 1
        if (openCount === 2) return pendingRequest
        return version === undefined
          ? actualOpen(name)
          : actualOpen(name, version)
      }
    )
    const controller = new AbortController()
    const firstRead = getLocalAssetRecord("missing", controller.signal)
    await vi.waitFor(() => expect(openCount).toBe(2))
    const reason = new DOMException("Export cancelled", "AbortError")

    controller.abort(reason)

    let firstSettled = false
    void firstRead.then(
      () => {
        firstSettled = true
      },
      () => {
        firstSettled = true
      }
    )
    const retry = getLocalAssetRecord("missing")
    await Promise.resolve()
    await Promise.resolve()
    expect(firstSettled).toBe(false)
    expect(openCount).toBe(2)

    pendingRequest.onsuccess?.(new Event("success"))

    await expect(firstRead).rejects.toBe(reason)
    await expect(retry).resolves.toBeNull()
    expect(lateDatabase.close).toHaveBeenCalledOnce()
    expect(lateDatabase.transaction).not.toHaveBeenCalled()
    expect(openCount).toBe(4)
  })

  it("preserves a newer split-store record over its retained legacy row", async () => {
    const legacyBlob = new Blob(["stale"], { type: "image/png" })
    const currentBlob = new Blob(["current"], { type: "image/png" })
    await openVersionThreeDatabase({
      legacyRecord: {
        id: "asset-1",
        blob: legacyBlob,
        name: "stale.png",
        mediaType: "image/png",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      metadata: {
        schemaVersion: 3,
        id: "asset-1",
        name: "current.png",
        mediaType: "image/png",
        size: currentBlob.size,
        width: 1200,
        height: 800,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        lastUsedAt: "2026-08-02T00:00:00.000Z",
        revision: 7,
      },
      blob: currentBlob,
    })

    const record = await getLocalAssetRecord("asset-1")

    expect(record).toEqual(
      expect.objectContaining({ name: "current.png", revision: 7 })
    )
    expect(await record?.blob.text()).toBe("current")
  })

  it("quarantines a legacy conflict instead of overwriting partial current state", async () => {
    const legacyBlob = new Blob(["stale"], { type: "image/png" })
    await openVersionThreeDatabase({
      legacyRecord: {
        id: "asset-1",
        blob: legacyBlob,
        name: "stale.png",
        mediaType: "image/png",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      metadata: {
        schemaVersion: 3,
        id: "asset-1",
        name: "current.png",
        mediaType: "image/png",
        size: 7,
        width: 1200,
        height: 800,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        lastUsedAt: "2026-08-02T00:00:00.000Z",
        revision: 7,
      },
    })

    expect(await getLocalAssetRecord("asset-1")).toBeNull()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("asset-quarantine", "readonly")
    const countRequest = transaction.objectStore("asset-quarantine").count()
    expect(
      await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })
    ).toBe(1)
    database.close()
  })

  it("quarantines incoherent split metadata and bytes", async () => {
    const legacyBlob = new Blob(["legacy"], { type: "image/png" })
    await openVersionThreeDatabase({
      legacyRecord: {
        id: "asset-1",
        blob: legacyBlob,
        name: "legacy.png",
        mediaType: "image/png",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      metadata: {
        schemaVersion: 3,
        id: "asset-1",
        name: "current.png",
        mediaType: "image/png",
        size: 999,
        width: 1200,
        height: 800,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        lastUsedAt: "2026-08-02T00:00:00.000Z",
        revision: 7,
      },
      blob: new Blob(["wrong"], { type: "image/jpeg" }),
    })

    expect(await getLocalAssetRecord("asset-1")).toBeNull()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("asset-quarantine", "readonly")
    const countRequest = transaction.objectStore("asset-quarantine").count()
    expect(
      await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })
    ).toBe(1)
    database.close()
  })

  it("quarantines a corrupt legacy row without hiding healthy inventory", async () => {
    await openLegacyDatabase({
      id: "broken-1",
      name: "broken.png",
      mediaType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
    })

    expect(await listLocalAssetSummaries()).toEqual([])
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("asset-quarantine", "readonly")
    const countRequest = transaction.objectStore("asset-quarantine").count()
    expect(
      await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })
    ).toBe(1)
    database.close()
  })

  it("lists metadata even when one blob is missing", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-1", { width: 10, height: 20 })

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("asset-blobs", "readwrite")
    transaction.objectStore("asset-blobs").delete("asset-1")
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    expect(await listLocalAssetSummaries()).toEqual([
      expect.objectContaining({
        id: "asset-1",
        width: 10,
        height: 20,
        integrity: "missing_bytes",
      }),
    ])
    await expect(listLocalAssetInventory()).resolves.toEqual({
      assets: [expect.objectContaining({ id: "asset-1" })],
      issues: [
        expect.objectContaining({
          assetId: "asset-1",
          code: "missing_bytes",
        }),
      ],
    })
    expect(await getLocalAssetRecord("asset-1")).toBeNull()
    expect(await hasLocalAssetBlob("asset-1")).toBe(false)
    expect(await hasLocalAsset("asset-1")).toBe(false)
  })

  it("does not treat a non-Blob payload as healthy asset bytes", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-1")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("asset-blobs", "readwrite")
    transaction.objectStore("asset-blobs").put("corrupt", "asset-1")
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    expect(await hasLocalAssetBlob("asset-1")).toBe(false)
    expect(await getLocalAssetRecord("asset-1")).toBeNull()
    expect(await listLocalAssetSummaries()).toEqual([])
    expect(await quarantineCount()).toBe(1)
  })

  it("quarantines malformed current metadata instead of dropping it as healthy", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-current-corrupt")
    await updateCurrentAssetStorage("asset-current-corrupt", {
      metadata: {
        id: "asset-current-corrupt",
        name: "portrait.png",
        mediaType: "image/png",
        size: "not-a-number",
      },
    })

    const inventory = await listLocalAssetInventory()

    expect(inventory.assets).toEqual([])
    expect(inventory.issues).toEqual([
      expect.objectContaining({
        assetId: "asset-current-corrupt",
        code: "corrupt_metadata",
      }),
    ])
    expect(await quarantineCount()).toBe(1)
    expect(await hasLocalAssetBlob("asset-current-corrupt")).toBe(false)
  })

  it("quarantines current size and MIME mismatches as one corrupt pair", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-current-mismatch")
    await updateCurrentAssetStorage("asset-current-mismatch", {
      blob: new Blob(["different"], { type: "image/jpeg" }),
    })

    const inventory = await listLocalAssetInventory()

    expect(inventory.assets).toEqual([])
    expect(inventory.issues).toEqual([
      expect.objectContaining({
        assetId: "asset-current-mismatch",
        code: "metadata_mismatch",
      }),
    ])
    expect(await quarantineCount()).toBe(1)
  })

  it("quarantines matching-size and matching-MIME bytes that cannot decode", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-undecodable", {
      width: 10,
      height: 20,
    })
    await updateCurrentAssetStorage("asset-undecodable", {
      blob: new Blob(["xxxxx"], { type: "image/png" }),
    })

    const inventory = await listLocalAssetInventory({
      verifyBlob: async () => {
        throw new Error("decode failed")
      },
    })

    expect(inventory.assets).toEqual([])
    expect(inventory.issues).toEqual([
      expect.objectContaining({
        assetId: "asset-undecodable",
        code: "corrupt_bytes",
      }),
    ])
    expect(await getLocalAssetRecord("asset-undecodable")).toBeNull()
    expect(await quarantineCount()).toBe(1)
    expect(await localAssetStorageSummary()).toEqual(
      expect.objectContaining({
        activeAssetCount: 0,
        activeAssetBytes: 0,
        retainedAssetCount: 0,
        retainedAssetBytes: 0,
      })
    )
  })

  it("reconciles cached dimensions from authoritative decoded bytes", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-dimensions", { width: 10, height: 20 })

    const inventory = await listLocalAssetInventory({
      verifyBlob: async () => ({ width: 640, height: 480 }),
    })

    expect(inventory.assets).toEqual([
      expect.objectContaining({
        id: "asset-dimensions",
        width: 640,
        height: 480,
        revision: 2,
      }),
    ])
    expect(await getLocalAssetRecord("asset-dimensions")).toEqual(
      expect.objectContaining({ width: 640, height: 480, revision: 2 })
    )
  })

  it("does not return a phantom ready record when archive wins during decode", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-archive-race", {
      width: 10,
      height: 20,
    })
    let releaseDecode: () => void = () => {}
    let reportDecodeStarted: () => void = () => {}
    const decodeStarted = new Promise<void>((resolve) => {
      reportDecodeStarted = resolve
    })
    const decodeBarrier = new Promise<void>((resolve) => {
      releaseDecode = resolve
    })
    const inventoryPromise = listLocalAssetInventory({
      includeArchived: true,
      verifyBlob: async () => {
        reportDecodeStarted()
        await decodeBarrier
        return { width: 640, height: 480 }
      },
    })
    await decodeStarted
    const current = await getLocalAssetRecord("asset-archive-race")
    await archiveLocalAsset("asset-archive-race", current?.revision ?? 0)
    releaseDecode()

    await expect(inventoryPromise).resolves.toEqual({ assets: [], issues: [] })
    await expect(getLocalAssetRecord("asset-archive-race")).resolves.toEqual(
      expect.objectContaining({
        archivedAt: expect.any(String),
        width: 10,
        height: 20,
        revision: 2,
      })
    )
  })

  it("lets only one concurrent inventory reconcile a stored revision", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-inventory-race", {
      width: 10,
      height: 20,
    })
    let releaseFirst: () => void = () => {}
    let releaseSecond: () => void = () => {}
    let firstStarted: () => void = () => {}
    let secondStarted: () => void = () => {}
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const secondStart = new Promise<void>((resolve) => {
      secondStarted = resolve
    })
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondBarrier = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const firstInventory = listLocalAssetInventory({
      verifyBlob: async () => {
        firstStarted()
        await firstBarrier
        return { width: 640, height: 480 }
      },
    })
    const secondInventory = listLocalAssetInventory({
      verifyBlob: async () => {
        secondStarted()
        await secondBarrier
        return { width: 800, height: 600 }
      },
    })
    await Promise.all([firstStart, secondStart])
    releaseFirst()
    await expect(firstInventory).resolves.toEqual({
      assets: [
        expect.objectContaining({ width: 640, height: 480, revision: 2 }),
      ],
      issues: [],
    })
    releaseSecond()
    await expect(secondInventory).resolves.toEqual({ assets: [], issues: [] })
    await expect(getLocalAssetRecord("asset-inventory-race")).resolves.toEqual(
      expect.objectContaining({ width: 640, height: 480, revision: 2 })
    )
  })

  it("archives from the library without removing bytes needed by history", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-1")
    const current = await getLocalAssetRecord("asset-1")

    await archiveLocalAsset("asset-1", current?.revision ?? 0)

    expect(await listLocalAssetSummaries()).toEqual([])
    expect(await listLocalAssetSummaries({ includeArchived: true })).toEqual([
      expect.objectContaining({
        id: "asset-1",
        archivedAt: expect.any(String),
      }),
    ])
    expect(await (await getLocalAssetRecord("asset-1"))?.blob.text()).toBe(
      "image"
    )
    expect(await localAssetStorageSummary()).toEqual(
      expect.objectContaining({
        activeAssetCount: 0,
        activeAssetBytes: 0,
        archivedAssetCount: 1,
        archivedAssetBytes: file.size,
        retainedAssetCount: 1,
        retainedAssetBytes: file.size,
      })
    )
  })

  it("keeps inventory available when browser quota estimation fails", async () => {
    const originalStorage = Reflect.get(navigator, "storage")
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => Promise.reject(new Error("blocked")) },
    })
    try {
      const file = new File(["image"], "portrait.png", { type: "image/png" })
      await saveLocalAsset(file, "asset-1")

      await expect(localAssetStorageSummary()).resolves.toEqual({
        activeAssetBytes: file.size,
        activeAssetCount: 1,
        archivedAssetBytes: 0,
        archivedAssetCount: 0,
        retainedAssetBytes: file.size,
        retainedAssetCount: 1,
        browserUsageBytes: null,
        browserQuotaBytes: null,
        browserAvailableBytes: null,
      })
      await expect(assertLocalAssetCapacity(file.size)).resolves.toBeUndefined()
    } finally {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: originalStorage,
      })
    }
  })

  it("deletes metadata and bytes as one repository operation", async () => {
    const file = new File(["image"], "portrait.png", { type: "image/png" })
    await saveLocalAsset(file, "asset-1")

    await deleteLocalAsset("asset-1")

    expect(await listLocalAssetSummaries()).toEqual([])
    expect(await getLocalAssetRecord("asset-1")).toBeNull()
  })

  it("distinguishes quota exhaustion before writing", async () => {
    const originalStorage = Reflect.get(navigator, "storage")
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ quota: 100, usage: 90 }) },
    })
    try {
      await expect(assertLocalAssetCapacity(11)).rejects.toBeInstanceOf(
        LocalAssetQuotaError
      )
      await expect(assertLocalAssetCapacity(10)).resolves.toBeUndefined()
    } finally {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: originalStorage,
      })
    }
  })
})
