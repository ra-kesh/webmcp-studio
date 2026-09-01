import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { PropsWithChildren } from "react"
import { useStudioPersistence } from "../persistence/studio-persistence-provider"
import { DocumentPreviewController } from "./document-preview-controller"
import type { DocumentPreviewState } from "./document-preview-controller"
import type { DocumentPreviewIdentity } from "./document-preview-contract"
import { loadLocalAsset } from "./local-asset-store"
import { rendererBackedPageThumbnailsEnabled } from "./page-thumbnail-raster-producer"

type DocumentPreviewControllerPort = Pick<
  DocumentPreviewController,
  "subscribe" | "getSnapshot" | "retain" | "retry"
>

const inactivePreviewState: DocumentPreviewState = Object.freeze({
  status: "deferred",
})

const inactivePreviewController: DocumentPreviewControllerPort = {
  subscribe: () => () => false,
  getSnapshot: (_identity: DocumentPreviewIdentity) => inactivePreviewState,
  retain: (_identity: DocumentPreviewIdentity) => () => {},
  retry: (_identity: DocumentPreviewIdentity) => {},
}

const DocumentPreviewContext =
  createContext<DocumentPreviewControllerPort | null>(null)

export type DocumentPreviewProviderProps = PropsWithChildren<{
  createController?: () => DocumentPreviewController
}>

export function DocumentPreviewProvider({
  children,
  createController,
}: DocumentPreviewProviderProps) {
  const persistence = useStudioPersistence()
  const persistenceRef = useRef(persistence)
  persistenceRef.current = persistence
  const [controller] = useState(
    () =>
      createController?.() ??
      new DocumentPreviewController({
        readPreview: (identity) =>
          persistenceRef.current.repository.getPreviewForSummary(identity),
        getDocument: (documentId) =>
          persistenceRef.current.repository.get(documentId),
        putPreview: (preview) =>
          persistenceRef.current.repository.putPreview(preview),
        loadLocalAsset,
        liveFallback: !rendererBackedPageThumbnailsEnabled(
          import.meta.env.VITE_STUDIO_RENDERER_THUMBNAILS
        ),
      })
  )
  const lifecycleRef = useRef(0)

  useEffect(() => {
    const generation = ++lifecycleRef.current
    return () => {
      globalThis.queueMicrotask(() => {
        if (lifecycleRef.current === generation) controller.dispose()
      })
    }
  }, [controller])

  useEffect(() => {
    if (persistence.state.status !== "ready") return
    const releaseLease = persistence.acquireLease()
    const unsubscribe = persistence.subscribeRepositoryEvents((event) => {
      const ownPreview =
        event.type === "preview" &&
        event.sessionId === persistence.repository.sessionId
      if (ownPreview) return
      if (
        event.type === "deleted" ||
        event.type === "restored" ||
        event.type === "quarantined" ||
        event.type === "preview" ||
        (event.type === "saved" && event.reason === "content_saved")
      ) {
        controller.invalidateDocument(event.documentId, {
          reloadVisible: event.type === "preview",
        })
      }
    })
    return () => {
      unsubscribe()
      releaseLease()
    }
  }, [controller, persistence])

  return (
    <DocumentPreviewContext.Provider value={controller}>
      {children}
    </DocumentPreviewContext.Provider>
  )
}

export function useDocumentPreviewController() {
  const controller = useContext(DocumentPreviewContext)
  return controller ?? inactivePreviewController
}
