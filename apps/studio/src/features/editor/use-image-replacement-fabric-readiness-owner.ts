import { useCallback } from "react"
import type { Document } from "@webmcp/document"
import type { ImageSourceStateChange } from "./image-source-state-admission"
import type { ImageReplacementRendererEvent } from "./image-replacement-readiness"

export function useImageReplacementFabricReadinessReporter({
  document,
  reportState,
}: Readonly<{
  document: Document
  reportState: (state: ImageReplacementRendererEvent) => unknown
}>) {
  return useCallback(
    (state: ImageSourceStateChange) => {
      if (!state.resourceToken || state.readiness === "loading") return
      const pageId = document.pages.find((page) =>
        page.nodeIds.includes(state.nodeId)
      )?.id
      if (!pageId) return
      reportState({
        token: state.resourceToken,
        documentId: document.id,
        pageId,
        nodeId: state.nodeId,
        src: state.src,
        renderer: "fabric",
        readiness: state.readiness,
        naturalSize: state.naturalSize,
      })
    },
    [document.id, document.pages, reportState]
  )
}
