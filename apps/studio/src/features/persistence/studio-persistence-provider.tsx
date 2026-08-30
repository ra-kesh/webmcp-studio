import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { PropsWithChildren } from "react"
import { resolveLocalAssetPromotions } from "../editor/local-asset-promotion-client"
import { hashLocalAssetBlobSha256 } from "../editor/local-asset-promotion-owner"
import { inspectRequestedLocalAssets } from "../editor/local-asset-store"
import { markManagedMediaUsed } from "../editor/managed-media-repository"
import { DocumentRouteAdmissionController } from "../editor/document-route-admission"
import { StudioPersistenceRuntime } from "./studio-persistence-runtime"
import {
  StudioPersistenceContext,
  type StudioPersistenceApi,
} from "./studio-persistence-context"

export {
  type StudioPersistenceApi,
  useStudioPersistence,
} from "./studio-persistence-context"

export type StudioPersistenceProviderProps = PropsWithChildren<{
  createRuntime?: () => StudioPersistenceRuntime
}>

export function StudioPersistenceProvider({
  children,
  createRuntime,
}: StudioPersistenceProviderProps) {
  const [runtime] = useState<StudioPersistenceRuntime>(
    () => createRuntime?.() ?? new StudioPersistenceRuntime()
  )
  const [documentRouteAdmission] = useState(
    () =>
      new DocumentRouteAdmissionController({
        get: (documentId) => runtime.repository.get(documentId),
        touchOpened: (documentId) => runtime.repository.touchOpened(documentId),
        getPendingReceipt: (documentId, signal) =>
          runtime.repository.getPendingLocalMediaAdmissionReceiptForDocument(
            documentId,
            signal
          ),
        inspectLocalAssets: inspectRequestedLocalAssets,
        resolvePromotions: resolveLocalAssetPromotions,
        hashBlob: hashLocalAssetBlobSha256,
        migrateLocalMedia: (input, signal) =>
          runtime.repository.migrateLocalMedia(input, signal),
        markManagedUsed: markManagedMediaUsed,
        updateManagedUse: (input) =>
          runtime.repository.markLocalMediaAdmissionManagedUse(input),
      })
  )
  const state = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot
  )

  useEffect(() => runtime.retain(), [runtime])
  const [admissionLifecycle] = useState(() => ({ generation: 0 }))
  useEffect(() => {
    const generation = ++admissionLifecycle.generation
    return () => {
      globalThis.queueMicrotask(() => {
        if (admissionLifecycle.generation === generation) {
          void documentRouteAdmission.dispose()
        }
      })
    }
  }, [admissionLifecycle, documentRouteAdmission])

  const api = useMemo<StudioPersistenceApi>(
    () => ({
      get repository() {
        return runtime.repository
      },
      state,
      retry: () => runtime.retry(),
      completeRecovery: (warning) => runtime.completeRecovery(warning),
      subscribeRepositoryEvents: (listener) =>
        runtime.subscribeRepositoryEvents(listener),
      acquireLease: () => runtime.acquireLease(),
      documentRouteAdmission,
    }),
    [documentRouteAdmission, runtime, state]
  )

  return (
    <StudioPersistenceContext.Provider value={api}>
      {children}
    </StudioPersistenceContext.Provider>
  )
}
