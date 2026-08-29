export const LOCAL_ASSET_DATABASE_NAME = "webmcp-studio-assets"
export const LOCAL_ASSET_DATABASE_VERSION = 5
export const LOCAL_ASSET_LEGACY_STORE_NAME = "assets"
export const LOCAL_ASSET_METADATA_STORE_NAME = "asset-metadata"
export const LOCAL_ASSET_BLOB_STORE_NAME = "asset-blobs"
export const LOCAL_ASSET_QUARANTINE_STORE_NAME = "asset-quarantine"
export const LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME =
  "asset-promotion-journal"

const CREATED_AT_INDEX = "createdAt"
const LAST_USED_AT_INDEX = "lastUsedAt"

export const openLocalAssetDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(
      LOCAL_ASSET_DATABASE_NAME,
      LOCAL_ASSET_DATABASE_VERSION
    )
    request.onupgradeneeded = () => {
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
      if (
        !database.objectStoreNames.contains(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME
        )
      ) {
        database.createObjectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME, {
          keyPath: "localAssetId",
        })
      }
      if (!metadataStore) return
      if (!metadataStore.indexNames.contains(CREATED_AT_INDEX)) {
        metadataStore.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX)
      }
      if (!metadataStore.indexNames.contains(LAST_USED_AT_INDEX)) {
        metadataStore.createIndex(LAST_USED_AT_INDEX, LAST_USED_AT_INDEX)
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
