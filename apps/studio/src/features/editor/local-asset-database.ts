export const LOCAL_ASSET_DATABASE_NAME = "webmcp-studio-assets"
export const LOCAL_ASSET_DATABASE_VERSION = 6
export const LOCAL_ASSET_LEGACY_STORE_NAME = "assets"
export const LOCAL_ASSET_METADATA_STORE_NAME = "asset-metadata"
export const LOCAL_ASSET_BLOB_STORE_NAME = "asset-blobs"
export const LOCAL_ASSET_QUARANTINE_STORE_NAME = "asset-quarantine"
export const LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME =
  "asset-promotion-journal"

const CREATED_AT_INDEX = "createdAt"
export const LOCAL_ASSET_LAST_USED_AT_INDEX = "lastUsedAt"

const legacyRecentUseKey = (value: Record<string, unknown>) => {
  const input = [
    value.localAssetId,
    value.idempotencyKey,
    value.sourceDocumentId,
    value.createdAt,
  ].join("\0")
  const hash = (seed: number) => {
    let result = seed
    for (let index = 0; index < input.length; index += 1) {
      result = Math.imul(result ^ input.charCodeAt(index), 16_777_619)
    }
    return (result >>> 0).toString(16).padStart(8, "0")
  }
  return `legacy-recent-${hash(2_166_136_261)}${hash(3_332_009_381)}`
}

export const openLocalAssetDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(
      LOCAL_ASSET_DATABASE_NAME,
      LOCAL_ASSET_DATABASE_VERSION
    )
    request.onupgradeneeded = (event) => {
      const database = request.result
      const transaction = request.transaction
      const metadataStore = database.objectStoreNames.contains(
        LOCAL_ASSET_METADATA_STORE_NAME
      )
        ? transaction?.objectStore(LOCAL_ASSET_METADATA_STORE_NAME)
        : database.createObjectStore(LOCAL_ASSET_METADATA_STORE_NAME, {
            keyPath: "id",
          })
      if (!database.objectStoreNames.contains(LOCAL_ASSET_BLOB_STORE_NAME)) {
        database.createObjectStore(LOCAL_ASSET_BLOB_STORE_NAME)
      }
      if (
        !database.objectStoreNames.contains(LOCAL_ASSET_QUARANTINE_STORE_NAME)
      ) {
        database.createObjectStore(LOCAL_ASSET_QUARANTINE_STORE_NAME, {
          keyPath: "id",
        })
      }
      let promotionStore: IDBObjectStore | null = null
      if (
        !database.objectStoreNames.contains(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME
        )
      ) {
        promotionStore = database.createObjectStore(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
          {
            keyPath: "localAssetId",
          }
        )
      } else {
        promotionStore =
          transaction?.objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME) ??
          null
      }
      if (event.oldVersion < 6 && promotionStore) {
        const cursorRequest = promotionStore.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const raw = cursor.value
          if (raw && typeof raw === "object") {
            const journal = raw as Record<string, unknown>
            const legacyState = journal.state
            cursor.update({
              ...journal,
              recentUseIdempotencyKey:
                typeof journal.recentUseIdempotencyKey === "string"
                  ? journal.recentUseIdempotencyKey
                  : legacyRecentUseKey(journal),
              state:
                legacyState === "relinking" || legacyState === "complete"
                  ? "mapped"
                  : legacyState,
              relinkResultOperationVersion: null,
              relinkResultKind: null,
              relinkResultDraftContentSnapshotId: null,
              recentUseUsedAt: null,
              recentUseAssetRevision: null,
              recentUseRequestId: null,
              ...(legacyState === "relinking" || legacyState === "complete"
                ? {
                    relinkResultContentSnapshotId: null,
                    relinkResultHistorySnapshotId: null,
                    relinkResultDraftSnapshotId: null,
                    relinkResultDraftRecordVersion: null,
                    relinkCommitId: null,
                    relinkUndoable: null,
                  }
                : {}),
            })
          }
          cursor.continue()
        }
      }
      if (!metadataStore) return
      if (!metadataStore.indexNames.contains(CREATED_AT_INDEX)) {
        metadataStore.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX)
      }
      if (!metadataStore.indexNames.contains(LOCAL_ASSET_LAST_USED_AT_INDEX)) {
        metadataStore.createIndex(
          LOCAL_ASSET_LAST_USED_AT_INDEX,
          LOCAL_ASSET_LAST_USED_AT_INDEX
        )
      }
    }
    request.onsuccess = () => {
      if (blocked) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Asset database failed to open"))
    request.onblocked = () => {
      blocked = true
      reject(
        new Error(
          "Asset storage upgrade is blocked by another Studio tab. Close the other tab and retry."
        )
      )
    }
  })
