import {
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
  LOCAL_ASSET_PREFIX,
  localAssetIdFromSource as canonicalLocalAssetIdFromSource,
  localAssetIdSchema,
  localAssetSource as canonicalLocalAssetSource,
} from "@webmcp/document"
import {
  LOCAL_ASSET_BLOB_STORE_NAME as BLOB_STORE_NAME,
  LOCAL_ASSET_LEGACY_STORE_NAME as LEGACY_STORE_NAME,
  LOCAL_ASSET_METADATA_STORE_NAME as METADATA_STORE_NAME,
  LOCAL_ASSET_QUARANTINE_STORE_NAME as QUARANTINE_STORE_NAME,
  openLocalAssetDatabase,
} from "./local-asset-database"

export { LOCAL_ASSET_PREFIX }

export type LocalAssetSummary = {
  schemaVersion: 4
  id: string
  name: string
  mediaType: string
  size: number
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
  archivedAt: string | null
  revision: number
  integrity: "ready" | "missing_bytes"
}

export type LocalAssetRecord = LocalAssetSummary & { blob: Blob }

export type LocalAssetIntegrityIssue = {
  assetId: string
  code:
    | "corrupt_metadata"
    | "missing_bytes"
    | "corrupt_bytes"
    | "metadata_mismatch"
    | "orphaned_bytes"
  message: string
}

export type LocalAssetInventory = {
  assets: LocalAssetSummary[]
  issues: LocalAssetIntegrityIssue[]
}

export type LocalAssetAdmissionState =
  | { status: "ready"; record: LocalAssetRecord }
  | {
      status: "missing_bytes"
      summary: LocalAssetSummary
      issue: LocalAssetIntegrityIssue
    }
  | { status: "absent" }
  | {
      status: "quarantined"
      issue: LocalAssetIntegrityIssue
      expectation: LocalAssetQuarantineExpectation
    }
  | { status: "unavailable"; code: string; message: string }

export type LocalAssetAdmissionInspectionOptions = {
  /** Injectable for deterministic repository tests. Production verifies in-browser bytes. */
  verifyBlob?: LocalAssetBlobVerifier
  verificationConcurrency?: number
}

export type LocalAssetBlobRestoreExpectation =
  | Readonly<{
      status: "missing_bytes"
      revision: number
      updatedAt: string
    }>
  | Readonly<{ status: "absent" }>
  | Readonly<{
      status: "quarantined"
      quarantine: LocalAssetQuarantineExpectation
    }>

export type LocalAssetQuarantineExpectation = Readonly<{
  records: readonly Readonly<{
    recordId: string
    detectedAt: string
    issueCode: LocalAssetIntegrityIssue["code"]
  }>[]
}>

export type LocalAssetBlobRestoreResult =
  | Readonly<{
      ok: true
      status: "restored"
      record: LocalAssetRecord
    }>
  | Readonly<{
      ok: false
      reason:
        | "identity_mismatch"
        | "state_changed"
        | "validation_failed"
        | "storage_unavailable"
      message: string
    }>

export const LOCAL_ASSET_ADMISSION_MAX_IDS = 5_000
const LOCAL_ASSET_QUARANTINE_EXPECTATION_MAX_RECORDS = 100

export type LocalAssetBlobVerifier = (
  blob: Blob
) => Promise<{ width: number; height: number } | null>

export type LocalAssetInventoryOptions = {
  includeArchived?: boolean
  /** Injectable for deterministic repository tests. Production verifies in-browser bytes. */
  verifyBlob?: LocalAssetBlobVerifier
  verificationConcurrency?: number
}

export type LocalAssetStorageSummary = {
  activeAssetBytes: number
  activeAssetCount: number
  archivedAssetBytes: number
  archivedAssetCount: number
  retainedAssetBytes: number
  retainedAssetCount: number
  browserUsageBytes: number | null
  browserQuotaBytes: number | null
  browserAvailableBytes: number | null
}

type LegacyLocalAssetRecord = {
  id?: unknown
  blob?: unknown
  name?: unknown
  mediaType?: unknown
  size?: unknown
  width?: unknown
  height?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  lastUsedAt?: unknown
  archivedAt?: unknown
  revision?: unknown
}

const isSupportedMediaType = (
  value: unknown
): value is (typeof MEDIA_ASSET_TYPES)[number] =>
  MEDIA_ASSET_TYPES.some((mediaType) => mediaType === value)

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value))

const optionalDimension = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null

const normalizeLegacyRecord = (value: unknown): LocalAssetRecord | null => {
  if (!value || typeof value !== "object") return null
  const record = value as LegacyLocalAssetRecord
  if (
    typeof record.id !== "string" ||
    !localAssetIdSchema.safeParse(record.id).success ||
    !(record.blob instanceof Blob) ||
    typeof record.name !== "string" ||
    !record.name ||
    !isSupportedMediaType(record.mediaType) ||
    record.mediaType !== record.blob.type ||
    record.blob.size < 1 ||
    record.blob.size > MEDIA_ASSET_MAX_BYTES ||
    (record.size !== undefined && record.size !== record.blob.size) ||
    !isValidTimestamp(record.createdAt)
  ) {
    return null
  }
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : record.createdAt
  return {
    schemaVersion: 4,
    id: record.id,
    blob: record.blob,
    name: record.name,
    mediaType: record.mediaType,
    size: record.blob.size,
    width: optionalDimension(record.width),
    height: optionalDimension(record.height),
    createdAt: record.createdAt,
    updatedAt,
    lastUsedAt:
      typeof record.lastUsedAt === "string" ? record.lastUsedAt : updatedAt,
    archivedAt:
      typeof record.archivedAt === "string" ? record.archivedAt : null,
    revision:
      typeof record.revision === "number" &&
      Number.isSafeInteger(record.revision) &&
      record.revision >= 1
        ? record.revision
        : 1,
    integrity: "ready",
  }
}

const parseSummary = (value: unknown): LocalAssetSummary | null => {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<LocalAssetSummary>
  if (
    typeof record.id !== "string" ||
    !localAssetIdSchema.safeParse(record.id).success ||
    typeof record.name !== "string" ||
    !record.name ||
    !isSupportedMediaType(record.mediaType) ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 1 ||
    record.size > MEDIA_ASSET_MAX_BYTES ||
    !isValidTimestamp(record.createdAt) ||
    !isValidTimestamp(record.updatedAt) ||
    !isValidTimestamp(record.lastUsedAt) ||
    (record.archivedAt !== null &&
      record.archivedAt !== undefined &&
      !isValidTimestamp(record.archivedAt)) ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1
  ) {
    return null
  }
  const width = optionalDimension(record.width)
  const height = optionalDimension(record.height)
  if (
    (width === null) !== (height === null) ||
    (width !== null &&
      height !== null &&
      (!Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width > MEDIA_ASSET_MAX_DIMENSION ||
        height > MEDIA_ASSET_MAX_DIMENSION ||
        width * height > MEDIA_ASSET_MAX_PIXEL_AREA))
  ) {
    return null
  }
  return {
    schemaVersion: 4,
    id: record.id,
    name: record.name,
    mediaType: record.mediaType,
    size: record.size,
    width,
    height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    archivedAt:
      typeof record.archivedAt === "string" ? record.archivedAt : null,
    revision: record.revision,
    integrity: "ready",
  }
}

