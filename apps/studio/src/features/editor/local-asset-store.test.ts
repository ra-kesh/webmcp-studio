import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import {
  LocalAssetQuotaError,
  archiveLocalAsset,
  assertLocalAssetCapacity,
  deleteLocalAsset,
  getLocalAssetRecord,
  hasLocalAssetBlob,
  hasLocalAsset,
  listLocalAssetSummaries,
  listLocalAssetInventory,
  localAssetStorageSummary,
  saveLocalAsset,
} from "./local-asset-store"

const DATABASE_NAME = "webmcp-studio-assets"

const deleteDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

const openLegacyDatabase = (record: object) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("assets", { keyPath: "id" })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction("assets", "readwrite")
      transaction.objectStore("assets").put(record)
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
  await deleteDatabase()
})

describe("local asset store", () => {
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
