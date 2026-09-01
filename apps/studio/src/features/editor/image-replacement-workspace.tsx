import {
  cloneElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react"
import type { ComponentType, ReactElement, ReactNode } from "react"
import type { Document, Page } from "@webmcp/document"
import { visiblePageIds } from "@webmcp/editor/multi-artboard"
import type { MultiArtboardLayoutController } from "@webmcp/editor/multi-artboard"
import type { CanvasCamera, ViewportSize } from "@webmcp/editor/viewport"
import type { ImageSourceStateChange } from "./image-source-state-admission"
import { ImageReplacementReactReadinessOwner } from "./image-replacement-react-readiness-owner"
import type {
  ImageReplacementRenderer,
  ImageReplacementRendererEvent,
} from "./image-replacement-readiness"
import type { MultiArtboardWorkspaceProps } from "./multi-artboard-workspace"
import type { PendingRendererReplacement } from "./use-document-editor"
import { useImageReplacementFabricReadinessReporter } from "./use-image-replacement-fabric-readiness-owner"

type ReplacementAwareFabricProps = Readonly<{
  imageResourceTokens?: Readonly<Record<string, string>>
  onImageSourceStateChange?: (state: ImageSourceStateChange) => void
  registerImageReplacementOwner?: () => () => void
}>

const EAGER_EDITABLE_PAGE_LIMIT = 8

export type ImageReplacementWorkspaceHandle = Readonly<{
  updateCamera: (camera: CanvasCamera) => void
}>

export const ImageReplacementWorkspace = forwardRef<
  ImageReplacementWorkspaceHandle,
  Readonly<{
    activePageId: string
    baseInteractionPageIds: ReadonlySet<string>
    camera: CanvasCamera
    document: Document
    layout: MultiArtboardLayoutController
    mutationDisabled?: boolean
    onActivatePage: (pageId: string) => void
    onAddPage: (outputId: string) => void
    onFocusPage: (pageId: string) => void
    onImageSourceStateChange?: (state: ImageSourceStateChange) => void
    overscanScreens: number
    pending: PendingRendererReplacement | null
    reactOwnerEnabled?: boolean
    registerOwner: (renderer: ImageReplacementRenderer) => () => void
    renderFabricArtboard: (
      page: Page
    ) => ReactElement<ReplacementAwareFabricProps>
    renderPageOverlay?: (page: Page) => ReactNode
    reportState: (state: ImageReplacementRendererEvent) => unknown
    viewport: ViewportSize
    workspaceComponent: ComponentType<MultiArtboardWorkspaceProps>
    zoom: number
  }>
>(function ImageReplacementWorkspace(
  {
    activePageId,
    baseInteractionPageIds,
    camera: cameraInput,
    document,
    layout,
    mutationDisabled,
    onActivatePage,
    onAddPage,
    onFocusPage,
    onImageSourceStateChange,
    overscanScreens,
    pending,
    reactOwnerEnabled = true,
    registerOwner,
    renderFabricArtboard,
    renderPageOverlay,
    reportState,
    viewport,
    workspaceComponent: Workspace,
    zoom,
  },
  ref
) {
  const [camera, setCamera] = useState(cameraInput)
  const updateCamera = useCallback((nextCamera: CanvasCamera) => {
    setCamera((currentCamera) =>
      currentCamera.x === nextCamera.x &&
      currentCamera.y === nextCamera.y &&
      currentCamera.zoom === nextCamera.zoom
        ? currentCamera
        : nextCamera
    )
  }, [])
  useImperativeHandle(ref, () => ({ updateCamera }), [updateCamera])
  useEffect(() => updateCamera(cameraInput), [cameraInput, updateCamera])

  const interactionPageIds = useMemo(() => {
    const pageIds = new Set(baseInteractionPageIds)
    if (pending?.pageId) pageIds.add(pending.pageId)
    return pageIds
  }, [baseInteractionPageIds, pending?.pageId])
  const mountedPageIds = useMemo(() => {
    // Normal Studio documents are short enough to keep their editable
    // canvases warm. This avoids a Fabric initialization hitch when a user
    // scrolls onto the next page. Larger documents retain viewport
    // virtualization and its bounded memory behavior.
    if (document.pages.length <= EAGER_EDITABLE_PAGE_LIMIT) {
      return new Set(document.pages.map((page) => page.id))
    }
    return visiblePageIds(layout, camera, viewport, {
      overscanScreens,
      pinnedPageIds: interactionPageIds,
    })
  }, [
    camera,
    document.pages,
    interactionPageIds,
    layout,
    overscanScreens,
    viewport,
  ])
  const imageResourceTokens = useMemo(
    () => (pending ? { [pending.nodeId]: pending.token } : undefined),
    [pending?.nodeId, pending?.token]
  )
  const reportFabricState = useImageReplacementFabricReadinessReporter({
    document,
    reportState,
  })
  const registerFabricOwner = useCallback(
    () => registerOwner("fabric"),
    [registerOwner]
  )
  const handleImageSourceStateChange = useCallback(
    (state: ImageSourceStateChange) => {
      reportFabricState(state)
      onImageSourceStateChange?.(state)
    },
    [onImageSourceStateChange, reportFabricState]
  )
  const renderArtboard = useCallback(
    (page: Page) => (
      <>
        {cloneElement(renderFabricArtboard(page), {
          imageResourceTokens,
          onImageSourceStateChange: handleImageSourceStateChange,
          registerImageReplacementOwner: registerFabricOwner,
        })}
        {renderPageOverlay?.(page)}
      </>
    ),
    [
      handleImageSourceStateChange,
      imageResourceTokens,
      registerFabricOwner,
      renderFabricArtboard,
      renderPageOverlay,
    ]
  )

  return (
    <>
      {reactOwnerEnabled ? (
        <ImageReplacementReactReadinessOwner
          document={document}
          pending={pending}
          registerOwner={registerOwner}
          reportState={reportState}
        />
      ) : null}
      <Workspace
        activePageId={activePageId}
        document={document}
        interactionPageIds={interactionPageIds}
        layout={layout}
        mountedPageIds={mountedPageIds}
        mutationDisabled={mutationDisabled}
        onActivatePage={onActivatePage}
        onAddPage={onAddPage}
        onFocusPage={onFocusPage}
        renderArtboard={renderArtboard}
        zoom={zoom}
      />
    </>
  )
})