const summaryForRecord = (record: LocalAssetRecord): LocalAssetSummary => {
  const { blob: _blob, ...summary } = record
  return summary
}

type StoredAssetInspection =
  | { status: "absent" }
  | { status: "ready"; summary: LocalAssetSummary; blob: Blob }
  | {
      status: "missing_bytes"
      summary: LocalAssetSummary
      issue: LocalAssetIntegrityIssue
    }
  | {
      status: "quarantine"
      issue: LocalAssetIntegrityIssue
      metadata: unknown
      blob: unknown
    }

type RequestedStoredAssetInspection = Readonly<{
  inspection: StoredAssetInspection
  quarantineOverflow: boolean
  quarantine: Readonly<{
    issue: LocalAssetIntegrityIssue
    expectation: LocalAssetQuarantineExpectation
  }> | null
}>

const inspectStoredAsset = (
  assetId: string,
  metadata: unknown,
  blob: unknown
): StoredAssetInspection => {
  if (metadata === undefined && blob === undefined) return { status: "absent" }
  if (metadata === undefined) {
    return {
      status: "quarantine",
      metadata,
      blob,
      issue: {
        assetId,
        code: "orphaned_bytes",
        message: "Stored image bytes have no matching metadata.",
      },
    }
  }
  const summary = parseSummary(metadata)
  if (!summary) {
    return {
      status: "quarantine",
      metadata,
      blob,
      issue: {
        assetId,
        code: "corrupt_metadata",
        message: "Saved image metadata could not be validated.",
      },
    }
  }
  if (blob === undefined) {
    return {
      status: "missing_bytes",
      summary: { ...summary, integrity: "missing_bytes" },
      issue: {
        assetId,
        code: "missing_bytes",
        message: "File missing on this device.",
      },
    }
  }
  if (!(blob instanceof Blob)) {
    return {
      status: "quarantine",
      metadata,
      blob,
      issue: {
        assetId,
        code: "corrupt_bytes",
        message: "Saved image bytes are not a readable Blob.",
      },
    }
  }
  if (summary.size !== blob.size || summary.mediaType !== blob.type) {
    return {
      status: "quarantine",
      metadata,
      blob,
      issue: {
        assetId,
        code: "metadata_mismatch",
        message: "Saved image size or media type does not match its bytes.",
      },
    }
  }
  return { status: "ready", summary, blob }
}

const dimensionsAreRendererSafe = (dimensions: {
  width: number
  height: number
}) =>
  Number.isSafeInteger(dimensions.width) &&
  Number.isSafeInteger(dimensions.height) &&
  dimensions.width > 0 &&
  dimensions.height > 0 &&
  dimensions.width <= MEDIA_ASSET_MAX_DIMENSION &&
  dimensions.height <= MEDIA_ASSET_MAX_DIMENSION &&
  dimensions.width * dimensions.height <= MEDIA_ASSET_MAX_PIXEL_AREA

const verifyStoredBlobInBrowser: LocalAssetBlobVerifier = async (blob) => {
  if (typeof window === "undefined" || typeof Image === "undefined") {
    return null
  }
  return getImageDimensions(blob)
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<TResult>
) {
  const results = new Array<TResult>(values.length)
  let nextIndex = 0
  const workerCount = Number.isSafeInteger(concurrency)
    ? Math.min(Math.max(1, concurrency), values.length)
    : 1
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function mapWithConcurrencyAndAcknowledgement<T, TResult>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<TResult>
) {
  const results = new Array<TResult>(values.length)
  let nextIndex = 0
  const workerCount = Number.isSafeInteger(concurrency)
    ? Math.min(Math.max(1, concurrency), values.length)
    : 1
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  })
  const settlements = await Promise.allSettled(workers)
  const failure = settlements.find(
    (settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected"
  )
  if (failure) throw failure.reason
  return results
}

const openDatabase = openLocalAssetDatabase

const runTransaction = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let result: T
    const closeWithError = (error: Error) => {
      if (settled) return
      settled = true
      database.close()
      reject(error)
    }
    try {
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () =>
        closeWithError(request.error ?? new Error("Asset operation failed"))
      transaction.oncomplete = () => {
        if (settled) return
        settled = true
        database.close()
        resolve(result)
      }
      transaction.onerror = () =>
        closeWithError(
          transaction.error ?? new Error("Asset transaction failed")
        )
      transaction.onabort = () =>
        closeWithError(
          transaction.error ?? new Error("Asset transaction was aborted")
        )
    } catch (error) {
      closeWithError(
        error instanceof Error ? error : new Error("Asset transaction failed")
      )
    }
  })
}

const runAssetWrite = async (
  operation: (metadataStore: IDBObjectStore, blobStore: IDBObjectStore) => void
) => {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const closeWithError = (error: Error) => {
      if (settled) return
      settled = true
      database.close()
      reject(error)
    }
    try {
      const transaction = database.transaction(
        [METADATA_STORE_NAME, BLOB_STORE_NAME],
        "readwrite"
      )
      operation(
        transaction.objectStore(METADATA_STORE_NAME),
        transaction.objectStore(BLOB_STORE_NAME)
      )
      transaction.oncomplete = () => {
        if (settled) return
        settled = true
        database.close()
        resolve()
      }
      transaction.onerror = () =>
        closeWithError(
          transaction.error ?? new Error("Asset transaction failed")
        )
      transaction.onabort = () =>
        closeWithError(
          transaction.error ?? new Error("Asset transaction was aborted")
        )
    } catch (error) {
      closeWithError(
        error instanceof Error ? error : new Error("Asset transaction failed")
      )
    }
  })
}

const migrateLegacyBatch = async (limit = 4) => {
  const database = await openDatabase()
  if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    database.close()
    return false
  }
  return new Promise<boolean>((resolve, reject) => {
    let processed = 0
    let hasMore = false
    const transaction = database.transaction(
      [
        LEGACY_STORE_NAME,
        METADATA_STORE_NAME,
        BLOB_STORE_NAME,
        QUARANTINE_STORE_NAME,
      ],
      "readwrite"
    )
    const legacyStore = transaction.objectStore(LEGACY_STORE_NAME)
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
    const cursorRequest = legacyStore.openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      if (processed >= limit) {
        hasMore = true
        return
      }
      const record = normalizeLegacyRecord(cursor.value)
      if (!record) {
        quarantineStore.put({
          id: `legacy-${String(cursor.primaryKey)}`,
          legacyKey: String(cursor.primaryKey),
          reason: "Legacy asset metadata could not be validated",
          detectedAt: new Date().toISOString(),
          record: cursor.value,
        })
        cursor.delete()
        processed += 1
        cursor.continue()
        return
      }

      const metadataRequest = metadataStore.get(record.id)
      const blobRequest = blobStore.get(record.id)
      let metadataValue: unknown
      let blobValue: unknown
      let completedRequests = 0
      const reconcile = () => {
        completedRequests += 1
        if (completedRequests < 2) return
        const currentSummary = parseSummary(metadataValue)
        const currentBlob = blobValue instanceof Blob ? blobValue : null
        const currentPairIsValid = Boolean(
          currentSummary &&
          currentBlob &&
          currentSummary.size === currentBlob.size &&
          currentSummary.mediaType === currentBlob.type
        )
        if (!currentSummary && !currentBlob && metadataValue === undefined) {
          metadataStore.put(summaryForRecord(record))
          blobStore.put(record.blob, record.id)
        } else if (!currentPairIsValid) {
          quarantineStore.put({
            id: `legacy-conflict-${record.id}`,
            legacyKey: String(cursor.primaryKey),
            reason:
              "Legacy asset conflicts with incomplete current asset storage",
            detectedAt: new Date().toISOString(),
            record: cursor.value,
            currentMetadata: metadataValue,
            currentBlob: blobValue,
          })
          metadataStore.delete(record.id)
          blobStore.delete(record.id)
        }
        // Complete split-store records are newer and authoritative. Never
        // overwrite them with the retained v1 row from the prior migration.
        cursor.delete()
        processed += 1
        cursor.continue()
      }
      metadataRequest.onsuccess = () => {
        metadataValue = metadataRequest.result
        reconcile()
      }
      blobRequest.onsuccess = () => {
        blobValue = blobRequest.result
        reconcile()
      }
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(hasMore)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset migration failed"))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset migration was aborted"))
    }
  })
}

