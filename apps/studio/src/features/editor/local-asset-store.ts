const DATABASE_NAME = "webmcp-studio-assets"
const DATABASE_VERSION = 1
const STORE_NAME = "assets"

export const LOCAL_ASSET_PREFIX = "asset:local/"

type LocalAssetRecord = {
  id: string
  blob: Blob
  name: string
  mediaType: string
  createdAt: string
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Asset database failed to open"))
  })

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = operation(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Asset operation failed"))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Asset transaction failed"))
    }
  })
}

export const localAssetSource = (assetId: string) =>
  `${LOCAL_ASSET_PREFIX}${assetId}`

export const localAssetIdFromSource = (source: string) =>
  source.startsWith(LOCAL_ASSET_PREFIX)
    ? source.slice(LOCAL_ASSET_PREFIX.length)
    : null

export async function saveLocalAsset(file: File, assetId: string) {
  const record: LocalAssetRecord = {
    id: assetId,
    blob: file,
    name: file.name,
    mediaType: file.type,
    createdAt: new Date().toISOString(),
  }
  await runTransaction("readwrite", (store) => store.put(record))
}

export async function loadLocalAsset(assetId: string) {
  const record = await runTransaction<LocalAssetRecord | undefined>(
    "readonly",
    (store) => store.get(assetId)
  )
  return record?.blob ?? null
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
