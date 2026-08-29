import type { Document } from "@webmcp/document"
import { loadLocalAsset, localAssetIdFromSource } from "./local-asset-store"

type Dependencies = Readonly<{
  loadAsset: (assetId: string, signal: AbortSignal) => Promise<Blob | null>
  encodeBlob: (blob: Blob, signal: AbortSignal) => Promise<string>
}>

export const blobToDataUrl = (blob: Blob, signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    signal.throwIfAborted()
    const reader = new FileReader()
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reader.abort()
      reject(signal.reason)
    }
    reader.onload = () => {
      cleanUp()
      if (signal.aborted) reject(signal.reason)
      else if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("The image could not be prepared for export."))
    }
    reader.onerror = () => {
      cleanUp()
      reject(reader.error ?? new Error("The image could not be read."))
    }
    reader.onabort = cleanUp
    signal.addEventListener("abort", abort, { once: true })
    reader.readAsDataURL(blob)
  })

const defaultDependencies: Dependencies = {
  loadAsset: loadLocalAsset,
  encodeBlob: blobToDataUrl,
}

export async function materializeLocalExportNodes(
  document: Document,
  signal: AbortSignal,
  dependencies: Dependencies = defaultDependencies
): Promise<Document["nodes"]> {
  signal.throwIfAborted()
  const siblingController = new AbortController()
  let primaryFailure: unknown
  const operationSignal = AbortSignal.any([signal, siblingController.signal])
  const operations = document.nodes.map(async (node) => {
    try {
      operationSignal.throwIfAborted()
      if (node.type !== "image") return node
      const localAssetId = localAssetIdFromSource(node.src)
      if (!localAssetId) return node
      const blob = await dependencies.loadAsset(localAssetId, operationSignal)
      operationSignal.throwIfAborted()
      if (!blob) {
        throw new Error(`The local image “${node.name}” is unavailable.`)
      }
      return {
        ...node,
        src: await dependencies.encodeBlob(blob, operationSignal),
      }
    } catch (error) {
      if (!siblingController.signal.aborted) {
        primaryFailure = error
        siblingController.abort(error)
      }
      throw error
    }
  })
  const settled = await Promise.allSettled(operations)
  signal.throwIfAborted()
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )
  if (failure) throw primaryFailure ?? failure.reason
  return settled.map(
    (result) =>
      (result as PromiseFulfilledResult<Document["nodes"][number]>).value
  )
}