async function migrateLegacyAssets() {
  let hasMore = true
  while (hasMore) hasMore = await migrateLegacyBatch()
}

let activeLegacyMigration: Promise<void> | null = null

const ensureLegacyMigration = () => {
  if (activeLegacyMigration) return activeLegacyMigration
  const migration = migrateLegacyAssets().finally(() => {
    if (activeLegacyMigration === migration) activeLegacyMigration = null
  })
  activeLegacyMigration = migration
  return migration
}

const migrateRequestedLegacyAssets = async (
  assetIds: readonly string[],
  signal?: AbortSignal
) => {
  if (activeLegacyMigration) {
    await waitForLocalAssetOperation(activeLegacyMigration, signal)
    return
  }
  signal?.throwIfAborted()
  const database = await openDatabaseForAbortableOperation(signal)
  if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    database.close()
    return
  }
  if (signal?.aborted) {
    database.close()
    signal.throwIfAborted()
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [
        LEGACY_STORE_NAME,
        METADATA_STORE_NAME,
        BLOB_STORE_NAME,
        QUARANTINE_STORE_NAME,
      ],
      "readwrite"
    )
    const legacyStore = transaction.objectStore(LEGACY_STORE_NAME)
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
    for (const assetId of assetIds) {
      const legacyRequest = legacyStore.get(assetId)
      const metadataRequest = metadataStore.get(assetId)
      const blobRequest = blobStore.get(assetId)
      let completedRequests = 0
      const reconcile = () => {
        completedRequests += 1
        if (completedRequests < 3 || legacyRequest.result === undefined) return
        const legacyRecord = normalizeLegacyRecord(legacyRequest.result)
        if (!legacyRecord) {
          quarantineStore.put({
            id: `legacy-${assetId}`,
            assetId,
            code: "corrupt_metadata",
            legacyKey: assetId,
            reason: "Legacy asset metadata could not be validated",
            detectedAt: new Date().toISOString(),
            record: legacyRequest.result,
          })
          legacyStore.delete(assetId)
          return
        }
        const current = inspectStoredAsset(
          assetId,
          metadataRequest.result,
          blobRequest.result
        )
        if (current.status === "absent") {
          metadataStore.put(summaryForRecord(legacyRecord))
          blobStore.put(legacyRecord.blob, legacyRecord.id)
        } else if (current.status !== "ready") {
          quarantineStore.put({
            id: `legacy-conflict-${assetId}`,
            assetId,
            code: "metadata_mismatch",
            legacyKey: assetId,
            reason:
              "Legacy asset conflicts with incomplete current asset storage",
            detectedAt: new Date().toISOString(),
            record: legacyRequest.result,
            currentMetadata: metadataRequest.result,
            currentBlob: blobRequest.result,
          })
          metadataStore.delete(assetId)
          blobStore.delete(assetId)
        }
        legacyStore.delete(assetId)
      }
      legacyRequest.onsuccess = reconcile
      metadataRequest.onsuccess = reconcile
      blobRequest.onsuccess = reconcile
    }
    const cleanUp = () => signal?.removeEventListener("abort", abort)
    const abort = () => {
      try {
        transaction.abort()
      } catch {
        // Completion won the race; its handler preserves the abort reason.
      }
    }
    transaction.oncomplete = () => {
      cleanUp()
      database.close()
      if (signal?.aborted) reject(signal.reason)
      else resolve()
    }
    transaction.onerror = () => {
      // The abort event is the rollback acknowledgement. Do not release the
      // foreground owner while IndexedDB is still unwinding the transaction.
    }
    transaction.onabort = () => {
      cleanUp()
      database.close()
      reject(
        signal?.aborted
          ? signal.reason
          : (transaction.error ??
              new Error("Requested asset migration was aborted"))
      )
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const waitForLocalAssetOperation = <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  disposeLateResult?: (value: T) => void
) => {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    let aborted = false
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      aborted = true
    }
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(
      (value) => {
        cleanUp()
        if (aborted || signal.aborted) {
          disposeLateResult?.(value)
          reject(signal.reason)
        } else resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        reject(aborted || signal.aborted ? signal.reason : error)
      }
    )
  })
}

let abortableDatabaseOpenTail: Promise<void> = Promise.resolve()

const openDatabaseForAbortableOperation = async (signal?: AbortSignal) => {
  if (!signal) return openDatabase()
  signal.throwIfAborted()

  const predecessor = abortableDatabaseOpenTail
  let releaseReservation: () => void = () => {}
  const reservation = new Promise<void>((resolve) => {
    releaseReservation = resolve
  })
  abortableDatabaseOpenTail = predecessor.then(() => reservation)

  try {
    await waitForLocalAssetOperation(predecessor, signal)
    signal.throwIfAborted()
  } catch (error) {
    releaseReservation()
    throw error
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {}
    signal.addEventListener("abort", abort, { once: true })
    void openDatabase().then(
      (database) => {
        cleanUp()
        if (signal.aborted) {
          database.close()
          releaseReservation()
          reject(signal.reason)
          return
        }
        releaseReservation()
        resolve(database)
      },
      (error: unknown) => {
        cleanUp()
        releaseReservation()
        reject(signal.aborted ? signal.reason : error)
      }
    )
  })
}

export const localAssetSource = canonicalLocalAssetSource

export const localAssetIdFromSource = canonicalLocalAssetIdFromSource

export async function saveLocalAsset(
  file: File,
  assetId: string,
  metadata?: { width?: number; height?: number; now?: string }
) {
  await ensureLegacyMigration()
  const validAssetId = localAssetIdSchema.parse(assetId)
  const now = metadata?.now ?? new Date().toISOString()
  const record: LocalAssetRecord = {
    schemaVersion: 4,
    id: validAssetId,
    blob: file,
    name: file.name,
    mediaType: file.type,
    size: file.size,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    archivedAt: null,
    revision: 1,
    integrity: "ready",
  }
  await runAssetWrite((metadataStore, blobStore) => {
    metadataStore.put(summaryForRecord(record))
    blobStore.put(record.blob, record.id)
  })
}

