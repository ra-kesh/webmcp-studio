import { useCallback, useEffect, useMemo } from "react"
import type { Document } from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import type { ImageResourceStateChange } from "@webmcp/render-view"
import type {
  ImageReplacementRenderer,
  ImageReplacementRendererEvent,
} from "./image-replacement-readiness"
import type { PendingRendererReplacement } from "./use-document-editor"

export function ImageReplacementReactReadinessOwner({
  document,
  pending,
  registerOwner,
  reportState,
}: Readonly<{
  document: Document
  pending: PendingRendererReplacement | null
  registerOwner: (renderer: ImageReplacementRenderer) => () => void
  reportState: (state: ImageReplacementRendererEvent) => unknown
}>) {
  useEffect(() => registerOwner("react"), [registerOwner])

  const documentId = pending?.documentId
  const pageId = pending?.pageId
  const nodeId = pending?.nodeId
  const token = pending?.token
  const resourceTokens = useMemo(
    () => (nodeId && token ? { [nodeId]: token } : undefined),
    [nodeId, token]
  )
  const handleResourceState = useCallback(
    (state: ImageResourceStateChange) => {
      if (!documentId || !pageId) return
      reportState({
        ...state,
        documentId,
        pageId,
        renderer: "react",
      })
    },
    [documentId, pageId, reportState]
  )

  if (
    !pending ||
    document.id !== documentId ||
    !document.pages.some(
      (page) => page.id === pageId && page.nodeIds.includes(pending.nodeId)
    )
  ) {
    return null
  }
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return null
  const scale = 1 / Math.max(1, page.width, page.height)

  return (
    <div
      aria-hidden="true"
      data-image-replacement-react-owner={pending.token}
      inert
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
        contain: "strict",
      }}
    >
      <Artboard
        key={`${pending.documentId}:${pending.pageId}:${pending.token}`}
        document={document}
        imageSemantics="thumbnail"
        imageResourceTokens={resourceTokens}
        onImageResourceStateChange={handleResourceState}
        pageId={pending.pageId}
        scale={scale}
        showImageRecoveryActions={false}
      />
    </div>
  )
}