const quarantineStoredAsset = async (assetId: string, signal?: AbortSignal) => {
  signal?.throwIfAborted()
  const database = await openDatabaseForAbortableOperation(signal)
  if (signal?.aborted) {
    database.close()
    signal.throwIfAborted()
  }
  return new Promise<LocalAssetIntegrityIssue | null>((resolve, reject) => {
    let result: LocalAssetIntegrityIssue | null = null
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME, QUARANTINE_STORE_NAME],
      "readwrite"
    )
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
    const metadataRequest = metadataStore.get(assetId)
    const blobRequest = blobStore.get(assetId)
    const cleanUp = () => signal?.removeEventListener("abort", abort)
    const abort = () => {
      try {
        transaction.abort()
      } catch {
        // Completion won the race; its handler preserves the abort reason.
      }
    }
    let metadata: unknown
    let blob: unknown
    let completedRequests = 0
    const reconcile = () => {
      completedRequests += 1
      if (completedRequests < 2) return
      const inspection = inspectStoredAsset(assetId, metadata, blob)
      if (inspection.status !== "quarantine") return
      result = inspection.issue
      quarantineStore.put({
        id: `current-${assetId}-${crypto.randomUUID()}`,
        assetId,
        reason: inspection.issue.message,
        code: inspection.issue.code,
        detectedAt: new Date().toISOString(),
        metadata: inspection.metadata,
        blob: inspection.blob,
      })
      metadataStore.delete(assetId)
      blobStore.delete(assetId)
    }
    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result
      reconcile()
    }
    blobRequest.onsuccess = () => {
      blob = blobRequest.result
      reconcile()
    }
    transaction.oncomplete = () => {
      cleanUp()
      database.close()
      if (signal?.aborted) reject(signal.reason)
      else resolve(result)
    }
    transaction.onerror = () => {
      // The abort event is the rollback acknowledgement. Do not release the
      // foreground owner while IndexedDB is still unwinding the transaction.
    }
    transaction.onabort = () => {
      cleanUp()
      database.close()
      reject(
        signal?.aborted
          ? signal.reason
          : (transaction.error ?? new Error("Asset quarantine was aborted"))
      )
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const quarantineUnreadableStoredAsset = async (
  expected: LocalAssetSummary,
  issue: LocalAssetIntegrityIssue
) => {
  const database = await openDatabase()
  return new Promise<boolean>((resolve, reject) => {
    let quarantined = false
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME, QUARANTINE_STORE_NAME],
      "readwrite"
    )
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
    const metadataRequest = metadataStore.get(expected.id)
    const blobRequest = blobStore.get(expected.id)
    let metadata: unknown
    let blob: unknown
    let completedRequests = 0
    const reconcile = () => {
      completedRequests += 1
      if (completedRequests < 2) return
      const inspection = inspectStoredAsset(expected.id, metadata, blob)
      if (
        inspection.status !== "ready" ||
        inspection.summary.revision !== expected.revision ||
        inspection.summary.updatedAt !== expected.updatedAt
      ) {
        return
      }
      quarantined = true
      quarantineStore.put({
        id: `current-${expected.id}-${crypto.randomUUID()}`,
        assetId: expected.id,
        reason: issue.message,
        code: issue.code,
        detectedAt: new Date().toISOString(),
        metadata,
        blob,
      })
      metadataStore.delete(expected.id)
      blobStore.delete(expected.id)
    }
    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result
      reconcile()
    }
    blobRequest.onsuccess = () => {
      blob = blobRequest.result
      reconcile()
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(quarantined)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset quarantine failed"))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset quarantine was aborted"))
    }
  })
}

const reconcileStoredAssetDimensions = async (
  expected: LocalAssetSummary,
  dimensions: { width: number; height: number }
) => {
  if (
    expected.width === dimensions.width &&
    expected.height === dimensions.height
  ) {
    return expected
  }
  const database = await openDatabase()
  return new Promise<LocalAssetSummary | null>((resolve, reject) => {
    let result: LocalAssetSummary | null = null
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME],
      "readwrite"
    )
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const metadataRequest = metadataStore.get(expected.id)
    const blobRequest = transaction
      .objectStore(BLOB_STORE_NAME)
      .get(expected.id)
    let metadata: unknown
    let blob: unknown
    let completedRequests = 0
    const reconcile = () => {
      completedRequests += 1
      if (completedRequests < 2) return
      const inspection = inspectStoredAsset(expected.id, metadata, blob)
      if (
        inspection.status !== "ready" ||
        inspection.summary.revision !== expected.revision ||
        inspection.summary.updatedAt !== expected.updatedAt
      ) {
        return
      }
      result = {
        ...inspection.summary,
        width: dimensions.width,
        height: dimensions.height,
        updatedAt: new Date().toISOString(),
        revision: inspection.summary.revision + 1,
      }
      metadataStore.put(result)
    }
    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result
      reconcile()
    }
    blobRequest.onsuccess = () => {
      blob = blobRequest.result
      reconcile()
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onerror = () => {
      database.close()
      reject(
        transaction.error ?? new Error("Asset dimension reconciliation failed")
      )
    }
    transaction.onabort = () => {
      database.close()
      reject(
        transaction.error ?? new Error("Asset dimension reconciliation aborted")
      )
    }
  })
}

const readStoredAsset = async (assetId: string, signal?: AbortSignal) => {
  signal?.throwIfAborted()
  const database = await openDatabaseForAbortableOperation(signal)
  if (signal?.aborted) {
    database.close()
    signal.throwIfAborted()
  }
  return new Promise<StoredAssetInspection>((resolve, reject) => {
    let metadata: unknown
    let blob: unknown
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME],
      "readonly"
    )
    const metadataRequest = transaction
      .objectStore(METADATA_STORE_NAME)
      .get(assetId)
    const blobRequest = transaction.objectStore(BLOB_STORE_NAME).get(assetId)
    const cleanUp = () => signal?.removeEventListener("abort", abort)
    const abort = () => {
      try {
        transaction.abort()
      } catch {
        // Completion won the race; its handler preserves the abort reason.
      }
    }
    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result
    }
    blobRequest.onsuccess = () => {
      blob = blobRequest.result
    }
    transaction.oncomplete = () => {
      cleanUp()
      database.close()
      if (signal?.aborted) reject(signal.reason)
      else resolve(inspectStoredAsset(assetId, metadata, blob))
    }
    transaction.onerror = () => {
      // The abort event is the rollback acknowledgement. Do not release the
      // foreground owner while IndexedDB is still unwinding the transaction.
    }
    transaction.onabort = () => {
      cleanUp()
      database.close()
      reject(
        signal?.aborted
          ? signal.reason
          : (transaction.error ?? new Error("Asset transaction was aborted"))
      )
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const quarantineIssueFromRecord = (
  assetId: string,
  value: unknown
): LocalAssetIntegrityIssue | null => {
  if (!value || typeof value !== "object") return null
  const record = value as {
    assetId?: unknown
    code?: unknown
    reason?: unknown
  }
  const code = record.code
  if (
    record.assetId !== assetId ||
    ![
      "corrupt_metadata",
      "missing_bytes",
      "corrupt_bytes",
      "metadata_mismatch",
      "orphaned_bytes",
    ].includes(typeof code === "string" ? code : "")
  ) {
    return null
  }
  return {
    assetId,
    code: code as LocalAssetIntegrityIssue["code"],
    message:
      typeof record.reason === "string" && record.reason.length > 0
        ? record.reason.slice(0, 512)
        : "Saved image data was quarantined on this device.",
  }
}

const quarantineExpectationRecordFrom = (
  value: unknown,
  fallback: Readonly<{
    recordId: string
    issueCode: LocalAssetIntegrityIssue["code"]
  }>
) => {
  if (!value || typeof value !== "object") return null
  const record = value as {
    id?: unknown
    detectedAt?: unknown
    code?: unknown
  }
  const recordId = typeof record.id === "string" ? record.id : fallback.recordId
  const detectedAt =
    typeof record.detectedAt === "string" && isValidTimestamp(record.detectedAt)
      ? record.detectedAt
      : null
  const issueCode =
    typeof record.code === "string" &&
    [
      "corrupt_metadata",
      "missing_bytes",
      "corrupt_bytes",
      "metadata_mismatch",
      "orphaned_bytes",
    ].includes(record.code)
      ? (record.code as LocalAssetIntegrityIssue["code"])
      : fallback.issueCode
  if (!recordId || !detectedAt) return null
  return { recordId, detectedAt, issueCode }
}

const sameQuarantineExpectation = (
  left: LocalAssetQuarantineExpectation,
  right: LocalAssetQuarantineExpectation
) =>
  left.records.length === right.records.length &&
  left.records.every((record, index) => {
    const other = right.records[index]
    return (
      other.recordId === record.recordId &&
      other.detectedAt === record.detectedAt &&
      other.issueCode === record.issueCode
    )
  })

const readRequestedStoredAssets = async (
  assetIds: readonly string[],
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const database = await openDatabaseForAbortableOperation(signal)
  if (signal?.aborted) {
    database.close()
    signal.throwIfAborted()
  }
  return new Promise<RequestedStoredAssetInspection[]>((resolve, reject) => {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME, QUARANTINE_STORE_NAME],
      "readonly"
    )
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
    const reads = assetIds.map((assetId) => {
      const metadata = metadataStore.get(assetId)
      const blob = blobStore.get(assetId)
      const currentQuarantine = quarantineStore.getAll(
        IDBKeyRange.bound(`current-${assetId}-`, `current-${assetId}-\uffff`),
        LOCAL_ASSET_QUARANTINE_EXPECTATION_MAX_RECORDS + 1
      )
      const legacyConflict = quarantineStore.get(`legacy-conflict-${assetId}`)
      const legacyQuarantine = quarantineStore.get(`legacy-${assetId}`)
      return {
        assetId,
        metadata,
        blob,
        currentQuarantine,
        legacyConflict,
        legacyQuarantine,
      }
    })
    const cleanUp = () => signal?.removeEventListener("abort", abort)
    const abort = () => {
      try {
        transaction.abort()
      } catch {
        // Completion won the race; its handler preserves the abort reason.
      }
    }
    transaction.oncomplete = () => {
      cleanUp()
      database.close()
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      resolve(
        reads.map((read) => {
          const currentRecords = read.currentQuarantine.result
          const quarantineOverflow =
            currentRecords.length >
            LOCAL_ASSET_QUARANTINE_EXPECTATION_MAX_RECORDS
          const currentIssue = currentRecords
            .map((record) => quarantineIssueFromRecord(read.assetId, record))
            .find((issue): issue is LocalAssetIntegrityIssue => issue !== null)
          const legacyIssue = read.legacyConflict.result
            ? {
                assetId: read.assetId,
                code: "metadata_mismatch" as const,
                message:
                  "A conflicting saved image record was quarantined on this device.",
              }
            : null
          const corruptLegacyIssue = read.legacyQuarantine.result
            ? (quarantineIssueFromRecord(
                read.assetId,
                read.legacyQuarantine.result
              ) ?? {
                assetId: read.assetId,
                code: "corrupt_metadata" as const,
                message: "Saved image metadata was quarantined on this device.",
              })
            : null
          const issue = currentIssue ?? legacyIssue ?? corruptLegacyIssue
          const expectationRecords = [
            ...currentRecords.map((record) =>
              quarantineExpectationRecordFrom(record, {
                recordId: "",
                issueCode: "corrupt_metadata",
              })
            ),
            read.legacyConflict.result
              ? quarantineExpectationRecordFrom(read.legacyConflict.result, {
                  recordId: `legacy-conflict-${read.assetId}`,
                  issueCode: "metadata_mismatch",
                })
              : null,
            read.legacyQuarantine.result
              ? quarantineExpectationRecordFrom(read.legacyQuarantine.result, {
                  recordId: `legacy-${read.assetId}`,
                  issueCode: "corrupt_metadata",
                })
              : null,
          ]
            .filter(
              (
                record
              ): record is LocalAssetQuarantineExpectation["records"][number] =>
                record !== null
            )
            .sort((left, right) => left.recordId.localeCompare(right.recordId))
          return {
            inspection: inspectStoredAsset(
              read.assetId,
              read.metadata.result,
              read.blob.result
            ),
            quarantineOverflow,
            quarantine:
              !quarantineOverflow && issue && expectationRecords.length > 0
                ? {
                    issue,
                    expectation: { records: expectationRecords },
                  }
                : null,
          }
        })
      )
    }
    transaction.onerror = () => {
      // The abort event is the rollback acknowledgement. Do not release the
      // foreground owner while IndexedDB is still unwinding the transaction.
    }
    transaction.onabort = () => {
      cleanUp()
      database.close()
      reject(
        signal?.aborted
          ? signal.reason
          : (transaction.error ?? new Error("Asset inspection was aborted"))
      )
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const unavailableAdmissionStates = (
  assetIds: readonly string[]
): LocalAssetAdmissionState[] =>
  assetIds.map(() => ({
    status: "unavailable",
    code: "local_media_local_repository_unavailable",
    message: "Studio could not inspect saved images on this device.",
  }))

export async function inspectRequestedLocalAssets(
  assetIdsInput: readonly string[],
  options: LocalAssetAdmissionInspectionOptions & { signal?: AbortSignal } = {}
): Promise<LocalAssetAdmissionState[]> {
  if (
    assetIdsInput.length < 1 ||
    assetIdsInput.length > LOCAL_ASSET_ADMISSION_MAX_IDS
  ) {
    throw new RangeError(
      `Local asset inspection requires 1-${LOCAL_ASSET_ADMISSION_MAX_IDS} IDs.`
    )
  }
  const assetIds = assetIdsInput.map((assetId) =>
    localAssetIdSchema.parse(assetId)
  )
  if (new Set(assetIds).size !== assetIds.length) {
    throw new TypeError("Local asset inspection IDs must be distinct.")
  }

  const signal = options.signal
  signal?.throwIfAborted()
  try {
    await waitForLocalAssetOperation(abortableDatabaseOpenTail, signal)
    signal?.throwIfAborted()
    await migrateRequestedLegacyAssets(assetIds, signal)
    signal?.throwIfAborted()
    const inspections = await readRequestedStoredAssets(assetIds, signal)
    const verifyBlob = options.verifyBlob ?? verifyStoredBlobInBrowser
    return await mapWithConcurrencyAndAcknowledgement(
      inspections,
      options.verificationConcurrency ?? 2,
      async ({ inspection, quarantine, quarantineOverflow }) => {
        signal?.throwIfAborted()
        if (quarantineOverflow) {
          return {
            status: "unavailable" as const,
            code: "local_media_quarantine_limit_exceeded",
            message:
              "Studio retained too many recovery records for this image. Review local storage before restoring it.",
          }
        }
        if (inspection.status === "absent") {
          return quarantine
            ? {
                status: "quarantined" as const,
                issue: quarantine.issue,
                expectation: quarantine.expectation,
              }
            : { status: "absent" as const }
        }
        if (inspection.status === "missing_bytes") {
          return {
            status: "missing_bytes" as const,
            summary: inspection.summary,
            issue: inspection.issue,
          }
        }
        if (inspection.status === "quarantine") {
          const issue = await quarantineStoredAsset(
            inspection.issue.assetId,
            signal
          )
          signal?.throwIfAborted()
          if (!issue) {
            return {
              status: "unavailable" as const,
              code: "local_media_local_repository_changed",
              message:
                "The saved image changed while Studio was checking it. Retry the check.",
            }
          }
          const [reinspected] = await readRequestedStoredAssets(
            [inspection.issue.assetId],
            signal
          )
          return reinspected.quarantine
            ? {
                status: "quarantined" as const,
                issue: reinspected.quarantine.issue,
                expectation: reinspected.quarantine.expectation,
              }
            : {
                status: "unavailable" as const,
                code: "local_media_local_repository_changed",
                message:
                  "The saved image changed while Studio was checking it. Retry the check.",
              }
        }

        try {
          const dimensions = await waitForLocalAssetOperation(
            verifyBlob(inspection.blob),
            signal
          )
          signal?.throwIfAborted()
          if (dimensions !== null && !dimensionsAreRendererSafe(dimensions)) {
            throw new Error("Saved image dimensions are outside Studio limits.")
          }
          return {
            status: "ready" as const,
            record: { ...inspection.summary, blob: inspection.blob },
          }
        } catch {
          signal?.throwIfAborted()
          const issue: LocalAssetIntegrityIssue = {
            assetId: inspection.summary.id,
            code: "corrupt_bytes",
            message: "Saved image bytes could not be decoded.",
          }
          const quarantined = await waitForLocalAssetOperation(
            quarantineUnreadableStoredAsset(inspection.summary, issue),
            signal
          )
          signal?.throwIfAborted()
          if (!quarantined) {
            return {
              status: "unavailable" as const,
              code: "local_media_local_repository_changed",
              message:
                "The saved image changed while Studio was checking it. Retry the check.",
            }
          }
          const [reinspected] = await readRequestedStoredAssets(
            [inspection.summary.id],
            signal
          )
          return reinspected.quarantine
            ? {
                status: "quarantined" as const,
                issue: reinspected.quarantine.issue,
                expectation: reinspected.quarantine.expectation,
              }
            : {
                status: "unavailable" as const,
                code: "local_media_local_repository_changed",
                message:
                  "The saved image changed while Studio was checking it. Retry the check.",
              }
        }
      }
    )
  } catch (error) {
    signal?.throwIfAborted()
    return unavailableAdmissionStates(assetIds)
  }
}

export async function restoreLocalAssetBlob(
  input: Readonly<{
    assetId: string
    file: File
    expected: LocalAssetBlobRestoreExpectation
    expectedContentSha256: string
    contentSha256: string
    width: number
    height: number
    now?: string
  }>,
  signal?: AbortSignal
): Promise<LocalAssetBlobRestoreResult> {
  const now = input.now ?? new Date().toISOString()
  let assetId: string
  try {
    assetId = localAssetIdSchema.parse(input.assetId)
  } catch {
    return {
      ok: false,
      reason: "validation_failed",
      message: "A valid local image identity is required.",
    }
  }
  if (
    !/^[0-9a-f]{64}$/.test(input.expectedContentSha256) ||
    !/^[0-9a-f]{64}$/.test(input.contentSha256) ||
    !isSupportedMediaType(input.file.type) ||
    input.file.size < 1 ||
    input.file.size > MEDIA_ASSET_MAX_BYTES ||
    !dimensionsAreRendererSafe({ width: input.width, height: input.height }) ||
    !isValidTimestamp(now)
  ) {
    return {
      ok: false,
      reason: "validation_failed",
      message: "The selected image does not meet Studio's media limits.",
    }
  }
  if (input.contentSha256 !== input.expectedContentSha256) {
    return {
      ok: false,
      reason: "identity_mismatch",
      message: "The selected file is different from the saved image copy.",
    }
  }

  signal?.throwIfAborted()
  try {
    await waitForLocalAssetOperation(abortableDatabaseOpenTail, signal)
    await migrateRequestedLegacyAssets([assetId], signal)
    const database = await openDatabaseForAbortableOperation(signal)
    if (signal?.aborted) {
      database.close()
      signal.throwIfAborted()
    }
    return await new Promise<LocalAssetBlobRestoreResult>((resolve, reject) => {
      let result: LocalAssetBlobRestoreResult = {
        ok: false,
        reason: "state_changed",
        message: "The local image changed in another Studio tab. Retry.",
      }
      const transaction = database.transaction(
        [METADATA_STORE_NAME, BLOB_STORE_NAME, QUARANTINE_STORE_NAME],
        "readwrite"
      )
      const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
      const blobStore = transaction.objectStore(BLOB_STORE_NAME)
      const quarantineStore = transaction.objectStore(QUARANTINE_STORE_NAME)
      const metadataRequest = metadataStore.get(assetId)
      const blobRequest = blobStore.get(assetId)
      const currentQuarantineRequest = quarantineStore.getAll(
        IDBKeyRange.bound(`current-${assetId}-`, `current-${assetId}-\uffff`),
        LOCAL_ASSET_QUARANTINE_EXPECTATION_MAX_RECORDS + 1
      )
      const legacyConflictRequest = quarantineStore.get(
        `legacy-conflict-${assetId}`
      )
      const legacyQuarantineRequest = quarantineStore.get(`legacy-${assetId}`)
      let completed = 0
      const reconcile = () => {
        completed += 1
        if (completed !== 5) return
        const inspection = inspectStoredAsset(
          assetId,
          metadataRequest.result,
          blobRequest.result
        )
        const quarantineIssue = [
          ...currentQuarantineRequest.result,
          legacyConflictRequest.result,
          legacyQuarantineRequest.result,
        ]
          .filter((value) => value !== undefined)
          .map((value) => quarantineIssueFromRecord(assetId, value))
          .find((issue): issue is LocalAssetIntegrityIssue => issue !== null)
        const quarantineExpectation: LocalAssetQuarantineExpectation = {
          records: [
            ...currentQuarantineRequest.result.map((record) =>
              quarantineExpectationRecordFrom(record, {
                recordId: "",
                issueCode: "corrupt_metadata",
              })
            ),
            legacyConflictRequest.result
              ? quarantineExpectationRecordFrom(
                  legacyConflictRequest.result,
                  {
                    recordId: `legacy-conflict-${assetId}`,
                    issueCode: "metadata_mismatch",
                  }
                )
              : null,
            legacyQuarantineRequest.result
              ? quarantineExpectationRecordFrom(
                  legacyQuarantineRequest.result,
                  {
                    recordId: `legacy-${assetId}`,
                    issueCode: "corrupt_metadata",
                  }
                )
              : null,
          ]
            .filter(
              (
                record
              ): record is LocalAssetQuarantineExpectation["records"][number] =>
                record !== null
            )
            .sort((left, right) => left.recordId.localeCompare(right.recordId)),
        }
        const matchesExpected =
          (input.expected.status === "missing_bytes" &&
            inspection.status === "missing_bytes" &&
            inspection.summary.revision === input.expected.revision &&
            inspection.summary.updatedAt === input.expected.updatedAt) ||
          (input.expected.status === "absent" &&
            inspection.status === "absent" &&
            quarantineIssue === undefined) ||
          (input.expected.status === "quarantined" &&
            inspection.status === "absent" &&
            currentQuarantineRequest.result.length <=
              LOCAL_ASSET_QUARANTINE_EXPECTATION_MAX_RECORDS &&
            quarantineIssue !== undefined &&
            sameQuarantineExpectation(
              quarantineExpectation,
              input.expected.quarantine
            ))
        if (!matchesExpected) return

        const previousSummary =
          inspection.status === "missing_bytes" ? inspection.summary : null
        const summary: LocalAssetSummary = {
          schemaVersion: 4,
          id: assetId,
          name: previousSummary?.name ?? input.file.name,
          mediaType: input.file.type,
          size: input.file.size,
          width: input.width,
          height: input.height,
          createdAt: previousSummary?.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: now,
          archivedAt: previousSummary?.archivedAt ?? null,
          revision: (previousSummary?.revision ?? 0) + 1,
          integrity: "ready",
        }
        metadataStore.put(summary)
        blobStore.put(input.file, assetId)
        result = {
          ok: true,
          status: "restored",
          record: { ...summary, blob: input.file },
        }
      }
      metadataRequest.onsuccess = reconcile
      blobRequest.onsuccess = reconcile
      currentQuarantineRequest.onsuccess = reconcile
      legacyConflictRequest.onsuccess = reconcile
      legacyQuarantineRequest.onsuccess = reconcile
      const cleanUp = () => signal?.removeEventListener("abort", abort)
      const abort = () => {
        try {
          transaction.abort()
        } catch {
          // Commit already acknowledged completion.
        }
      }
      transaction.oncomplete = () => {
        cleanUp()
        database.close()
        if (signal?.aborted) reject(signal.reason)
        else resolve(result)
      }
      transaction.onerror = () => {
        // Abort is the acknowledgement boundary.
      }
      transaction.onabort = () => {
        cleanUp()
        database.close()
        reject(
          signal?.aborted
            ? signal.reason
            : (transaction.error ?? new Error("Local image restore aborted"))
        )
      }
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    })
  } catch (error) {
    signal?.throwIfAborted()
    return {
      ok: false,
      reason: "storage_unavailable",
      message:
        error instanceof Error
          ? error.message
          : "Studio could not restore the selected image on this device.",
    }
  }
}

export async function getLocalAssetRecord(
  assetId: string,
  signal?: AbortSignal
) {
  await waitForLocalAssetOperation(abortableDatabaseOpenTail, signal)
  signal?.throwIfAborted()
  await waitForLocalAssetOperation(ensureLegacyMigration(), signal)
  signal?.throwIfAborted()
  const inspection = await readStoredAsset(assetId, signal)
  if (inspection.status === "ready") {
    return { ...inspection.summary, blob: inspection.blob }
  }
  if (inspection.status === "quarantine") {
    signal?.throwIfAborted()
    await quarantineStoredAsset(assetId, signal)
    signal?.throwIfAborted()
  }
  return null
}

export async function loadLocalAsset(assetId: string, signal?: AbortSignal) {
  return (await getLocalAssetRecord(assetId, signal))?.blob ?? null
}

export async function hasLocalAssetBlob(assetId: string) {
  await ensureLegacyMigration()
  const value = await runTransaction<unknown>(
    BLOB_STORE_NAME,
    "readonly",
    (store) => store.get(assetId)
  )
  return value instanceof Blob
}

export async function listLocalAssetInventory({
  includeArchived = false,
  verifyBlob = verifyStoredBlobInBrowser,
  verificationConcurrency = 4,
}: LocalAssetInventoryOptions = {}): Promise<LocalAssetInventory> {
  await ensureLegacyMigration()
  const database = await openDatabase()
  const pairs = await new Promise<
    Array<{ assetId: string; metadata: unknown; blob: unknown }>
  >((resolve, reject) => {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME],
      "readonly"
    )
    const metadataStore = transaction.objectStore(METADATA_STORE_NAME)
    const blobStore = transaction.objectStore(BLOB_STORE_NAME)
    const metadataKeysRequest = metadataStore.getAllKeys()
    const metadataRequest = metadataStore.getAll()
    const blobKeysRequest = blobStore.getAllKeys()
    const blobsRequest = blobStore.getAll()
    transaction.oncomplete = () => {
      database.close()
      const metadata = new Map(
        metadataKeysRequest.result.map((key, index) => [
          String(key),
          metadataRequest.result[index],
        ])
      )
      const blobs = new Map(
        blobKeysRequest.result.map((key, index) => [
          String(key),
          blobsRequest.result[index],
        ])
      )
      const assetIds = new Set([...metadata.keys(), ...blobs.keys()])
      resolve(
        [...assetIds].map((assetId) => ({
          assetId,
          metadata: metadata.get(assetId),
          blob: blobs.get(assetId),
        }))
      )
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset inventory failed"))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset inventory was aborted"))
    }
  })

  const assets: LocalAssetSummary[] = []
  const issues: LocalAssetIntegrityIssue[] = []
  const quarantineIds: string[] = []
  const readyInspections: Array<{
    summary: LocalAssetSummary
    blob: Blob
  }> = []
  for (const pair of pairs) {
    const inspection = inspectStoredAsset(
      pair.assetId,
      pair.metadata,
      pair.blob
    )
    if (inspection.status === "ready") {
      readyInspections.push(inspection)
    } else if (inspection.status === "missing_bytes") {
      assets.push(inspection.summary)
      issues.push(inspection.issue)
    } else if (inspection.status === "quarantine") {
      issues.push(inspection.issue)
      quarantineIds.push(pair.assetId)
    }
  }
  await Promise.all(
    quarantineIds.map((assetId) => quarantineStoredAsset(assetId))
  )
  const verifiedAssets = await mapWithConcurrency(
    readyInspections,
    verificationConcurrency,
    async ({ summary, blob }) => {
      try {
        const dimensions = await verifyBlob(blob)
        if (dimensions === null) return { record: summary, issue: null }
        if (!dimensionsAreRendererSafe(dimensions)) {
          throw new Error("Saved image dimensions are outside Studio limits.")
        }
        return {
          record: await reconcileStoredAssetDimensions(summary, dimensions),
          issue: null,
        }
      } catch {
        const issue: LocalAssetIntegrityIssue = {
          assetId: summary.id,
          code: "corrupt_bytes",
          message: "Saved image bytes could not be decoded.",
        }
        const quarantined = await quarantineUnreadableStoredAsset(
          summary,
          issue
        )
        return { record: null, issue: quarantined ? issue : null }
      }
    }
  )
  issues.push(...verifiedAssets.flatMap(({ issue }) => (issue ? [issue] : [])))
  assets.push(
    ...verifiedAssets.flatMap(({ record }) => (record ? [record] : []))
  )
  return {
    assets: assets
      .filter((record) => includeArchived || record.archivedAt === null)
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt)),
    issues,
  }
}

export async function listLocalAssetSummaries(options?: {
  includeArchived?: boolean
}) {
  return (await listLocalAssetInventory(options)).assets
}

export async function listLocalAssets() {
  const summaries = await listLocalAssetSummaries()
  const records = await Promise.all(
    summaries.map((summary) => getLocalAssetRecord(summary.id))
  )
  return records.flatMap((record) => (record ? [record] : []))
}

export async function markLocalAssetUsed(
  assetId: string,
  now = new Date().toISOString()
) {
  await ensureLegacyMigration()
  const database = await openDatabase()
  return new Promise<LocalAssetSummary | null>((resolve, reject) => {
    let result: LocalAssetSummary | null = null
    const transaction = database.transaction(
      [METADATA_STORE_NAME, BLOB_STORE_NAME],
      "readwrite"
    )
    const store = transaction.objectStore(METADATA_STORE_NAME)
    const request = store.get(assetId)
    const blobRequest = transaction.objectStore(BLOB_STORE_NAME).get(assetId)
    let metadata: unknown
    let blob: unknown
    let completedRequests = 0
    const reconcile = () => {
      completedRequests += 1
      if (completedRequests < 2) return
      const inspection = inspectStoredAsset(assetId, metadata, blob)
      if (inspection.status !== "ready") return
      const existing = inspection.summary
      result = {
        ...existing,
        updatedAt: now,
        lastUsedAt: now,
        revision: existing.revision + 1,
      }
      store.put(result)
    }
    request.onsuccess = () => {
      metadata = request.result
      reconcile()
    }
    blobRequest.onsuccess = () => {
      blob = blobRequest.result
      reconcile()
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset transaction failed"))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset transaction was aborted"))
    }
  })
}

export class LocalAssetRevisionError extends Error {
  constructor() {
    super("This upload changed in another Studio tab. Refresh and retry.")
    this.name = "LocalAssetRevisionError"
  }
}

export async function archiveLocalAsset(
  assetId: string,
  expectedRevision: number,
  now = new Date().toISOString()
) {
  await ensureLegacyMigration()
  const database = await openDatabase()
  return new Promise<LocalAssetSummary | null>((resolve, reject) => {
    let result: LocalAssetSummary | null = null
    const transaction = database.transaction(METADATA_STORE_NAME, "readwrite")
    const store = transaction.objectStore(METADATA_STORE_NAME)
    const request = store.get(assetId)
    request.onsuccess = () => {
      const existing = parseSummary(request.result)
      if (!existing) return
      if (existing.revision !== expectedRevision) {
        transaction.abort()
        return
      }
      result = {
        ...existing,
        archivedAt: now,
        updatedAt: now,
        revision: existing.revision + 1,
      }
      store.put(result)
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onabort = () => {
      database.close()
      reject(
        transaction.error ??
          (result === null
            ? new LocalAssetRevisionError()
            : new Error("Asset archive was aborted"))
      )
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset archive failed"))
    }
  })
}

export async function localAssetStorageSummary(
  inventory?: readonly LocalAssetSummary[]
): Promise<LocalAssetStorageSummary> {
  const records =
    inventory ?? (await listLocalAssetSummaries({ includeArchived: true }))
  const retainedRecords = records.filter(
    (record) => record.integrity === "ready"
  )
  const activeRecords = retainedRecords.filter(
    (record) => record.archivedAt === null
  )
  const archivedRecords = retainedRecords.filter(
    (record) => record.archivedAt !== null
  )
  const storage = Reflect.get(navigator, "storage") as
    StorageManager | undefined
  let estimate: StorageEstimate | null = null
  try {
    estimate = storage ? await storage.estimate() : null
  } catch {
    // Browser-wide quota reporting is optional; repository inventory is not.
  }
  const browserUsageBytes = estimate?.usage ?? null
  const browserQuotaBytes = estimate?.quota ?? null
  return {
    activeAssetBytes: activeRecords.reduce(
      (total, record) => total + record.size,
      0
    ),
    activeAssetCount: activeRecords.length,
    archivedAssetBytes: archivedRecords.reduce(
      (total, record) => total + record.size,
      0
    ),
    archivedAssetCount: archivedRecords.length,
    retainedAssetBytes: retainedRecords.reduce(
      (total, record) => total + record.size,
      0
    ),
    retainedAssetCount: retainedRecords.length,
    browserUsageBytes,
    browserQuotaBytes,
    browserAvailableBytes:
      browserUsageBytes === null || browserQuotaBytes === null
        ? null
        : Math.max(0, browserQuotaBytes - browserUsageBytes),
  }
}

export class LocalAssetQuotaError extends Error {
  constructor() {
    super(
      "This device does not have enough browser storage for that image. Free browser or device storage, then retry."
    )
    this.name = "LocalAssetQuotaError"
  }
}

export async function assertLocalAssetCapacity(requiredBytes: number) {
  if (requiredBytes <= 0) return
  const storage = Reflect.get(navigator, "storage") as
    StorageManager | undefined
  if (!storage) return
  let estimate: StorageEstimate
  try {
    estimate = await storage.estimate()
  } catch {
    return
  }
  if (estimate.quota === undefined || estimate.usage === undefined) return
  const available = Math.max(0, estimate.quota - estimate.usage)
  if (available < requiredBytes) throw new LocalAssetQuotaError()
}

export async function migrateLocalAssetMetadata() {
  return listLocalAssetSummaries()
}

export async function hasLocalAsset(assetId: string) {
  return (await getLocalAssetRecord(assetId)) !== null
}

export async function deleteLocalAsset(assetId: string) {
  await ensureLegacyMigration()
  await runAssetWrite((metadataStore, blobStore) => {
    metadataStore.delete(assetId)
    blobStore.delete(assetId)
  })
}

export async function rollbackLocalAsset(assetId: string) {
  await deleteLocalAsset(assetId)
  if (await hasLocalAsset(assetId)) {
    throw new Error("Asset rollback did not remove the staged record")
  }
}

export async function getImageDimensions(file: Blob) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return dimensions
    } catch {
      // Safari and Chromium do not decode every SVG through createImageBitmap.
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    return await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const image = new Image()
        image.onload = () =>
          resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () =>
          reject(new Error("The selected image could not be read"))
        image.src = objectUrl
      }
    )
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
