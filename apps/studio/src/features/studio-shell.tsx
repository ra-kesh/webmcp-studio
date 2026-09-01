// @refresh reset
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Code2,
  Cloud,
  CopyPlus,
  Circle,
  Download,
  DatabaseZap,
  FileJson2,
  Group,
  Heart,
  Hand,
  ImagePlus,
  Images,
  Layers3,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Send,
  Shapes,
  Square,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Ungroup,
} from "lucide-react"
import { applyTextLinkToRange, getGroupNodeIds } from "@webmcp/document"
import type {
  LibraryMediaDetail,
  SceneNode,
  TextParagraphStylePatch,
  TextRunStylePatch,
  TextSelection,
  TextSelectionLinkState,
} from "@webmcp/document"
import type { CanvasTextEditingState, NodeGeometryPatch } from "@webmcp/editor"
import type { ImageResourceStateChange } from "@webmcp/render-view"
import {
  applyEditorImageFrameCommand,
  applyEditorImagePlacementCommand,
  deriveEditorImageCommandCapabilities,
  dispatchEditorImageCommand,
  editorCommandIds,
  editorImageCommandIds,
  isEditorCommandEnabled,
  resolveEditorShortcut,
} from "@webmcp/editor/commands"
import {
  buildCanvasContextMenu,
  buildProductAppMenus,
  createProductCommandRuntime,
  formatProductCommandShortcut,
  projectProductCommandPalette,
} from "@webmcp/editor/product-commands"
import type {
  ProductCommandId,
  ProductCommandInvocation,
  ProductCommandRunResult,
  ProductCommandRuntimeContext,
  ProductShortcutPlatform,
} from "@webmcp/editor/product-commands"
import type {
  EditorCommandContext,
  EditorCommandId,
  EditorImageCommandHandlers,
  EditorImageCommandId,
  EditorImageFrameCommandId,
  EditorImagePlacementCommandId,
} from "@webmcp/editor/commands"
import { imageCropSessionHasChanges } from "@webmcp/editor/image-crop-session"
import { resolveResizeFrameToImagePreview } from "./editor/image-crop-resize-to-image"
import {
  resolveLibraryTemplateSurfaceVisibility,
  studioDesktopPresentationQuery,
} from "./editor/library-template-surface-visibility"
import {
  createInspectorSelectionModel,
  deriveInspectorMaskCapabilities,
} from "@webmcp/editor/inspector"
import type { InspectorImageSourceState } from "@webmcp/editor/inspector"
import { getNodeBounds, getSelectionBounds } from "@webmcp/editor/geometry"
import type { NodeBounds } from "@webmcp/editor/geometry"
import {
  fitPageInViewport,
  focusCameraOnBounds,
  resizeCameraForViewport,
  zoomCameraAtPoint,
} from "@webmcp/editor/viewport"
import type { CanvasCamera } from "@webmcp/editor/viewport"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { EditorPanelHeader } from "@webmcp/ui/components/editor-chrome"
import { Separator } from "@webmcp/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@webmcp/ui/components/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"

import { namedDocumentMediaUses } from "./editor/asset-library-model"
import { EditorPanelSplitter } from "./editor/editor-panel-splitter"
import type { StudioShellLayoutRepository } from "./editor/studio-shell-layout"
import {
  bootstrapStudioShellLayout,
  createDefaultStudioShellLayout,
  getStudioShellPanelResizeBounds,
  resizeStudioShellPanelAtWidth,
  resolveStudioShellLayout,
  setStudioShellFilmstripDensity,
  toggleStudioShellPanel,
} from "./editor/studio-shell-layout"
import {
  createStudioPageThumbnailRasterProducer,
  rendererBackedPageThumbnailsEnabled,
  studioPageThumbnailRendererRevision,
} from "./editor/page-thumbnail-raster-producer"
import type { PageThumbnailDocumentSnapshot } from "./editor/page-thumbnail-raster-producer"
import type { DocumentPanelTab } from "./editor/quotation-sidebar"
import type { AssetWorkspaceView } from "./editor/asset-workspace-panel"
import {
  getManagedMedia,
  managedMediaIdFromSource,
} from "./editor/managed-media-repository"
import type { ManagedMediaAsset } from "./editor/managed-media-repository"
import { useBackgroundRemoval } from "./editor/use-background-removal"
import {
  backgroundRemovalMutationKey,
  createBackgroundRemovalWithConsent,
  getBackgroundRemovalJob,
  getBackgroundRemovalPolicy,
  getBackgroundRemovalProvenance,
  getLatestBackgroundRemoval,
  mutateBackgroundRemoval,
} from "./editor/background-removal-client"
import { studioAssets } from "./editor/asset-catalog"
import { StudioStartSurface } from "./editor/studio-start-surface"
import { StudioMark } from "./editor/studio-mark"
import { useRecentDocumentsVisibility } from "./editor/recent-documents-provider"
import type {
  FabricArtboardHandle,
  ImageSourceStateChange,
} from "./editor/fabric-artboard"
import { handleEditorEscape } from "./editor/editor-escape"
import {
  captureImageCropFocusSession,
  isImageCropCanvasFocus,
  restoreImageCropFocus,
} from "./editor/image-crop-focus"
import type {
  ImageCropEntrySource,
  ImageCropFocusSession,
} from "./editor/image-crop-focus"
import type { TextLinkEditorResult } from "./editor/text-link-editor"
import {
  applySelectedImageToolbarCameraProjection,
  resolveSelectedImageToolbarPlacement,
} from "./editor/selected-image-toolbar-placement"
import { resolveImageCropToolbarEdge } from "./editor/image-crop-toolbar-placement"
import { imageCropKeyboardScreenDelta } from "./editor/image-crop-keyboard"
import { projectNumericImageCropFrameEdit } from "./editor/image-crop-frame-numeric"
import type { ImageCropArrowKey } from "./editor/image-crop-keyboard"
import { imageReplacementConstraintsByNodeId } from "./editor/image-replacement-binding"
import {
  DOCUMENT_TRANSITION_DISABLED_REASON,
  useDocumentEditor,
} from "./editor/use-document-editor"
import type {
  PerformLibraryMediaActionOptions,
  PerformLibraryMediaActionOutcome,
} from "./editor/use-document-editor"
import type {
  LibraryMediaActionPreparationRequest,
  LibraryMediaActionTarget,
} from "./editor/library-media-action-preparation"
import type { LibraryMediaUsageWarning } from "./editor/library-media-action-executor"
import { createLibraryTemplateDocument } from "./editor/library-template-create-command"
import { useLibraryPreferenceCommands } from "../content/library/library-preference-provider"
import { resolveManagedMediaCatalogUpload } from "../content/library/managed-media-catalog-handshake"
import { libraryMediaUiIdentity } from "../content/library/library-media-discovery"
import type {
  LibraryMediaIntent,
  LibraryMediaScope,
} from "../content/library/library-media-browser"
import type { ReviewAffectedTarget } from "./editor/review-journal"
import type { DocumentDraftRecord } from "./editor/document-draft-repository"
import type { DocumentRouteMediaAdmission } from "./editor/document-route-admission"
import { useStudioPersistence } from "./persistence/studio-persistence-provider"
import { useCriticalActionOwner } from "./editor/use-critical-action-owner"
import { CriticalActionStatus } from "./editor/critical-action-status"
import type { StudioCriticalAction } from "./editor/critical-action-status"
import { exportPagePng } from "./editor/export-page-png"
import { useRenderHistory } from "./editor/use-render-history"
import { useStudioWebMcp } from "./editor/use-studio-webmcp"
import { useDraftReplacement } from "./editor/use-draft-replacement"
import { useDocumentRouteNavigationGuard } from "./editor/use-document-route-navigation-guard"
import { useCanvasGestureNavigation } from "./editor/use-canvas-gesture-navigation"
import type { CanvasRulerGuideOverlayHandle } from "./editor/canvas-ruler-guide-overlay"
import { useEditorWorkspaceGuides } from "./editor/use-editor-workspace-guides"
import { projectVisibleGuideSnapTargets } from "./editor/guide-snap-targets"
import {
  executeGuideProductCommand,
  isGuideProductCommandId,
  projectGuideProductCommandState,
} from "./editor/guide-product-commands"
import {
  createSessionHistory,
  recordSessionHistoryAction,
  reconcileSessionHistoryForDocumentCommit,
  resetSessionHistoryForDocument,
  takeSessionRedo,
  takeSessionUndo,
} from "./editor/studio-session-history"
import type { DocumentHistoryCommit } from "@webmcp/editor/history"
import type {
  SessionHistoryAction,
  SessionHistoryLedger,
} from "./editor/studio-session-history"
import { productCommandInvocationKey } from "./editor/command-palette-model"
import type { StudioCommandPaletteItem } from "./editor/command-palette-model"
import {
  ProductCommandContextMenu,
  ProductCommandDropdownItems,
  ProductCommandMenubar,
  ResponsiveProductCommandDropdownGroups,
} from "./editor/product-command-menu"
import type { ProductCommandMenuRuntime } from "./editor/product-command-menu"
import type { RenameLayerTarget } from "./editor/rename-layer-dialog"
import type { StructureCommandDialogState } from "./editor/structure-command-dialogs"
import {
  defaultStudioTextPresetId,
  studioTextPresets,
} from "./editor/text-presets"
import type { StudioTextPresetId } from "./editor/text-presets"
import { materializeLocalExportNodes } from "./editor/materialize-local-export-nodes"

const AssetLibraryDialog = lazy(() =>
  import("./editor/asset-library-dialog").then((module) => ({
    default: module.AssetLibraryDialog,
  }))
)
const ApiPlaygroundDialog = lazy(() =>
  import("./editor/api-playground-dialog").then((module) => ({
    default: module.ApiPlaygroundDialog,
  }))
)
const NewDocumentDialog = lazy(() =>
  import("./editor/new-document-dialog").then((module) => ({
    default: module.NewDocumentDialog,
  }))
)
const ReplaceCurrentDraftDialog = lazy(() =>
  import("./editor/replace-current-draft-dialog").then((module) => ({
    default: module.ReplaceCurrentDraftDialog,
  }))
)
const QuotationRefreshDialog = lazy(() =>
  import("./editor/quotation-refresh-dialog").then((module) => ({
    default: module.QuotationRefreshDialog,
  }))
)
const DraftRecoveryDialog = lazy(() =>
  import("./editor/draft-recovery-dialog").then((module) => ({
    default: module.DraftRecoveryDialog,
  }))
)
const DocumentConflictDialog = lazy(() =>
  import("./editor/document-conflict-dialog").then((module) => ({
    default: module.DocumentConflictDialog,
  }))
)
const PublishDialog = lazy(() =>
  import("./editor/publish-dialog").then((module) => ({
    default: module.PublishDialog,
  }))
)
const GuideManagerDialog = lazy(() =>
  import("./editor/guide-manager-dialog").then((module) => ({
    default: module.GuideManagerDialog,
  }))
)
const StudioCommandPalette = lazy(() =>
  import("./editor/command-palette").then((module) => ({
    default: module.StudioCommandPalette,
  }))
)
const KeyboardShortcutsDialog = lazy(() =>
  import("./editor/keyboard-shortcuts-dialog").then((module) => ({
    default: module.KeyboardShortcutsDialog,
  }))
)
const RenameLayerDialog = lazy(() =>
  import("./editor/rename-layer-dialog").then((module) => ({
    default: module.RenameLayerDialog,
  }))
)
const StructureCommandDialogs = lazy(() =>
  import("./editor/structure-command-dialogs").then((module) => ({
    default: module.StructureCommandDialogs,
  }))
)
const QuotationSidebar = lazy(() =>
  import("./editor/quotation-sidebar").then((module) => ({
    default: module.QuotationSidebar,
  }))
)
const InspectorSidebar = lazy(() =>
  import("./editor/inspector-sidebar").then((module) => ({
    default: module.InspectorSidebar,
  }))
)
const FabricArtboard = lazy(() =>
  import("./editor/fabric-artboard").then((module) => ({
    default: module.FabricArtboard,
  }))
)
const ProductPageFilmstrip = lazy(() =>
  import("./editor/page-filmstrip").then((module) => ({
    default: module.ProductPageFilmstrip,
  }))
)
const CanvasRulerGuideOverlay = lazy(() =>
  import("./editor/canvas-ruler-guide-overlay").then((module) => ({
    default: module.CanvasRulerGuideOverlay,
  }))
)
const CanvasZoomControls = lazy(() =>
  import("./editor/canvas-zoom-controls").then((module) => ({
    default: module.CanvasZoomControls,
  }))
)
const EmptyCanvasActions = lazy(() =>
  import("./editor/empty-canvas-actions").then((module) => ({
    default: module.EmptyCanvasActions,
  }))
)
const ImageCropToolbar = lazy(() =>
  import("./editor/image-crop-toolbar").then((module) => ({
    default: module.ImageCropToolbar,
  }))
)
const SelectedImageToolbar = lazy(() =>
  import("./editor/selected-image-toolbar").then((module) => ({
    default: module.SelectedImageToolbar,
  }))
)
const TextFormattingToolbar = lazy(() =>
  import("./editor/text-formatting-toolbar").then((module) => ({
    default: module.TextFormattingToolbar,
  }))
)
const TextLinkEditor = lazy(() =>
  import("./editor/text-link-editor").then((module) => ({
    default: module.TextLinkEditor,
  }))
)

export function documentMediaAdmissionActionModel(
  restoredAt: string | null,
  restoreUnavailable: boolean
) {
  return {
    showRestore: restoredAt === null && !restoreUnavailable,
    showPreservation: restoredAt === null && restoreUnavailable,
    keepLabel:
      restoredAt === null ? "Keep recovered images" : "Keep restored version",
  } as const
}

const HEART_ICON_PATH =
  "M12 21.35 10.55 20.03C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.54Z"

type MediaPickerCollection = "recent" | "uploads" | "library"

const mediaScopeFromCollection = (
  collection: MediaPickerCollection
): LibraryMediaScope => ({ kind: collection })

export type MediaPickerActionState = Readonly<{
  kind: "action"
  presentation: "dialog" | "inline"
  sessionId: string
  target: LibraryMediaActionTarget
  targetName?: string
  initialCollection: MediaPickerCollection
  scope: LibraryMediaScope
  selectedDetail: LibraryMediaDetail | null
  pendingIdentity: string | null
  actionError: string | null
}>

export type MediaPickerRecoveryState = Readonly<{
  kind: "recover-local"
  sessionId: string
  targetLocalAssetId: string
  targetName?: string
  initialCollection: "uploads"
  scope: Extract<LibraryMediaScope, { kind: "uploads" }>
}>

export type MediaPickerState = MediaPickerActionState | MediaPickerRecoveryState

export const mediaPickerUsesDialog = (state: MediaPickerState | null) =>
  state !== null &&
  (state.kind === "recover-local" || state.presentation === "dialog")

export type MediaPickerUsageNotice = Readonly<{
  id: string
  correlationId: string
  key: LibraryMediaUsageWarning["key"]
  message: string
  retry: LibraryMediaUsageWarning["retry"]
  status: "ready" | "retrying" | "failed"
}>

export type ExactLibraryMediaActionPerformer = (
  request: LibraryMediaActionPreparationRequest,
  options?: PerformLibraryMediaActionOptions
) => Promise<PerformLibraryMediaActionOutcome>

type OpenMediaPickerAction = Readonly<{
  target: LibraryMediaActionTarget
  initialCollection?: MediaPickerCollection
  presentation?: "dialog" | "inline"
  targetName?: string
  focusReturnTarget?: HTMLElement | null
}>

export function useLibraryMediaPickerSession({
  documentId,
  performLibraryMediaAction,
  recordUsed,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
}: Readonly<{
  documentId: string
  performLibraryMediaAction: ExactLibraryMediaActionPerformer
  recordUsed?: PerformLibraryMediaActionOptions["recordUsed"]
  requestFrame?: (callback: FrameRequestCallback) => number
}>) {
  const [state, setState] = useState<MediaPickerState | null>(null)
  const stateRef = useRef<MediaPickerState | null>(null)
  const [usageNotices, setUsageNotices] = useState<
    readonly MediaPickerUsageNotice[]
  >([])
  const focusReturnRef = useRef<HTMLElement | null>(null)
  const focusEpochRef = useRef(0)
  const activeActionRef = useRef<{
    sessionId: string
    correlationId: string
    controller: AbortController
  } | null>(null)
  const documentIdRef = useRef(documentId)

  const installState = useCallback((next: MediaPickerState | null) => {
    stateRef.current = next
    setState(next)
  }, [])

  const abortActiveAction = useCallback(() => {
    activeActionRef.current?.controller.abort()
    activeActionRef.current = null
  }, [])

  const close = useCallback(
    (restoreFocus = true) => {
      abortActiveAction()
      const focusTarget = focusReturnRef.current
      focusReturnRef.current = null
      installState(null)
      const focusEpoch = ++focusEpochRef.current
      if (!restoreFocus) return
      requestFrame(() => {
        if (
          focusEpoch === focusEpochRef.current &&
          stateRef.current === null &&
          focusTarget?.isConnected
        ) {
          focusTarget.focus()
        }
      })
    },
    [abortActiveAction, installState, requestFrame]
  )

  const captureFocusTarget = useCallback((target?: HTMLElement | null) => {
    ++focusEpochRef.current
    if (target !== undefined) {
      focusReturnRef.current = target
      return
    }
    if (stateRef.current !== null) return
    focusReturnRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }, [])

  const openAction = useCallback(
    ({
      target,
      initialCollection = "recent",
      presentation = "dialog",
      targetName,
      focusReturnTarget,
    }: OpenMediaPickerAction) => {
      abortActiveAction()
      captureFocusTarget(focusReturnTarget)
      const next: MediaPickerActionState = {
        kind: "action",
        presentation,
        sessionId: `media-picker-${crypto.randomUUID()}`,
        target,
        targetName,
        initialCollection,
        scope: mediaScopeFromCollection(initialCollection),
        selectedDetail: null,
        pendingIdentity: null,
        actionError: null,
      }
      installState(next)
      return next.sessionId
    },
    [abortActiveAction, captureFocusTarget, installState]
  )

  const openRecovery = useCallback(
    ({
      localAssetId,
      targetName,
      focusReturnTarget,
    }: Readonly<{
      localAssetId: string
      targetName?: string
      focusReturnTarget?: HTMLElement | null
    }>) => {
      abortActiveAction()
      captureFocusTarget(focusReturnTarget)
      const next: MediaPickerRecoveryState = {
        kind: "recover-local",
        sessionId: `media-picker-${crypto.randomUUID()}`,
        targetLocalAssetId: localAssetId,
        targetName,
        initialCollection: "uploads",
        scope: { kind: "uploads" },
      }
      installState(next)
      return next.sessionId
    },
    [abortActiveAction, captureFocusTarget, installState]
  )

  const captureWarning = useCallback(
    (correlationId: string, warning: LibraryMediaUsageWarning) => {
      const id = `${correlationId}:${warning.key}`
      setUsageNotices((current) => {
        const next: MediaPickerUsageNotice = {
          id,
          correlationId,
          key: warning.key,
          message: warning.message,
          retry: warning.retry,
          status: "ready",
        }
        const found = current.some((notice) => notice.id === id)
        return found
          ? current.map((notice) => (notice.id === id ? next : notice))
          : [...current, next]
      })
    },
    []
  )

  const executeExactSelection = useCallback(
    async (detail: LibraryMediaDetail) => {
      const opened = stateRef.current
      if (!opened || opened.kind !== "action") return "rejected" as const
      abortActiveAction()
      const correlationId = `library-media-${crypto.randomUUID()}`
      const controller = new AbortController()
      const active = {
        sessionId: opened.sessionId,
        correlationId,
        controller,
      }
      activeActionRef.current = active
      const selectedDetail = structuredClone(detail)
      installState({
        ...opened,
        selectedDetail,
        pendingIdentity: libraryMediaUiIdentity(detail.summary),
        actionError: null,
      })
      let outcome: PerformLibraryMediaActionOutcome
      try {
        outcome = await performLibraryMediaAction(
          {
            correlationId,
            detail: selectedDetail,
            target: opened.target,
          },
          {
            signal: controller.signal,
            recordUsed,
            onUsageWarning: (warning) => captureWarning(correlationId, warning),
          }
        )
      } catch (error) {
        outcome = "rejected"
        if (activeActionRef.current === active) {
          installState({
            ...opened,
            selectedDetail,
            pendingIdentity: null,
            actionError:
              error instanceof Error
                ? error.message
                : "The selected image could not be applied.",
          })
        }
      }
      if (activeActionRef.current !== active) return outcome
      activeActionRef.current = null
      const current = stateRef.current
      if (
        !current ||
        current.kind !== "action" ||
        current.sessionId !== opened.sessionId
      ) {
        return outcome
      }
      if (outcome === "rejected") {
        installState({
          ...current,
          pendingIdentity: null,
          actionError:
            current.actionError ??
            "The selected image could not be applied. Retry in the current design.",
        })
      } else {
        close(true)
      }
      return outcome
    },
    [
      abortActiveAction,
      captureWarning,
      close,
      installState,
      performLibraryMediaAction,
      recordUsed,
    ]
  )

  const retryUsageNotice = useCallback(
    async (noticeId: string) => {
      const notice = usageNotices.find((candidate) => candidate.id === noticeId)
      if (!notice || notice.status === "retrying") return false
      setUsageNotices((current) =>
        current.map((candidate) =>
          candidate.id === noticeId
            ? { ...candidate, status: "retrying" }
            : candidate
        )
      )
      let succeeded = false
      try {
        succeeded = await notice.retry()
      } catch {
        succeeded = false
      }
      setUsageNotices((current) =>
        succeeded
          ? current.filter((candidate) => candidate.id !== noticeId)
          : current.map((candidate) =>
              candidate.id === noticeId
                ? { ...candidate, status: "failed" }
                : candidate
            )
      )
      return succeeded
    },
    [usageNotices]
  )

  const dismissUsageNotice = useCallback((noticeId: string) => {
    setUsageNotices((current) =>
      current.filter((notice) => notice.id !== noticeId)
    )
  }, [])

  const setScope = useCallback(
    (scope: LibraryMediaScope) => {
      const current = stateRef.current
      if (!current || current.kind !== "action") return
      installState({ ...current, scope })
    },
    [installState]
  )

  useEffect(() => {
    if (documentIdRef.current === documentId) return
    documentIdRef.current = documentId
    abortActiveAction()
    focusReturnRef.current = null
    ++focusEpochRef.current
    installState(null)
  }, [abortActiveAction, documentId, installState])

  useEffect(
    () => () => {
      abortActiveAction()
      focusReturnRef.current = null
      ++focusEpochRef.current
    },
    [abortActiveAction]
  )

  return {
    state,
    usageNotices,
    openAction,
    openRecovery,
    close,
    setScope,
    executeExactSelection,
    retryUsageNotice,
    dismissUsageNotice,
  } as const
}

const editorImageCommandIdSet = new Set<string>(editorImageCommandIds)
const editorCommandIdSet = new Set<string>(editorCommandIds)
const isEditorImageCommandId = (
  commandId: EditorCommandId
): commandId is EditorImageCommandId => editorImageCommandIdSet.has(commandId)

const isEditorCommandId = (
  commandId: ProductCommandId
): commandId is EditorCommandId => editorCommandIdSet.has(commandId)

const detectShortcutPlatform = (): ProductShortcutPlatform => {
  if (typeof navigator === "undefined") return "linux"
  const platform =
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string }
      }
    ).userAgentData?.platform ?? navigator.platform
  if (/mac|iphone|ipad|ipod/i.test(platform)) return "mac"
  if (/win/i.test(platform)) return "windows"
  return "linux"
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "button, a, input, textarea, select, [contenteditable='true'], [role='slider'], [role='radio'], [role='switch']"
    )
  )

function TextPresetMenuItems({
  disabled = false,
  compactTargets = false,
  onSelect,
}: {
  disabled?: boolean
  compactTargets?: boolean
  onSelect: (presetId: StudioTextPresetId) => void
}) {
  return studioTextPresets.map((preset) => (
    <DropdownMenuItem
      key={preset.id}
      className={cn(
        "items-start gap-2.5 py-2",
        compactTargets && "min-h-14 min-[1280px]:min-h-0"
      )}
      disabled={disabled}
      onSelect={() => onSelect(preset.id)}
    >
      <Type className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{preset.name}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
          {preset.description}
        </span>
      </span>
      {preset.id === defaultStudioTextPresetId ? (
        <DropdownMenuShortcut className="mt-0.5">T</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  ))
}

const FOREGROUND_EXPORT_TIMEOUT_MS = 60_000
const FOREGROUND_IMPORT_TIMEOUT_MS = 45_000

function IconButton({
  label,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  shortcut?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          size="icon-sm"
          variant="ghost"
          {...props}
          className={cn("rounded-md", props.className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut ? (
          <kbd className="font-mono text-[11px] text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export type StudioShellProps = Readonly<{
  initialDocumentRecord?: DocumentDraftRecord | null
  initialDocumentWarning?: string | null
  initialDocumentMediaAdmission?: DocumentRouteMediaAdmission | null
  onInitialDocumentInstalled?: (record: DocumentDraftRecord) => void
  routeDocumentId?: string | null
  routeNotice?: string | null
  onDismissRouteNotice?: () => void | Promise<void>
  onHome?: () => void | Promise<void>
  onOpenDocument?: (documentId: string) => boolean | Promise<boolean>
  onSessionOpened?: (
    documentId: string
  ) => boolean | void | Promise<boolean | void>
}>

export function StudioShell({
  initialDocumentRecord = null,
  initialDocumentWarning = null,
  initialDocumentMediaAdmission = null,
  onInitialDocumentInstalled,
  routeDocumentId = null,
  routeNotice = null,
  onDismissRouteNotice,
  onHome,
  onOpenDocument,
  onSessionOpened,
}: StudioShellProps = {}) {
  const persistence = useStudioPersistence()
  const libraryPreferenceCommands = useLibraryPreferenceCommands()
  const [routeTransitionPending, setRouteTransitionPending] = useState(false)
  const [initialShellLayoutState] = useState(() => {
    if (typeof window === "undefined") {
      return {
        layout: createDefaultStudioShellLayout(),
        repository: null,
        error: null,
      }
    }

    const { repository, result } = bootstrapStudioShellLayout(
      () => window.localStorage
    )
    return {
      layout: result.layout,
      repository,
      error:
        result.status === "unavailable"
          ? "Workspace layout preferences are unavailable. Your document is unaffected."
          : result.status === "recovered"
            ? "Invalid workspace layout preferences were reset safely."
            : null,
    }
  })
  const [shellLayout, setShellLayoutState] = useState(
    initialShellLayoutState.layout
  )
  const shellLayoutRef = useRef(shellLayout)
  shellLayoutRef.current = shellLayout
  const shellLayoutRepositoryRef = useRef<StudioShellLayoutRepository | null>(
    initialShellLayoutState.repository
  )
  const [shellAvailableWidth, setShellAvailableWidth] = useState(() => {
    if (typeof window === "undefined") return 1280
    return Math.max(
      0,
      Math.floor(document.documentElement.clientWidth || window.innerWidth)
    )
  })
  const [desktopPresentation, setDesktopPresentation] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia(studioDesktopPresentationQuery).matches
  )
  const [shellLayoutError, setShellLayoutError] = useState<string | null>(
    initialShellLayoutState.error
  )
  const [desktopShellElement, setDesktopShellElement] =
    useState<HTMLDivElement | null>(null)
  const installDesktopShellElement = useCallback(
    (element: HTMLDivElement | null) => {
      setDesktopShellElement((current) =>
        current === element ? current : element
      )
    },
    []
  )
  const leftPanelToggleRef = useRef<HTMLButtonElement>(null)
  const rightPanelToggleRef = useRef<HTMLButtonElement>(null)
  const installShellLayout = useCallback(
    (next: ReturnType<typeof createDefaultStudioShellLayout>) => {
      shellLayoutRef.current = next
      setShellLayoutState(next)
    },
    []
  )
  const persistShellLayout = useCallback(
    (next: ReturnType<typeof createDefaultStudioShellLayout>) => {
      installShellLayout(next)
      const result = shellLayoutRepositoryRef.current?.save(next)
      setShellLayoutError(
        result && !result.ok
          ? "Workspace layout could not be saved. Your document is unaffected."
          : null
      )
    },
    [installShellLayout]
  )
  const previewShellPanelWidth = useCallback(
    (panel: "left" | "right", width: number) => {
      installShellLayout(
        resizeStudioShellPanelAtWidth(
          shellLayoutRef.current,
          panel,
          width,
          shellAvailableWidth
        )
      )
    },
    [installShellLayout, shellAvailableWidth]
  )
  const commitShellPanelWidth = useCallback(
    (panel: "left" | "right", width: number) => {
      persistShellLayout(
        resizeStudioShellPanelAtWidth(
          shellLayoutRef.current,
          panel,
          width,
          shellAvailableWidth
        )
      )
    },
    [persistShellLayout, shellAvailableWidth]
  )
  const toggleShellPanel = useCallback(
    (panel: "left" | "right", restoreFocus = false) => {
      persistShellLayout(toggleStudioShellPanel(shellLayoutRef.current, panel))
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          const toggle =
            panel === "left"
              ? leftPanelToggleRef.current
              : rightPanelToggleRef.current
          toggle?.focus()
        })
      }
    },
    [persistShellLayout]
  )
  const setFilmstripDensity = useCallback(
    (density: "compact" | "comfortable") => {
      persistShellLayout(
        setStudioShellFilmstripDensity(shellLayoutRef.current, density)
      )
    },
    [persistShellLayout]
  )
  const resolvedShellLayout = useMemo(
    () => resolveStudioShellLayout(shellLayout, shellAvailableWidth),
    [shellAvailableWidth, shellLayout]
  )
  const compactPanelUsesBottomSheet = shellAvailableWidth < 640
  const leftShellResizeBounds = useMemo(
    () =>
      getStudioShellPanelResizeBounds(shellLayout, "left", shellAvailableWidth),
    [shellAvailableWidth, shellLayout]
  )
  const rightShellResizeBounds = useMemo(
    () =>
      getStudioShellPanelResizeBounds(
        shellLayout,
        "right",
        shellAvailableWidth
      ),
    [shellAvailableWidth, shellLayout]
  )
  const [sessionHistory, setSessionHistory] =
    useState<SessionHistoryLedger>(createSessionHistory)
  const sessionHistoryRef = useRef(sessionHistory)
  sessionHistoryRef.current = sessionHistory
  const clearGuideRedoRef = useRef<() => boolean>(() => false)
  const installSessionHistory = useCallback((next: SessionHistoryLedger) => {
    sessionHistoryRef.current = next
    setSessionHistory(next)
  }, [])
  const recordSessionAction = useCallback(
    (action: SessionHistoryAction) => {
      const next = recordSessionHistoryAction(sessionHistoryRef.current, action)
      if (next !== sessionHistoryRef.current) installSessionHistory(next)
    },
    [installSessionHistory]
  )
  const onDocumentHistoryCommit = useCallback(
    (entry: DocumentHistoryCommit) => {
      clearGuideRedoRef.current()
      const next = reconcileSessionHistoryForDocumentCommit(
        sessionHistoryRef.current,
        entry
      )
      if (next !== sessionHistoryRef.current) installSessionHistory(next)
    },
    [installSessionHistory]
  )
  const editor = useDocumentEditor({
    initialRecord: initialDocumentRecord,
    initialRecordWarning: initialDocumentWarning,
    initialMediaAdmission: initialDocumentMediaAdmission,
    onInitialRecordInstalled: onInitialDocumentInstalled,
    persistence,
    onHistoryCommit: onDocumentHistoryCommit,
  })
  useRecentDocumentsVisibility(
    routeDocumentId === null && editor.sessionMode === "start"
  )
  const sessionDocumentIdRef = useRef(editor.document.id)
  const pageThumbnailSnapshotId = useMemo(() => {
    const review = editor.pendingChangeSet
    return review
      ? `${editor.snapshotId}:review:${review.id}:${review.operations
          .map((operation) => `${operation.id}:${operation.status}`)
          .join(",")}`
      : editor.snapshotId
  }, [editor.pendingChangeSet, editor.snapshotId])
  const pageThumbnailSnapshotRef = useRef<PageThumbnailDocumentSnapshot>({
    document: editor.canonicalPreviewDocument,
    snapshotId: pageThumbnailSnapshotId,
  })
  pageThumbnailSnapshotRef.current = {
    document: editor.canonicalPreviewDocument,
    snapshotId: pageThumbnailSnapshotId,
  }
  const pageThumbnailProducerRef = useRef<
    ReturnType<typeof createStudioPageThumbnailRasterProducer> | undefined
  >(undefined)
  const pageThumbnailProducer = (pageThumbnailProducerRef.current ??=
    createStudioPageThumbnailRasterProducer({
      getSnapshot: () => pageThumbnailSnapshotRef.current,
    }))
  const rendererBackedPageThumbnailRaster = useMemo(
    () => ({
      admissionDelayMs: 300,
      canonicalDocument: editor.canonicalPreviewDocument,
      documentSnapshotId: pageThumbnailSnapshotId,
      producer: pageThumbnailProducer,
      rendererRevision: studioPageThumbnailRendererRevision,
    }),
    [
      editor.canonicalPreviewDocument,
      pageThumbnailProducer,
      pageThumbnailSnapshotId,
    ]
  )
  // Filmstrip browsing must not spend remote Browser Run time or inherit its
  // new-session rate limit. Renderer-backed thumbnails remain an explicit
  // conformance/profile mode; ordinary editing uses the bounded local path.
  const useRendererBackedPageThumbnails = rendererBackedPageThumbnailsEnabled(
    import.meta.env.VITE_STUDIO_RENDERER_THUMBNAILS
  )
  const backgroundRemovalEnabled =
    import.meta.env.VITE_STUDIO_BACKGROUND_REMOVAL === "true"
  const pageThumbnailRaster = useRendererBackedPageThumbnails
    ? rendererBackedPageThumbnailRaster
    : undefined
  const publishedVersion =
    editor.publishSyncStatus === "synced"
      ? editor.latestPublishedVersion
      : undefined
  const renderHistory = useRenderHistory(publishedVersion)
  const [zoom, setZoom] = useState(0.34)
  const [autoFit, setAutoFitState] = useState(true)
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0 })
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [tool, setTool] = useState<"select" | "hand">("select")
  const [spacePressed, setSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [apiPlaygroundOpen, setApiPlaygroundOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutReferenceOpen, setShortcutReferenceOpen] = useState(false)
  const [renameLayerTarget, setRenameLayerTarget] =
    useState<RenameLayerTarget | null>(null)
  const [structureCommandDialog, setStructureCommandDialog] =
    useState<StructureCommandDialogState | null>(null)
  const mediaPickerSession = useLibraryMediaPickerSession({
    documentId: editor.document.id,
    performLibraryMediaAction: editor.performLibraryMediaAction,
    recordUsed: libraryPreferenceCommands.recordUsed,
  })
  const mediaPicker = mediaPickerSession.state
  const mediaUsageNotices = mediaPickerSession.usageNotices
  const [mediaReviewFieldId, setMediaReviewFieldId] = useState<string | null>(
    null
  )
  const [newDocumentOpen, setNewDocumentOpen] = useState(false)
  const [startInitialFocus, setStartInitialFocus] = useState<
    "heading" | "document-library"
  >("heading")
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [quotationRefreshOpen, setQuotationRefreshOpen] = useState(false)
  const lastOpenedQuotationRefreshIdRef = useRef<string | null>(null)
  const pendingQuotationRefresh = editor.quotationRefreshJournal.pending
  useEffect(() => {
    const refreshId = pendingQuotationRefresh?.id ?? null
    if (refreshId && lastOpenedQuotationRefreshIdRef.current !== refreshId) {
      lastOpenedQuotationRefreshIdRef.current = refreshId
      setQuotationRefreshOpen(true)
    }
    if (!refreshId) lastOpenedQuotationRefreshIdRef.current = null
  }, [pendingQuotationRefresh?.id])
  const [guideManagerOpen, setGuideManagerOpen] = useState(false)
  const guideManagerTriggerRef = useRef<HTMLElement | null>(null)
  const [textEditingNodeId, setTextEditingNodeId] = useState<string | null>(
    null
  )
  const [textEditingSelection, setTextEditingSelection] =
    useState<TextSelection | null>(null)
  const [textEditingState, setTextEditingState] =
    useState<CanvasTextEditingState | null>(null)
  const [textLinkEditor, setTextLinkEditor] = useState<{
    nodeId: string
    text: string
    selection: TextSelection
    link: TextSelectionLinkState
  } | null>(null)
  useLayoutEffect(() => {
    if (editor.sessionMode !== "workspace") return
    const root = document.documentElement
    const body = document.body
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyInset: body.style.inset,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
    }
    root.style.overflow = "hidden"
    root.style.overscrollBehavior = "none"
    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"
    body.style.position = "fixed"
    body.style.inset = "0"
    body.style.width = "100%"
    body.style.height = "100%"
    const restoreWorkspaceOrigin = () => {
      if (root.scrollLeft || root.scrollTop) {
        root.scrollTo({ top: 0, left: 0, behavior: "instant" })
      }
      if (body.scrollLeft || body.scrollTop) {
        body.scrollTo({ top: 0, left: 0, behavior: "instant" })
      }
      if (window.scrollX || window.scrollY) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" })
      }
    }
    restoreWorkspaceOrigin()
    root.addEventListener("scroll", restoreWorkspaceOrigin, { passive: true })
    body.addEventListener("scroll", restoreWorkspaceOrigin, { passive: true })
    window.addEventListener("scroll", restoreWorkspaceOrigin, {
      passive: true,
    })
    return () => {
      root.removeEventListener("scroll", restoreWorkspaceOrigin)
      body.removeEventListener("scroll", restoreWorkspaceOrigin)
      window.removeEventListener("scroll", restoreWorkspaceOrigin)
      root.style.overflow = previous.rootOverflow
      root.style.overscrollBehavior = previous.rootOverscrollBehavior
      body.style.overflow = previous.bodyOverflow
      body.style.overscrollBehavior = previous.bodyOverscrollBehavior
      body.style.position = previous.bodyPosition
      body.style.inset = previous.bodyInset
      body.style.width = previous.bodyWidth
      body.style.height = previous.bodyHeight
    }
  }, [editor.sessionMode])
  const [documentPanelTab, setDocumentPanelTab] =
    useState<DocumentPanelTab>("templates")
  const [assetWorkspaceView, setAssetWorkspaceView] =
    useState<AssetWorkspaceView>("media")
  const [assetMediaScope, setAssetMediaScope] = useState<LibraryMediaScope>({
    kind: "recent",
  })
  const {
    activeAction: criticalAction,
    error: criticalActionError,
    setError: setCriticalActionError,
    claim: claimCriticalAction,
    release: releaseCriticalAction,
    dispatch: dispatchCriticalAction,
    lifecycle: criticalActionLifecycle,
    cancel: cancelCriticalAction,
    retry: retryCriticalAction,
    dismissTerminal: dismissCriticalAction,
  } = useCriticalActionOwner<StudioCriticalAction>()
  const [compactPanel, setCompactPanel] = useState<
    "document" | "inspector" | null
  >(null)
  const templateBrowserVisibility = resolveLibraryTemplateSurfaceVisibility({
    desktopPresentation,
    documentPanelTab,
    compactDocumentPanelOpen: compactPanel === "document",
  })
  const assetMediaBrowserVisibility = {
    desktop:
      desktopPresentation &&
      documentPanelTab === "components" &&
      assetWorkspaceView === "media",
    compact:
      !desktopPresentation &&
      compactPanel === "document" &&
      documentPanelTab === "components" &&
      assetWorkspaceView === "media",
  }
  const [imageSourceStateByNodeId, setImageSourceStateByNodeId] = useState<
    Partial<Record<string, InspectorImageSourceState>>
  >({})
  const workspaceRef = useRef<HTMLDivElement>(null)
  const cameraTransformRef = useRef<HTMLDivElement>(null)
  const selectedImageToolbarOverlayRef = useRef<HTMLDivElement>(null)
  const textFormattingToolbarOverlayRef = useRef<HTMLDivElement>(null)
  const cameraSettlementTimerRef = useRef<number | null>(null)
  const [workspaceElement, setWorkspaceElement] =
    useState<HTMLDivElement | null>(null)
  const installWorkspaceElement = useCallback(
    (element: HTMLDivElement | null) => {
      workspaceRef.current = element
      setWorkspaceElement((current) =>
        current === element ? current : element
      )
    },
    []
  )
  const cameraRef = useRef<CanvasCamera>({ x: 0, y: 0, zoom: 0.34 })
  const committedZoomRef = useRef(zoom)
  committedZoomRef.current = zoom
  const autoFitRef = useRef(autoFit)
  autoFitRef.current = autoFit
  const workspaceSizeRef = useRef(workspaceSize)
  const setAutoFit = useCallback((next: boolean) => {
    autoFitRef.current = next
    setAutoFitState(next)
  }, [])
  const artboardRef = useRef<FabricArtboardHandle>(null)
  const rulerGuideOverlayRef = useRef<CanvasRulerGuideOverlayHandle>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const quotationInputRef = useRef<HTMLInputElement>(null)
  const compactPanelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const compactPanelHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const insertShapeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const studioMoreActionsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const cropFocusSessionRef = useRef<ImageCropFocusSession | null>(null)
  const cropWasActiveRef = useRef(false)
  const pendingTextMenuEditingNodeIdRef = useRef<string | null>(null)
  const shortcutPlatform = useMemo(detectShortcutPlatform, [])
  const panSessionRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    cameraX: number
    cameraY: number
  } | null>(null)

  useEffect(() => {
    const shell = desktopShellElement
    if (!shell) return
    const measure = () => {
      const width = Math.max(0, Math.floor(shell.clientWidth))
      setShellAvailableWidth((current) => (current === width ? current : width))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    measure()
    return () => observer.disconnect()
  }, [desktopShellElement])

  const activePage =
    editor.previewDocument.pages.find(
      (page) => page.id === editor.activePageId
    ) ?? editor.previewDocument.pages[0]
  const activeOutput = editor.previewDocument.outputs.find(
    (output) => output.id === activePage.outputId
  )
  const documentPageIds = useMemo(
    () => editor.document.pages.map((page) => page.id),
    [editor.document.pages]
  )
  const guideWorkspace = useEditorWorkspaceGuides({
    documentId: editor.document.id,
    pageIds: documentPageIds,
    activePageId: activePage.id,
    pageSize: { width: activePage.width, height: activePage.height },
  })
  clearGuideRedoRef.current = guideWorkspace.clearRedo
  const activeGuideSnapTargets = useMemo(
    () =>
      projectVisibleGuideSnapTargets(
        guideWorkspace.activeGuides,
        guideWorkspace.preferences.guidesVisible
      ),
    [guideWorkspace.activeGuides, guideWorkspace.preferences.guidesVisible]
  )
  const rulerSelectionBounds = useMemo(() => {
    const bounds = getSelectionBounds(editor.selectedNodes)
    return bounds
      ? {
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        }
      : null
  }, [editor.selectedNodes])
  const runGuideMutation = useCallback(
    (mutation: () => { id: string } | null) => {
      const entry = mutation()
      if (!entry) return null
      editor.breakHistoryCoalescing()
      editor.clearRedo()
      recordSessionAction({ kind: "guide", id: entry.id })
      return entry
    },
    [editor, recordSessionAction]
  )
  const addWorkspaceGuide = useCallback(
    (guide: { axis: "x" | "y"; position: number }) =>
      runGuideMutation(() => guideWorkspace.addGuide(guide)),
    [guideWorkspace, runGuideMutation]
  )
  const moveWorkspaceGuide = useCallback(
    (guideId: string, position: number) =>
      runGuideMutation(() => guideWorkspace.moveGuide(guideId, position)),
    [guideWorkspace, runGuideMutation]
  )
  const duplicateWorkspaceGuide = useCallback(
    (guideId: string, position: number) =>
      runGuideMutation(() => guideWorkspace.duplicateGuide(guideId, position)),
    [guideWorkspace, runGuideMutation]
  )
  const removeWorkspaceGuide = useCallback(
    (guideId: string) =>
      runGuideMutation(() => guideWorkspace.removeGuide(guideId)),
    [guideWorkspace, runGuideMutation]
  )
  const selectWorkspaceGuide = useCallback(
    (guideId: string | null) => {
      if (guideId) editor.setSelection(null)
      guideWorkspace.setSelectedGuideId(guideId)
    },
    [editor.setSelection, guideWorkspace.setSelectedGuideId]
  )

  useEffect(() => {
    if (editor.selection?.nodeIds.length) {
      guideWorkspace.setSelectedGuideId(null)
    }
  }, [editor.selection?.nodeIds, guideWorkspace.setSelectedGuideId])

  useEffect(() => {
    if (
      compactPanel ||
      guideManagerOpen ||
      commandPaletteOpen ||
      shortcutReferenceOpen ||
      renameLayerTarget ||
      structureCommandDialog
    ) {
      rulerGuideOverlayRef.current?.cancelGuideDrag()
      rulerGuideOverlayRef.current?.clearGuideHover()
    }
  }, [
    commandPaletteOpen,
    compactPanel,
    guideManagerOpen,
    renameLayerTarget,
    shortcutReferenceOpen,
    structureCommandDialog,
  ])

  useEffect(() => {
    if (sessionDocumentIdRef.current === editor.document.id) return
    sessionDocumentIdRef.current = editor.document.id
    installSessionHistory(
      resetSessionHistoryForDocument(editor.documentUndoEntry?.id ?? null)
    )
  }, [editor.document.id, editor.documentUndoEntry, installSessionHistory])

  const undoSessionAction = useCallback(() => {
    let ledger = sessionHistoryRef.current
    while (ledger.past.length) {
      const settlement = takeSessionUndo(ledger)
      const action = settlement.action
      if (!action) return false
      const nextLedger = settlement.ledger
      if (action.kind === "guide") {
        if (guideWorkspace.guideUndoEntry?.id !== action.id) {
          ledger = nextLedger
          installSessionHistory(ledger)
          continue
        }
        if (!guideWorkspace.undoGuide()) return false
        installSessionHistory(nextLedger)
        return true
      }
      if (editor.documentUndoEntry?.id !== action.id) {
        ledger = nextLedger
        installSessionHistory(ledger)
        continue
      }
      editor.undo()
      installSessionHistory(nextLedger)
      return true
    }
    return false
  }, [editor, guideWorkspace, installSessionHistory])

  const redoSessionAction = useCallback(() => {
    let ledger = sessionHistoryRef.current
    while (ledger.future.length) {
      const settlement = takeSessionRedo(ledger)
      const action = settlement.action
      if (!action) return false
      const nextLedger = settlement.ledger
      if (action.kind === "guide") {
        if (guideWorkspace.guideRedoEntry.id !== action.id) {
          ledger = nextLedger
          installSessionHistory(ledger)
          continue
        }
        if (!guideWorkspace.redoGuide()) return false
        installSessionHistory(nextLedger)
        return true
      }
      if (editor.documentRedoEntry?.id !== action.id) {
        ledger = nextLedger
        installSessionHistory(ledger)
        continue
      }
      editor.redo()
      installSessionHistory(nextLedger)
      return true
    }
    return false
  }, [editor, guideWorkspace, installSessionHistory])
  const cropImageNode = editor.imageCropSession
    ? editor.previewDocument.nodes.find(
        (node) => node.id === editor.imageCropSession?.target.nodeId
      )
    : undefined
  const cropImageName = cropImageNode?.name ?? null
  const selectedImage =
    editor.selectedNodes.length === 1 &&
    editor.selectedNodes[0]?.type === "image"
      ? editor.selectedNodes[0]
      : null
  const imageReplacementResourceTokens = useMemo(() => {
    const replacement = editor.pendingImageReplacement
    return replacement ? { [replacement.nodeId]: replacement.token } : undefined
  }, [
    editor.pendingImageReplacement?.nodeId,
    editor.pendingImageReplacement?.token,
  ])
  const selectedImageBounds = selectedImage
    ? getNodeBounds(selectedImage)
    : null
  const selectedImageBoundsRef = useRef(selectedImageBounds)
  selectedImageBoundsRef.current = selectedImageBounds
  const projectSelectedImageToolbarOverlay = useCallback(
    (camera: CanvasCamera) => {
      const element = selectedImageToolbarOverlayRef.current
      const bounds = selectedImageBoundsRef.current
      if (!element || !bounds) return
      applySelectedImageToolbarCameraProjection(element, {
        bounds,
        camera,
        viewport: workspaceSizeRef.current,
      })
    },
    []
  )
  const installSelectedImageToolbarOverlay = useCallback(
    (element: HTMLDivElement | null) => {
      selectedImageToolbarOverlayRef.current = element
      if (element) projectSelectedImageToolbarOverlay(cameraRef.current)
    },
    [projectSelectedImageToolbarOverlay]
  )
  const selectedImageToolbarPlacement = selectedImageBounds
    ? resolveSelectedImageToolbarPlacement({
        frameLeft: cameraPosition.x + selectedImageBounds.left * zoom,
        frameRight: cameraPosition.x + selectedImageBounds.right * zoom,
        frameTop: cameraPosition.y + selectedImageBounds.top * zoom,
        frameBottom: cameraPosition.y + selectedImageBounds.bottom * zoom,
        viewportWidth: workspaceSize.width,
        viewportHeight: workspaceSize.height,
      })
    : null
  const textEditingNode = textEditingState
    ? editor.previewDocument.nodes.find(
        (node) => node.id === textEditingState.nodeId && node.type === "text"
      )
    : null
  const textEditingBounds = textEditingNode
    ? getNodeBounds(textEditingNode)
    : null
  const textEditingBoundsRef = useRef(textEditingBounds)
  textEditingBoundsRef.current = textEditingBounds
  const projectTextFormattingToolbarOverlay = useCallback(
    (camera: CanvasCamera) => {
      const element = textFormattingToolbarOverlayRef.current
      const bounds = textEditingBoundsRef.current
      if (!element || !bounds) return
      applySelectedImageToolbarCameraProjection(element, {
        bounds,
        camera,
        viewport: workspaceSizeRef.current,
      })
    },
    []
  )
  const installTextFormattingToolbarOverlay = useCallback(
    (element: HTMLDivElement | null) => {
      textFormattingToolbarOverlayRef.current = element
      if (element) projectTextFormattingToolbarOverlay(cameraRef.current)
    },
    [projectTextFormattingToolbarOverlay]
  )
  const textFormattingToolbarPlacement = textEditingBounds
    ? resolveSelectedImageToolbarPlacement({
        frameLeft: cameraPosition.x + textEditingBounds.left * zoom,
        frameRight: cameraPosition.x + textEditingBounds.right * zoom,
        frameTop: cameraPosition.y + textEditingBounds.top * zoom,
        frameBottom: cameraPosition.y + textEditingBounds.bottom * zoom,
        viewportWidth: workspaceSize.width,
        viewportHeight: workspaceSize.height,
      })
    : null
  useLayoutEffect(() => {
    projectSelectedImageToolbarOverlay(cameraRef.current)
    projectTextFormattingToolbarOverlay(cameraRef.current)
  }, [
    projectSelectedImageToolbarOverlay,
    projectTextFormattingToolbarOverlay,
    selectedImageBounds,
    textEditingBounds,
    workspaceSize,
  ])
  const cropImageBounds = cropImageNode ? getNodeBounds(cropImageNode) : null
  const cropToolbarEdge = cropImageBounds
    ? resolveImageCropToolbarEdge({
        frameTop: cameraPosition.y + cropImageBounds.top * zoom,
        frameBottom: cameraPosition.y + cropImageBounds.bottom * zoom,
        viewportHeight: workspaceRef.current?.clientHeight ?? 0,
      })
    : "bottom"

  const cancelActiveTextEditing = useCallback(() => {
    const cancelled = artboardRef.current?.cancelTextEditing() ?? false
    if (cancelled) setTextEditingNodeId(null)
    return cancelled
  }, [])

  const commitActiveTextEditing = useCallback(() => {
    if (!textEditingNodeId) return true
    const committed = artboardRef.current?.commitTextEditing() ?? false
    if (committed) setTextEditingNodeId(null)
    return committed
  }, [textEditingNodeId])

  const returnToTextEditing = useCallback(
    (nodeId: string, selection?: TextSelection) => {
      window.requestAnimationFrame(() => {
        setTextEditingSelection(selection ?? null)
        setTextEditingNodeId(nodeId)
      })
    },
    []
  )

  const openTextLinkEditor = useCallback(() => {
    const state = textEditingState
    if (!state) return
    if (
      state.selection.anchor === state.selection.focus &&
      state.link.kind === "none"
    ) {
      return
    }
    const session = {
      nodeId: state.nodeId,
      text: state.text,
      selection: { ...state.selection },
      link: { ...state.link },
    }
    const committed = artboardRef.current?.commitTextEditing() ?? false
    if (!committed) return
    setTextEditingNodeId(null)
    setTextLinkEditor(session)
  }, [textEditingState])

  const closeTextLinkEditor = useCallback(() => {
    const nodeId = textLinkEditor?.nodeId
    setTextLinkEditor(null)
    if (nodeId) returnToTextEditing(nodeId, textLinkEditor.selection)
  }, [returnToTextEditing, textLinkEditor?.nodeId, textLinkEditor?.selection])

  const applyTextLinkEditor = useCallback(
    (value: TextLinkEditorResult) => {
      const session = textLinkEditor
      if (!session) return
      const node = editor.document.nodes.find(
        (candidate) =>
          candidate.id === session.nodeId && candidate.type === "text"
      )
      if (!node || node.type !== "text" || node.text !== session.text) return
      const links = applyTextLinkToRange(
        node.text,
        node.links,
        session.selection,
        value
      )
      if (!editor.updateNode(node.id, { links })) return
      setTextLinkEditor(null)
      returnToTextEditing(node.id, session.selection)
    },
    [editor, returnToTextEditing, textLinkEditor]
  )

  const applyActiveTextEditingStyle = useCallback(
    (patch: TextRunStylePatch) => {
      artboardRef.current?.applyTextEditingStyle(patch)
    },
    []
  )

  const applyActiveTextEditingParagraphStyle = useCallback(
    (patch: TextParagraphStylePatch) => {
      artboardRef.current?.applyTextEditingParagraphStyle(patch)
    },
    []
  )

  const prepareDocumentRouteExit = useCallback(async () => {
    if (
      editor.imageCropSession ||
      editor.pendingChangeSet ||
      editor.pendingGeneratedDocument
    )
      return false
    if (!commitActiveTextEditing()) return false
    return editor.flushActiveDraft()
  }, [
    commitActiveTextEditing,
    editor.flushActiveDraft,
    editor.imageCropSession,
    editor.pendingChangeSet,
    editor.pendingGeneratedDocument,
  ])
  const projectBlockedDocumentRouteExit = useCallback(
    (error: unknown | null) => {
      setRouteTransitionPending(false)
      setCriticalActionError(
        error instanceof Error
          ? error.message
          : "Navigation was cancelled because the current document could not be safely saved."
      )
    },
    []
  )
  const shouldWarnBeforeDocumentUnload = useCallback(
    () =>
      textEditingNodeId !== null ||
      editor.imageCropSession !== null ||
      editor.pendingChangeSet !== null ||
      editor.pendingGeneratedDocument !== null ||
      editor.localSaveState.status !== "saved",
    [
      editor.imageCropSession,
      editor.localSaveState.status,
      editor.pendingChangeSet,
      editor.pendingGeneratedDocument,
      textEditingNodeId,
    ]
  )
  useDocumentRouteNavigationGuard({
    enabled: routeDocumentId !== null,
    shouldWarnBeforeUnload: shouldWarnBeforeDocumentUnload,
    prepareToLeave: prepareDocumentRouteExit,
    onBlocked: projectBlockedDocumentRouteExit,
  })

  const beginImageCrop = useCallback(
    (
      nodeId: string,
      options?: {
        source?: ImageCropEntrySource
        opener?: Element | null
      }
    ) => {
      const image = editor.previewDocument.nodes.find(
        (node) => node.id === nodeId
      )
      if (image?.type === "image") {
        const sourceState = imageSourceStateByNodeId[nodeId]
        const readiness =
          sourceState?.src === image.src ? sourceState.readiness : "unknown"
        if (readiness !== "ready") {
          return editor.reportImageCropReadiness(readiness)
        }
      }
      const activeElement =
        options?.opener ??
        (typeof document === "undefined" ? null : document.activeElement)
      const source =
        options?.source ??
        (isImageCropCanvasFocus(activeElement) ? "canvas" : "control")
      const focusSession = captureImageCropFocusSession(source, activeElement)
      artboardRef.current?.commitTextEditing()
      setTextEditingNodeId(null)
      const started = editor.beginImageCrop(nodeId)
      if (started) cropFocusSessionRef.current = focusSession
      return started
    },
    [editor, imageSourceStateByNodeId]
  )

  const updateImageCropFrameGeometry = useCallback(
    (nodeId: string, patch: Partial<NodeGeometryPatch>) => {
      const session = editor.imageCropPreviewStore?.getLiveSession()
      if (!session || session.target.nodeId !== nodeId) return false
      try {
        return editor.previewImageCropFrame(
          projectNumericImageCropFrameEdit({
            session,
            naturalSize:
              artboardRef.current?.getImageNaturalSize(nodeId) ?? null,
            patch,
          })
        )
      } catch {
        return false
      }
    },
    [editor]
  )

  useEffect(() => {
    if (editor.imageCropSession) {
      cropWasActiveRef.current = true
      return
    }
    if (!cropWasActiveRef.current) return
    cropWasActiveRef.current = false
    const focusSession = cropFocusSessionRef.current
    cropFocusSessionRef.current = null
    const frame = window.requestAnimationFrame(() => {
      const canvas =
        workspaceRef.current?.querySelector<HTMLElement>(
          ".upper-canvas, [role='application'][aria-label='Interactive design canvas']"
        ) ?? workspaceRef.current
      restoreImageCropFocus(focusSession, canvas)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editor.imageCropSession])

  const insertTextPreset = useCallback(
    (
      presetId: StudioTextPresetId = defaultStudioTextPresetId,
      options?: { deferEditingUntilMenuClose?: boolean }
    ) => {
      const nodeId = editor.addText(presetId)
      if (!nodeId) return false
      if (options?.deferEditingUntilMenuClose) {
        pendingTextMenuEditingNodeIdRef.current = nodeId
      } else {
        setTextEditingNodeId(nodeId)
      }
      return true
    },
    [editor]
  )
  const restoreTextEditingAfterMenuClose = useCallback(
    (event: { preventDefault: () => void }) => {
      const nodeId = pendingTextMenuEditingNodeIdRef.current
      if (!nodeId) return
      pendingTextMenuEditingNodeIdRef.current = null
      event.preventDefault()
      window.requestAnimationFrame(() => {
        setTextEditingNodeId(nodeId)
      })
    },
    []
  )

  useEffect(() => {
    if (!textEditingNodeId) return
    if (editor.pendingChangeSet || pendingQuotationRefresh) {
      setTextEditingNodeId(null)
      return
    }
    const requestIsStillSelected =
      editor.selection?.pageId === editor.activePageId &&
      editor.selection.nodeIds.includes(textEditingNodeId)
    if (!requestIsStillSelected) setTextEditingNodeId(null)
  }, [
    editor.activePageId,
    editor.pendingChangeSet,
    pendingQuotationRefresh,
    editor.selection,
    textEditingNodeId,
  ])

  const settleCameraState = useCallback((camera: CanvasCamera) => {
    if (cameraSettlementTimerRef.current !== null) {
      window.clearTimeout(cameraSettlementTimerRef.current)
      cameraSettlementTimerRef.current = null
    }
    committedZoomRef.current = camera.zoom
    setZoom(camera.zoom)
    setCameraPosition({ x: camera.x, y: camera.y })
  }, [])

  const applyCamera = useCallback(
    (camera: CanvasCamera) => {
      cameraRef.current = camera
      const transform = cameraTransformRef.current
      if (transform) {
        transform.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0)`
      }
      artboardRef.current?.previewViewportZoom(
        camera.zoom,
        committedZoomRef.current
      )
      rulerGuideOverlayRef.current?.updateCamera(camera)
      projectSelectedImageToolbarOverlay(camera)
      projectTextFormattingToolbarOverlay(camera)

      if (cameraSettlementTimerRef.current !== null) {
        window.clearTimeout(cameraSettlementTimerRef.current)
      }
      cameraSettlementTimerRef.current = window.setTimeout(() => {
        cameraSettlementTimerRef.current = null
        committedZoomRef.current = camera.zoom
        setZoom(camera.zoom)
        setCameraPosition({ x: camera.x, y: camera.y })
      }, 120)
    },
    [projectSelectedImageToolbarOverlay, projectTextFormattingToolbarOverlay]
  )

  useEffect(
    () => () => {
      if (cameraSettlementTimerRef.current !== null) {
        window.clearTimeout(cameraSettlementTimerRef.current)
      }
    },
    []
  )

  const fitCanvas = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const camera = fitPageInViewport(
      { width: activePage.width, height: activePage.height },
      { width: workspace.clientWidth, height: workspace.clientHeight }
    )
    applyCamera(camera)
  }, [activePage.height, activePage.width, applyCamera])

  const focusWorkspace = useCallback(() => {
    setAutoFit(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        workspaceRef.current
          ?.querySelector<HTMLElement>(
            ".upper-canvas, [role='application'][aria-label='Interactive design canvas']"
          )
          ?.focus()
      })
    })
  }, [])

  const finishOpenedSession = useCallback(async () => {
    const openedDocumentId = editor.getActiveDocumentId()
    if (!onSessionOpened || !openedDocumentId) {
      focusWorkspace()
      return
    }
    setRouteTransitionPending(true)
    try {
      await onSessionOpened(openedDocumentId)
    } catch (error) {
      setRouteTransitionPending(false)
      setCriticalActionError(
        error instanceof Error
          ? error.message
          : "Studio created the document but could not open its route."
      )
    }
  }, [editor.getActiveDocumentId, focusWorkspace, onSessionOpened])

  const reloadSavedDocument = useCallback(async () => {
    if (editor.imageCropSession || editor.pendingChangeSet) {
      setCriticalActionError(
        "Finish or cancel the active crop or review before recovering this document."
      )
      return
    }
    if (!commitActiveTextEditing()) return
    const result = await editor.reloadSavedAfterConflict()
    if (!result.ok) return
    if (result.destination === "home") {
      if (onHome) await onHome()
      return
    }
    focusWorkspace()
  }, [
    commitActiveTextEditing,
    editor.imageCropSession,
    editor.pendingChangeSet,
    editor.reloadSavedAfterConflict,
    focusWorkspace,
    onHome,
  ])

  const saveRecoveredDocumentAsCopy = useCallback(async () => {
    if (editor.imageCropSession || editor.pendingChangeSet) {
      setCriticalActionError(
        "Finish or cancel the active crop or review before preserving this document."
      )
      return
    }
    if (!commitActiveTextEditing()) return
    const result = await editor.saveConflictAsCopy()
    if (!result.ok) return
    finishOpenedSession()
  }, [
    commitActiveTextEditing,
    editor.imageCropSession,
    editor.pendingChangeSet,
    editor.saveConflictAsCopy,
    finishOpenedSession,
  ])

  const returnToDocumentsFromConflictRecovery = useCallback(async () => {
    if (!editor.returnToDocumentsFromConflictRecovery()) return
    if (onHome) await onHome()
  }, [editor.returnToDocumentsFromConflictRecovery, onHome])

  const routedFocusHandledRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !routeDocumentId ||
      editor.routeSessionStatus !== "ready" ||
      editor.sessionMode !== "workspace" ||
      editor.document.id !== routeDocumentId ||
      routedFocusHandledRef.current === routeDocumentId
    )
      return
    routedFocusHandledRef.current = routeDocumentId
    focusWorkspace()
  }, [
    editor.document.id,
    editor.routeSessionStatus,
    editor.sessionMode,
    focusWorkspace,
    routeDocumentId,
  ])

  const draftReplacement = useDraftReplacement({
    hasCurrentDraft: editor.sessionMode === "workspace",
    workspaceActive: editor.sessionMode === "workspace",
    settleWorkspaceEdits: commitActiveTextEditing,
    flushCurrentDraft: editor.flushActiveDraft,
    onOpened: finishOpenedSession,
    onQueued: () => setNewDocumentOpen(false),
    onSeparateTransitionChange: editor.setSeparateDocumentTransition,
  })
  const pendingDraftReplacement = draftReplacement.pending
  const startPendingIntent = draftReplacement.pendingIntent
  const replacementRunning = draftReplacement.replacing
  const requestDraftReplacement = draftReplacement.request
  const createSeparateDraft = draftReplacement.createSeparate
  const confirmDraftReplacement = draftReplacement.confirm
  const cancelDraftReplacement = useCallback(() => {
    draftReplacement.cancel()
    dismissCriticalAction()
  }, [dismissCriticalAction, draftReplacement.cancel])
  const criticalActionTargetRef = useRef({
    documentId: editor.document.id,
    snapshotId: editor.documentSnapshotId,
  })
  useEffect(() => {
    const previous = criticalActionTargetRef.current
    if (
      previous.documentId === editor.document.id &&
      previous.snapshotId === editor.documentSnapshotId
    ) {
      return
    }
    criticalActionTargetRef.current = {
      documentId: editor.document.id,
      snapshotId: editor.documentSnapshotId,
    }
    if (
      criticalActionLifecycle.status !== "idle" &&
      criticalActionLifecycle.action.startsWith("import-") &&
      criticalActionLifecycle.status !== "running" &&
      criticalActionLifecycle.status !== "cancelling"
    ) {
      dismissCriticalAction()
    }
  }, [
    criticalActionLifecycle,
    dismissCriticalAction,
    editor.document.id,
    editor.documentSnapshotId,
  ])
  const runOwnedStartImport = useCallback(
    (file: File) =>
      new Promise<boolean>((resolve) => {
        let attempt = 0
        let initialSettled = false
        const settleInitial = (value: boolean) => {
          if (initialSettled) return
          initialSettled = true
          resolve(value)
        }
        const accepted = dispatchCriticalAction(
          "import-json",
          async ({ signal, enterNonCancelablePhase }) => {
            attempt += 1
            const initialAttempt = attempt === 1
            try {
              const opened = await editor.openDocumentFile(
                file,
                signal,
                enterNonCancelablePhase
              )
              if (!opened) {
                throw new Error(
                  "The document could not be opened. Review the reported file issue and retry when it is corrected."
                )
              }
              if (initialAttempt) {
                settleInitial(true)
              } else {
                draftReplacement.cancel()
                await finishOpenedSession()
              }
            } catch (error) {
              if (initialAttempt) settleInitial(false)
              throw error
            }
          },
          {
            cancelable: true,
            timeoutMs: FOREGROUND_IMPORT_TIMEOUT_MS,
            timeoutMessage:
              "Document import took too long while checking the file. No new document was created.",
            cancelMessage:
              "Document import cancelled while checking the file. No new document was created.",
          }
        )
        if (!accepted) settleInitial(false)
      }),
    [
      dispatchCriticalAction,
      draftReplacement.cancel,
      editor.openDocumentFile,
      finishOpenedSession,
    ]
  )
  const requestNewDraft = useCallback(
    (
      intent: Parameters<typeof requestDraftReplacement>[0],
      nextActionLabel: string,
      run: Parameters<typeof requestDraftReplacement>[2]
    ) =>
      editor.localSaveState.status === "session_only"
        ? requestDraftReplacement(intent, nextActionLabel, run)
        : createSeparateDraft(intent, run),
    [createSeparateDraft, editor.localSaveState.status, requestDraftReplacement]
  )
  const createFromLibraryTemplate = useCallback(
    (template: Parameters<typeof editor.resolveCreateFromLibraryTemplate>[0]) =>
      createLibraryTemplateDocument(template, {
        resolve: editor.resolveCreateFromLibraryTemplate,
        confirm: editor.confirmCreateFromLibraryTemplate,
        recordUsed: libraryPreferenceCommands.recordUsed,
      }),
    [
      editor.confirmCreateFromLibraryTemplate,
      editor.resolveCreateFromLibraryTemplate,
      libraryPreferenceCommands.recordUsed,
    ]
  )

  const zoomAtPoint = useCallback(
    (requestedZoom: number, clientX?: number, clientY?: number) => {
      const workspace = workspaceRef.current
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left
      const anchorY = (clientY ?? rect.top + rect.height / 2) - rect.top
      const camera = zoomCameraAtPoint(cameraRef.current, requestedZoom, {
        x: anchorX,
        y: anchorY,
      })
      setAutoFit(false)
      applyCamera(camera)
    },
    [applyCamera]
  )

  const focusBounds = useCallback(
    (bounds: NodeBounds) => {
      const workspace = workspaceRef.current
      if (!workspace) return
      const camera = focusCameraOnBounds(bounds, {
        width: workspace.clientWidth,
        height: workspace.clientHeight,
      })
      setAutoFit(false)
      applyCamera(camera)
    },
    [applyCamera]
  )

  const markManualNavigation = useCallback(() => setAutoFit(false), [])
  useCanvasGestureNavigation({
    workspace: workspaceElement,
    cameraRef,
    applyCamera,
    onManualNavigation: markManualNavigation,
  })

  const zoomToSelection = useCallback(() => {
    const bounds = getSelectionBounds(editor.selectedNodes)
    if (bounds) focusBounds(bounds)
  }, [editor.selectedNodes, focusBounds])

  const inspectorCapabilityContext = {
    documentEditable:
      !editor.pendingChangeSet &&
      !editor.pendingGeneratedDocument &&
      !pendingQuotationRefresh,
    activeImageCropNodeId: editor.imageCropSession?.target.nodeId ?? null,
    imageSourceStateByNodeId,
    imageReplacementConstraintByNodeId: imageReplacementConstraintsByNodeId(
      editor.document,
      editor.selectedNodes.map((node) => node.id)
    ),
  }
  const imageSelectionCapabilities = createInspectorSelectionModel(
    editor.selectedNodes,
    inspectorCapabilityContext
  ).capabilities
  const handleImageSourceStateChange = useCallback(
    (state: ImageSourceStateChange) => {
      if (state.resourceToken && state.readiness !== "loading") {
        editor.reportImageReplacementRendererState({
          token: state.resourceToken,
          nodeId: state.nodeId,
          src: state.src,
          renderer: "fabric",
          readiness: state.readiness,
          naturalSize: state.naturalSize,
        })
      }
      setImageSourceStateByNodeId((current) => {
        const node = editor.previewDocument.nodes.find(
          (candidate) => candidate.id === state.nodeId
        )
        if (node?.type !== "image" || node.src !== state.src) return current
        const previous = current[state.nodeId]
        if (
          previous?.src === state.src &&
          previous.readiness === state.readiness
        ) {
          return current
        }
        return {
          ...current,
          [state.nodeId]: { src: state.src, readiness: state.readiness },
        }
      })
    },
    [editor.previewDocument.nodes, editor.reportImageReplacementRendererState]
  )

  const handleReactImageResourceStateChange = useCallback(
    (state: ImageResourceStateChange) => {
      editor.reportImageReplacementRendererState({
        ...state,
        renderer: "react",
      })
    },
    [editor.reportImageReplacementRendererState]
  )

  const openMediaPicker = useCallback(
    (
      initialCollection: MediaPickerCollection = "recent",
      targetNodeId?: string,
      focusReturnTarget?: HTMLElement | null,
      targetName?: string
    ) => {
      const target = targetNodeId
        ? editor.document.nodes.find((node) => node.id === targetNodeId)
        : null
      mediaPickerSession.openAction({
        target: targetNodeId
          ? { type: "replace", pageId: activePage.id, nodeId: targetNodeId }
          : { type: "insert", pageId: activePage.id },
        targetName: target?.name ?? targetName,
        initialCollection,
        focusReturnTarget,
      })
    },
    [activePage.id, editor.document.nodes, mediaPickerSession.openAction]
  )

  const openFieldMediaPicker = useCallback(
    (fieldId: string, opener: HTMLButtonElement) => {
      const field = editor.document.fields.find(
        (candidate) => candidate.id === fieldId
      )
      mediaPickerSession.openAction({
        target: { type: "assign_field", fieldId },
        targetName: field?.label ?? "Image field",
        initialCollection: "recent",
        focusReturnTarget: opener,
      })
    },
    [editor.document.fields, mediaPickerSession.openAction]
  )

  const imageCommandCapabilities = deriveEditorImageCommandCapabilities({
    selectedNodes: editor.selectedNodes,
    inspectorCapabilities: imageSelectionCapabilities,
    documentEditable:
      !editor.pendingChangeSet &&
      !editor.pendingGeneratedDocument &&
      !pendingQuotationRefresh,
    imageCropActive: Boolean(editor.imageCropSession),
    imageCropDraftChanged: editor.imageCropSession
      ? imageCropSessionHasChanges(editor.imageCropSession)
      : false,
    cropFrameMaskDraftSupported: true,
    activeImagePlacement: editor.imageCropSession?.draft,
    activeImageFrameMask: editor.imageCropSession?.draftFrameMask,
  })

  const maskCommandCapabilities = deriveInspectorMaskCapabilities({
    document: editor.document,
    pageId: activePage.id,
    selectedNodeIds: editor.selection?.nodeIds ?? [],
    selectedGroupId: editor.selectedGroupId,
    documentEditable:
      !editor.pendingChangeSet &&
      !editor.pendingGeneratedDocument &&
      !pendingQuotationRefresh,
  })
  const editorMaskCommandCapabilities = {
    canCreate: maskCommandCapabilities.create.enabled,
    createDisabledReason: maskCommandCapabilities.create.disabledReason,
    canRelease: maskCommandCapabilities.release.enabled,
    releaseDisabledReason: maskCommandCapabilities.release.disabledReason,
    canSetVector: maskCommandCapabilities.setVector.enabled,
    vectorDisabledReason: maskCommandCapabilities.setVector.disabledReason,
    canSetAlpha: maskCommandCapabilities.setAlpha.enabled,
    alphaDisabledReason: maskCommandCapabilities.setAlpha.disabledReason,
    canSetLuminance: maskCommandCapabilities.setLuminance.enabled,
    luminanceDisabledReason:
      maskCommandCapabilities.setLuminance.disabledReason,
    canSetSources: maskCommandCapabilities.setSources.enabled,
    sourcesDisabledReason: maskCommandCapabilities.setSources.disabledReason,
  }
  const commandContext: EditorCommandContext = {
    reviewPending: Boolean(
      editor.pendingChangeSet ||
      editor.pendingGeneratedDocument ||
      pendingQuotationRefresh
    ),
    hasSelection: Boolean(editor.selection?.nodeIds.length),
    selectedNodeCount: editor.selectedNodes.length,
    hasSelectedGroup: Boolean(editor.selectedGroupId),
    hasClipboard: editor.canPaste,
    hasUndo: sessionHistory.past.length > 0,
    hasRedo: sessionHistory.future.length > 0,
    hasZoomSelection: editor.selectedNodes.length > 0,
    canCropImage: imageSelectionCapabilities.canEnterCrop,
    canTransformImage: imageSelectionCapabilities.canFlipImage,
    imageCropActive: Boolean(editor.imageCropSession),
    image: imageCommandCapabilities,
    mask: editorMaskCommandCapabilities,
  }
  const readImageCropSession = () =>
    editor.imageCropPreviewStore?.getLiveSession() ?? editor.imageCropSession
  const readResizeFrameToImagePreview = () => {
    const session = readImageCropSession()
    if (!session) return null
    const naturalSize = artboardRef.current?.getImageNaturalSize(
      session.target.nodeId
    )
    return naturalSize
      ? resolveResizeFrameToImagePreview(session, naturalSize)
      : null
  }
  const readLiveEditorCommandContext = (): EditorCommandContext => {
    const cropSession = readImageCropSession()
    if (!cropSession) return commandContext
    return {
      ...commandContext,
      imageCropActive: true,
      image: deriveEditorImageCommandCapabilities({
        selectedNodes: editor.selectedNodes,
        inspectorCapabilities: imageSelectionCapabilities,
        documentEditable: !editor.pendingChangeSet && !pendingQuotationRefresh,
        imageCropActive: true,
        imageCropDraftChanged: imageCropSessionHasChanges(cropSession),
        cropFrameMaskDraftSupported: true,
        resizeFrameToImageSupported: Boolean(readResizeFrameToImagePreview()),
        activeImagePlacement: cropSession.draft,
        activeImageFrameMask: cropSession.draftFrameMask,
      }),
    }
  }
  const commandEnabled = (commandId: EditorCommandId) =>
    isEditorCommandEnabled(commandId, readLiveEditorCommandContext())
  const productCommandContextRef = useRef<ProductCommandRuntimeContext | null>(
    null
  )
  const productCommandRunnerRef = useRef<
    ((invocation: ProductCommandInvocation) => ProductCommandRunResult) | null
  >(null)
  const executeProductCommandRef = useRef<
    | ((
        invocation: ProductCommandInvocation,
        context: ProductCommandRuntimeContext
      ) => boolean)
    | null
  >(null)
  const documentTransitionDisabledReason =
    replacementRunning || routeTransitionPending
      ? DOCUMENT_TRANSITION_DISABLED_REASON
      : null
  const webMcp = useStudioWebMcp(
    {
      document: editor.document,
      snapshotId: editor.snapshotId,
      operationVersion: editor.operationVersion,
      activePageId: editor.document.pages.some(
        (page) => page.id === editor.activePageId
      )
        ? editor.activePageId
        : editor.document.pages[0].id,
      selection: editor.selection,
      pendingChangeSet: editor.pendingChangeSet,
      assets: studioAssets,
      publishedVersion: publishedVersion ?? null,
      renderHistory: renderHistory.records,
      mutationDisabledReason: documentTransitionDisabledReason,
      ...(backgroundRemovalEnabled
        ? {
            mediaDerivations: {
              inspect: async (input, signal) => {
                if (input.kind === "policy") {
                  return {
                    kind: input.kind,
                    policy: await getBackgroundRemovalPolicy(signal),
                  }
                }
                if (input.kind === "source") {
                  const [policy, job] = await Promise.all([
                    getBackgroundRemovalPolicy(signal),
                    getLatestBackgroundRemoval(input.assetId, signal),
                  ])
                  return { kind: input.kind, policy, job }
                }
                if (input.kind === "job") {
                  return {
                    kind: input.kind,
                    job: await getBackgroundRemovalJob(input.jobId, signal),
                  }
                }
                return {
                  kind: input.kind,
                  provenance: await getBackgroundRemovalProvenance(
                    input.assetId,
                    signal
                  ),
                }
              },
              mutate: async (input, signal) => {
                if (input.action === "start") {
                  return createBackgroundRemovalWithConsent(
                    input.assetId,
                    input.consent.privacyPolicyVersion,
                    signal
                  )
                }
                const idempotencyKey = await backgroundRemovalMutationKey(
                  input.action,
                  input.jobId,
                  input.expectedUpdatedAt
                )
                return mutateBackgroundRemoval(
                  input.jobId,
                  input.expectedUpdatedAt,
                  input.action,
                  signal,
                  idempotencyKey
                )
              },
            },
          }
        : {}),
      getProductCommandContext: () => {
        const context = productCommandContextRef.current
        return context
          ? { ...context, editor: readLiveEditorCommandContext() }
          : null
      },
      proposeChangeSet: editor.proposeChangeSet,
      proposeDocumentGeneration: editor.proposeDocumentGeneration,
      runProductCommand: (invocation) => {
        const runner = productCommandRunnerRef.current
        return runner
          ? runner(invocation)
          : {
              status: "disabled" as const,
              reason: "Canonical command execution is not ready yet.",
            }
      },
      publishTemplate: async (expected, options) => {
        options?.signal?.throwIfAborted()
        if (!commitActiveTextEditing()) {
          throw new Error(
            "Studio could not finish the active text edit before publishing."
          )
        }
        options?.signal?.throwIfAborted()
        return editor.publishTemplate(expected, options)
      },
      renderTemplate: renderHistory.runRender,
    },
    { enabled: editor.sessionMode === "workspace" }
  )
  const runEditorCommand = useCallback(
    (
      commandId: EditorCommandId,
      options?: {
        largeNudge?: boolean
        imageCropEntry?: {
          source?: ImageCropEntrySource
          opener?: Element | null
        }
      }
    ) => {
      const cropSession =
        editor.imageCropPreviewStore?.getLiveSession() ??
        editor.imageCropSession
      const context: EditorCommandContext = {
        reviewPending: Boolean(
          editor.pendingChangeSet || pendingQuotationRefresh
        ),
        hasSelection: Boolean(editor.selection?.nodeIds.length),
        selectedNodeCount: editor.selectedNodes.length,
        hasSelectedGroup: Boolean(editor.selectedGroupId),
        hasClipboard: editor.canPaste,
        hasUndo: sessionHistoryRef.current.past.length > 0,
        hasRedo: sessionHistoryRef.current.future.length > 0,
        hasZoomSelection: editor.selectedNodes.length > 0,
        canCropImage: createInspectorSelectionModel(
          editor.selectedNodes,
          inspectorCapabilityContext
        ).capabilities.canEnterCrop,
        canTransformImage: createInspectorSelectionModel(
          editor.selectedNodes,
          inspectorCapabilityContext
        ).capabilities.canFlipImage,
        imageCropActive: Boolean(cropSession),
        image: deriveEditorImageCommandCapabilities({
          selectedNodes: editor.selectedNodes,
          inspectorCapabilities: createInspectorSelectionModel(
            editor.selectedNodes,
            inspectorCapabilityContext
          ).capabilities,
          documentEditable:
            !editor.pendingChangeSet && !pendingQuotationRefresh,
          imageCropActive: Boolean(cropSession),
          imageCropDraftChanged: cropSession
            ? imageCropSessionHasChanges(cropSession)
            : false,
          cropFrameMaskDraftSupported: true,
          resizeFrameToImageSupported: Boolean(
            cropSession && readResizeFrameToImagePreview()
          ),
          activeImagePlacement: cropSession?.draft,
          activeImageFrameMask: cropSession?.draftFrameMask,
        }),
        mask: editorMaskCommandCapabilities,
      }
      if (!isEditorCommandEnabled(commandId, context)) return false
      const nudge = options?.largeNudge ? 10 : 1
      if (isEditorImageCommandId(commandId)) {
        const runPlacementCommand = (
          placementCommandId: EditorImagePlacementCommandId
        ) =>
          cropSession
            ? editor.previewImageCrop(
                applyEditorImagePlacementCommand(
                  placementCommandId,
                  cropSession.draft
                )
              )
            : editor.runImagePlacementCommand(placementCommandId)
        const runFrameCommand = (frameCommandId: EditorImageFrameCommandId) => {
          const session = cropSession
          if (!session) return editor.runImageFrameCommand(frameCommandId)
          return editor.setImageFrameMask(
            session.target.nodeId,
            applyEditorImageFrameCommand(frameCommandId, session.draftFrameMask)
          )
        }
        const commandSelectedImage = editor.selectedNodes.find(
          (node): node is Extract<SceneNode, { type: "image" }> =>
            node.type === "image"
        )
        const imageHandlers: EditorImageCommandHandlers = {
          "image.insert": () => {
            const desktopInsertTrigger = insertShapeTriggerRef.current
            openMediaPicker(
              "recent",
              undefined,
              desktopInsertTrigger?.getClientRects().length
                ? desktopInsertTrigger
                : studioMoreActionsTriggerRef.current
            )
          },
          "image.replace": () => {
            if (!commandSelectedImage) return false
            openMediaPicker("recent", commandSelectedImage.id)
          },
          "image.crop": () =>
            commandSelectedImage
              ? beginImageCrop(commandSelectedImage.id, options?.imageCropEntry)
              : false,
          "image.crop.apply": editor.finishImageCrop,
          "image.crop.cancel": editor.discardImageCrop,
          "image.fit": () => runPlacementCommand("image.fit"),
          "image.fill": () => runPlacementCommand("image.fill"),
          "image.flip-horizontal": () =>
            runPlacementCommand("image.flip-horizontal"),
          "image.flip-vertical": () =>
            runPlacementCommand("image.flip-vertical"),
          "image.rotate-left": () => runPlacementCommand("image.rotate-left"),
          "image.rotate-right": () => runPlacementCommand("image.rotate-right"),
          "image.rotation.reset": () =>
            runPlacementCommand("image.rotation.reset"),
          "image.reset-placement": () =>
            runPlacementCommand("image.reset-placement"),
          "image.resize-frame-to-image": () => {
            const preview = readResizeFrameToImagePreview()
            return preview ? editor.previewImageCropFrame(preview) : false
          },
          "image.frame.rectangle": () =>
            runFrameCommand("image.frame.rectangle"),
          "image.frame.rounded-rectangle": () =>
            runFrameCommand("image.frame.rounded-rectangle"),
          "image.frame.ellipse": () => runFrameCommand("image.frame.ellipse"),
        }
        return dispatchEditorImageCommand(commandId, context, imageHandlers)
      }
      switch (commandId) {
        case "tool.select":
          setTool("select")
          break
        case "tool.hand":
          setTool("hand")
          break
        case "canvas.fit":
          setAutoFit(true)
          fitCanvas()
          break
        case "canvas.zoom-selection":
          zoomToSelection()
          break
        case "canvas.zoom-in":
          zoomAtPoint(cameraRef.current.zoom * 1.2)
          break
        case "canvas.zoom-out":
          zoomAtPoint(cameraRef.current.zoom / 1.2)
          break
        case "canvas.zoom-reset":
          zoomAtPoint(1)
          break
        case "selection.select-all":
          editor.selectAll()
          break
        case "selection.copy":
          editor.copySelection()
          break
        case "selection.nudge-left":
          editor.nudgeSelection(-nudge, 0)
          break
        case "selection.nudge-right":
          editor.nudgeSelection(nudge, 0)
          break
        case "selection.nudge-up":
          editor.nudgeSelection(0, -nudge)
          break
        case "selection.nudge-down":
          editor.nudgeSelection(0, nudge)
          break
        case "history.undo":
          undoSessionAction()
          break
        case "history.redo":
          redoSessionAction()
          break
        case "object.add-text":
          insertTextPreset()
          break
        case "object.add-rectangle":
          editor.addRectangle()
          break
        case "object.add-ellipse":
          editor.addEllipse()
          break
        case "object.add-line":
          editor.addLine()
          break
        case "object.paste":
          editor.pasteSelection()
          break
        case "object.duplicate":
          editor.duplicateSelection()
          break
        case "object.group":
          editor.groupSelection()
          break
        case "object.ungroup":
          editor.ungroupSelection()
          break
        case "mask.create": {
          const sourceNodeId = maskCommandCapabilities.createSourceNodeIds[0]
          if (!sourceNodeId) return false
          return editor.createMaskGroup(
            [sourceNodeId],
            maskCommandCapabilities.createParentGroupId
          )
        }
        case "mask.release":
          return maskCommandCapabilities.groupId
            ? editor.releaseMaskGroup(maskCommandCapabilities.groupId)
            : false
        case "mask.type.vector":
          return maskCommandCapabilities.groupId
            ? editor.setMaskType(maskCommandCapabilities.groupId, "vector")
            : false
        case "mask.type.alpha":
        case "mask.type.luminance":
        case "mask.sources.set":
          return false
        case "object.delete":
          editor.deleteSelection()
          break
      }
      return true
    },
    [
      beginImageCrop,
      editor,
      fitCanvas,
      insertTextPreset,
      openMediaPicker,
      redoSessionAction,
      undoSessionAction,
      zoomAtPoint,
      zoomToSelection,
    ]
  )

  useEffect(() => {
    const workspace = workspaceElement
    if (!workspace) return
    const measureWorkspace = () => {
      const next = {
        width: workspace.clientWidth,
        height: workspace.clientHeight,
      }
      const previous = workspaceSizeRef.current
      const sizeChanged =
        previous.width !== next.width || previous.height !== next.height
      if (sizeChanged) {
        workspaceSizeRef.current = next
        setWorkspaceSize(next)
      }
      if (next.width <= 0 || next.height <= 0) return
      if (autoFitRef.current) {
        applyCamera(
          fitPageInViewport(
            { width: activePage.width, height: activePage.height },
            next
          )
        )
        return
      }
      if (!sizeChanged) return
      applyCamera(resizeCameraForViewport(cameraRef.current, previous, next))
    }
    const observer = new ResizeObserver(measureWorkspace)
    observer.observe(workspace)
    window.addEventListener("resize", measureWorkspace)
    measureWorkspace()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measureWorkspace)
    }
  }, [
    activePage.height,
    activePage.width,
    applyCamera,
    autoFit,
    workspaceElement,
  ])

  useEffect(() => {
    setAutoFit(true)
    window.requestAnimationFrame(fitCanvas)
  }, [activePage.id, fitCanvas])

  useEffect(() => {
    if (editor.sessionMode !== "workspace") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (
        !event.isComposing &&
        event.code === "KeyK" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (event.key === "Escape" && mediaPicker) {
        event.preventDefault()
        mediaPickerSession.close(true)
        return
      }
      if (
        commandPaletteOpen ||
        guideManagerOpen ||
        shortcutReferenceOpen ||
        renameLayerTarget ||
        structureCommandDialog
      ) {
        return
      }
      if (editor.imageCropSession) {
        if (
          event.key.startsWith("Arrow") &&
          !isInteractiveTarget(event.target)
        ) {
          event.preventDefault()
          artboardRef.current?.nudgeImageCrop(
            imageCropKeyboardScreenDelta(
              event.key as ImageCropArrowKey,
              event.shiftKey
            ),
            cameraRef.current.zoom
          )
          return
        }
      }
      if (isEditableTarget(event.target)) return
      if (event.code === "Space") {
        event.preventDefault()
        setSpacePressed(true)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        handleEditorEscape({
          cancelGuideDrag: () =>
            rulerGuideOverlayRef.current?.cancelGuideDrag() ?? false,
          clearGuideSelection: () => {
            if (!guideWorkspace.selectedGuideId) return false
            guideWorkspace.setSelectedGuideId(null)
            return true
          },
          cancelCrop: () =>
            editor.imageCropSession ? editor.discardImageCrop() : false,
          cancelText: cancelActiveTextEditing,
          cancelTransform: () =>
            artboardRef.current?.cancelTransform() ?? false,
          clearSelection: () => editor.setSelection(null),
        })
        return
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        guideWorkspace.selectedGuideId &&
        !textEditingNodeId
      ) {
        event.preventDefault()
        removeWorkspaceGuide(guideWorkspace.selectedGuideId)
        return
      }
      const commandId = resolveEditorShortcut(event, commandContext)
      const maskShortcutHandled = commandId?.startsWith("mask.")
        ? (() => {
            const context = productCommandContextRef.current
            const runner = productCommandRunnerRef.current
            const command = context
              ? projectProductCommandPalette(context, shortcutPlatform).find(
                  (candidate) => candidate.invocation.commandId === commandId
                )
              : undefined
            return Boolean(
              runner &&
              command &&
              runner(command.invocation).status === "accepted"
            )
          })()
        : false
      if (
        commandId &&
        (maskShortcutHandled ||
          (!commandId.startsWith("mask.") &&
            runEditorCommand(commandId, { largeNudge: event.shiftKey })))
      ) {
        event.preventDefault()
        return
      }
      if (!editor.selection?.nodeIds.length && event.key.startsWith("Arrow")) {
        event.preventDefault()
        const distance = event.shiftKey ? 120 : 40
        applyCamera({
          ...cameraRef.current,
          x:
            cameraRef.current.x +
            (event.key === "ArrowLeft"
              ? distance
              : event.key === "ArrowRight"
                ? -distance
                : 0),
          y:
            cameraRef.current.y +
            (event.key === "ArrowUp"
              ? distance
              : event.key === "ArrowDown"
                ? -distance
                : 0),
        })
        setAutoFit(false)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false)
    }
    const releaseSpace = () => setSpacePressed(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", releaseSpace)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", releaseSpace)
    }
  }, [
    applyCamera,
    cancelActiveTextEditing,
    commandContext,
    commandPaletteOpen,
    editor,
    guideManagerOpen,
    guideWorkspace,
    mediaPicker,
    mediaPickerSession.close,
    renameLayerTarget,
    removeWorkspaceGuide,
    runEditorCommand,
    shortcutReferenceOpen,
    structureCommandDialog,
    textEditingNodeId,
  ])

  useEffect(() => {
    const desktopShell = window.matchMedia(studioDesktopPresentationQuery)
    const closeCompactPanel = () => {
      setDesktopPresentation(desktopShell.matches)
      if (desktopShell.matches) setCompactPanel(null)
    }
    closeCompactPanel()
    desktopShell.addEventListener("change", closeCompactPanel)
    return () => desktopShell.removeEventListener("change", closeCompactPanel)
  }, [])

  const focusNode = (nodeId: string) => {
    const node = editor.previewDocument.nodes.find(
      (candidate) => candidate.id === nodeId
    )
    const page = editor.previewDocument.pages.find((candidate) =>
      candidate.nodeIds.includes(nodeId)
    )
    if (!node || !page) return
    if (page.id !== editor.activePageId) editor.selectPage(page.id)
    editor.setSelection({ pageId: page.id, nodeIds: [nodeId] })
    focusBounds(getNodeBounds(node))
  }

  const createComponentFromSelection = useCallback(() => {
    const componentId = editor.createComponentFromSelection()
    if (componentId) {
      setAssetWorkspaceView("components")
      setDocumentPanelTab("components")
    }
  }, [editor])

  const insertComponent = useCallback(
    (componentId: string) => {
      const workspace = workspaceRef.current
      const camera = cameraRef.current
      const center = workspace
        ? {
            x: (workspace.clientWidth / 2 - camera.x) / camera.zoom,
            y: (workspace.clientHeight / 2 - camera.y) / camera.zoom,
          }
        : undefined
      const instanceId = editor.createComponentInstance(componentId, center)
      if (!instanceId) return
      setDocumentPanelTab("layers")
      setCompactPanel(null)
      window.requestAnimationFrame(() => zoomToSelection())
    },
    [editor, zoomToSelection]
  )

  const focusComponentSource = useCallback(
    (componentId: string) => {
      const component = editor.document.components.find(
        (candidate) => candidate.id === componentId
      )
      if (!component) return
      const group = editor.document.groups.find(
        (candidate) => candidate.id === component.sourceGroupId
      )
      if (!group) return
      const nodeIds = getGroupNodeIds(editor.document, group.id)
      const nodes = nodeIds.flatMap((nodeId) => {
        const node = editor.document.nodes.find(
          (candidate) => candidate.id === nodeId
        )
        return node ? [node] : []
      })
      if (!nodes.length) return
      if (group.pageId !== editor.activePageId) editor.selectPage(group.pageId)
      editor.setSelection({ pageId: group.pageId, nodeIds })
      setDocumentPanelTab("layers")
      setCompactPanel(null)
      const bounds = getSelectionBounds(nodes)
      if (bounds) focusBounds(bounds)
    },
    [editor, focusBounds]
  )

  const focusReviewTarget = (target: ReviewAffectedTarget) => {
    const focusGroup = (groupId: string) => {
      const group = editor.previewDocument.groups.find(
        (candidate) => candidate.id === groupId
      )
      if (!group) return
      const nodeIds = getGroupNodeIds(editor.previewDocument, group.id)
      const nodes = nodeIds.flatMap((nodeId) => {
        const node = editor.previewDocument.nodes.find(
          (candidate) => candidate.id === nodeId
        )
        return node ? [node] : []
      })
      if (!nodes.length) return
      if (group.pageId !== editor.activePageId) editor.selectPage(group.pageId)
      editor.setSelection({ pageId: group.pageId, nodeIds })
      const bounds = getSelectionBounds(nodes)
      if (bounds) focusBounds(bounds)
    }
    if (target.kind === "node") {
      focusNode(target.id)
      return
    }
    if (target.kind === "group") {
      focusGroup(target.id)
      return
    }
    if (target.kind === "component") {
      const component = editor.previewDocument.components.find(
        (candidate) => candidate.id === target.id
      )
      if (component) focusGroup(component.sourceGroupId)
      return
    }
    if (target.kind === "component_instance") {
      const instance = editor.previewDocument.componentInstances.find(
        (candidate) => candidate.id === target.id
      )
      if (instance) focusGroup(instance.rootGroupId)
      return
    }
    if (target.kind === "field") {
      const binding = editor.previewDocument.bindings.find(
        (candidate) => candidate.fieldId === target.id
      )
      if (binding) focusNode(binding.nodeId)
      return
    }
    const pageId =
      target.kind === "page"
        ? target.id
        : editor.previewDocument.outputs.find(
            (output) => output.id === target.id
          )?.pageIds[0]
    if (
      pageId &&
      editor.previewDocument.pages.some((page) => page.id === pageId)
    ) {
      editor.selectPage(pageId)
      editor.setSelection(null)
    }
  }

  const exportPng = async (signal: AbortSignal) => {
    const requestedPageId = activePage.id
    if (editor.imageCropSession) {
      throw new Error("Finish or cancel the image crop before exporting PNG.")
    }
    if (!commitActiveTextEditing()) {
      throw new Error("Finish text editing before exporting PNG.")
    }
    return exportPagePng({
      requestedPageId,
      signal,
      flushActiveDraft: editor.flushActiveDraft,
      getCurrentDocumentSnapshot: editor.getCurrentDocumentSnapshot,
      materializeNodes: (documentSnapshot) =>
        materializeLocalExportNodes(documentSnapshot, signal),
      fetcher: fetch,
      download: (blob, filename) => {
        signal.throwIfAborted()
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.download = filename
        link.href = objectUrl
        link.hidden = true
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      },
    })
  }

  const exportPdf = async (
    signal: AbortSignal,
    outputId = activeOutput?.id
  ) => {
    if (editor.imageCropSession) {
      throw new Error("Finish or cancel the image crop before exporting PDF.")
    }
    if (!commitActiveTextEditing()) {
      throw new Error("Finish text editing before exporting PDF.")
    }
    signal.throwIfAborted()
    if (!(await editor.flushActiveDraft(signal))) {
      throw new Error(
        "PDF export stopped because the current document is not durably saved."
      )
    }
    signal.throwIfAborted()
    const documentSnapshot = editor.getCurrentDocumentSnapshot()
    const exportOutput = documentSnapshot.outputs.find(
      (output) => output.id === outputId
    )
    if (!exportOutput || !exportOutput.exportFormats.includes("pdf")) {
      throw new Error("The selected output is not available for PDF export.")
    }
    const exportNodes = await materializeLocalExportNodes(
      documentSnapshot,
      signal
    )
    signal.throwIfAborted()
    const response = await fetch("/v1/studio/export-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outputId: exportOutput.id,
        document: { ...documentSnapshot, nodes: exportNodes },
      }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`PDF export failed (${response.status}).`)
    }
    const blob = await response.blob()
    signal.throwIfAborted()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.download = `${exportOutput.name.toLowerCase().replaceAll(" ", "-")}.pdf`
    link.href = objectUrl
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    return true
  }

  const exportDocumentJson = async () => {
    try {
      if (!commitActiveTextEditing()) return false
      if (!(await editor.flushActiveDraft())) {
        setCriticalActionError(
          "JSON export stopped because the current document is not durably saved."
        )
        return false
      }
      const documentSnapshot = editor.getCurrentDocumentSnapshot()
      const contents = JSON.stringify(documentSnapshot, null, 2)
      const objectUrl = URL.createObjectURL(
        new Blob([contents], { type: "application/json" })
      )
      const link = document.createElement("a")
      const slug =
        documentSnapshot.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "studio-document"
      link.download = `${slug}.studio.json`
      link.href = objectUrl
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      return true
    } catch (error) {
      setCriticalActionError(
        error instanceof Error ? error.message : "JSON export failed."
      )
      return false
    }
  }

  const selectExactMedia = useCallback(
    (intent: LibraryMediaIntent) => {
      void mediaPickerSession.executeExactSelection(intent.detail)
    },
    [mediaPickerSession.executeExactSelection]
  )

  const insertMediaFromAssets = useCallback(
    (intent: LibraryMediaIntent) => {
      mediaPickerSession.openAction({
        target: { type: "insert", pageId: activePage.id },
        presentation: "inline",
      })
      void mediaPickerSession.executeExactSelection(intent.detail)
    },
    [
      activePage.id,
      mediaPickerSession.executeExactSelection,
      mediaPickerSession.openAction,
    ]
  )

  const inlineMediaActionState =
    mediaPicker?.kind === "action" && mediaPicker.presentation === "inline"
      ? mediaPicker
      : null
  const inlineMediaBrowserVisible =
    assetMediaBrowserVisibility.desktop || assetMediaBrowserVisibility.compact
  const inlineMediaActionsEnabled =
    !editor.pendingChangeSet &&
    !editor.pendingGeneratedDocument &&
    !pendingQuotationRefresh &&
    !inlineMediaActionState?.pendingIdentity

  useEffect(() => {
    if (inlineMediaBrowserVisible || !inlineMediaActionState) return
    mediaPickerSession.close(false)
  }, [
    inlineMediaActionState,
    inlineMediaBrowserVisible,
    mediaPickerSession.close,
  ])

  const selectManagedRecoveryMedia = useCallback(
    (asset: ManagedMediaAsset) => {
      const current = mediaPickerSession.state
      if (!current || current.kind !== "recover-local") return false
      return editor.chooseManagedImageForLocalAsset(
        current.targetLocalAssetId,
        asset
      )
    },
    [editor.chooseManagedImageForLocalAsset, mediaPickerSession.state]
  )

  const resolveUploadedMediaDetail = useCallback(
    async (asset: ManagedMediaAsset, signal: AbortSignal) => {
      const result = await resolveManagedMediaCatalogUpload(asset, { signal })
      return result.status === "ready" ? result.detail : null
    },
    []
  )

  const applyBackgroundRemovalOutput = useCallback(
    async (nodeId: string, outputAssetId: string) => {
      const asset = await getManagedMedia(outputAssetId)
      if (!asset || asset.status !== "ready" || !asset.selectable) return false
      const resolved = await resolveManagedMediaCatalogUpload(
        { ...asset, status: "ready" },
        { signal: new AbortController().signal }
      )
      if (resolved.status !== "ready") return false
      const outcome = await editor.performLibraryMediaAction(
        {
          correlationId: `background-removal-apply-${crypto.randomUUID()}`,
          detail: resolved.detail,
          target: { type: "replace", pageId: activePage.id, nodeId },
        },
        { historyLabel: "Remove background" }
      )
      return outcome === "committed"
    },
    [activePage.id, editor.performLibraryMediaAction]
  )
  const selectedBackgroundRemovalImage =
    editor.selectedNodes.length === 1 &&
    editor.selectedNodes[0]?.type === "image"
      ? editor.selectedNodes[0]
      : null
  const backgroundRemoval = useBackgroundRemoval({
    enabled: backgroundRemovalEnabled,
    nodeId: selectedBackgroundRemovalImage?.id ?? null,
    sourceAssetId: selectedBackgroundRemovalImage?.assetId ?? null,
    sourceIsManaged: Boolean(
      selectedBackgroundRemovalImage &&
      managedMediaIdFromSource(selectedBackgroundRemovalImage.src) ===
        selectedBackgroundRemovalImage.assetId
    ),
    editable: inspectorCapabilityContext.documentEditable,
    applyOutput: applyBackgroundRemovalOutput,
  })

  const setManualZoom = (nextZoom: number) => zoomAtPoint(nextZoom)

  const updateNode = (nodeId: string, patch: Partial<SceneNode>) =>
    editor.updateNode(nodeId, patch)

  const startPanning = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editor.imageCropSession) return
    if (
      event.target instanceof Element &&
      event.target.closest("[data-editor-overlay-control='true']")
    ) {
      return
    }
    const shouldPan = tool === "hand" || spacePressed || event.button === 1
    if (!shouldPan) return
    event.preventDefault()
    event.stopPropagation()
    const workspace = event.currentTarget
    panSessionRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
    }
    workspace.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  const continuePanning = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    applyCamera({
      ...cameraRef.current,
      x: session.cameraX + event.clientX - session.clientX,
      y: session.cameraY + event.clientY - session.clientY,
    })
    setAutoFit(false)
  }

  const finishPanning = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panSessionRef.current = null
    settleCameraState(cameraRef.current)
    setIsPanning(false)
  }

  const saveNeedsAttention =
    editor.localSaveState.status === "failed" ||
    editor.localSaveState.status === "conflict" ||
    editor.localSaveState.status === "external_change"
  const saveHasWarning = editor.localSaveState.status === "session_only"
  const saveInProgress =
    criticalAction !== null ||
    editor.localSaveState.status === "opening" ||
    editor.localSaveState.status === "saving"
  const saveStatusLabel =
    criticalAction === "home"
      ? "Saving before Home…"
      : criticalAction === "export-json"
        ? "Preparing JSON…"
        : criticalAction === "import-json"
          ? "Importing document…"
          : criticalAction === "import-quotation"
            ? "Importing quotation…"
            : criticalAction === "export-png"
              ? "Preparing PNG…"
              : criticalAction === "export-pdf"
                ? "Preparing PDF…"
                : editor.localSaveState.status === "opening"
                  ? "Opening document storage…"
                  : editor.localSaveState.status === "saving"
                    ? "Saving locally…"
                    : editor.localSaveState.status === "failed"
                      ? "Local save failed"
                      : editor.localSaveState.status === "conflict"
                        ? "Save conflict"
                        : editor.localSaveState.status === "external_change"
                          ? editor.localSaveState.reason === "deleted_elsewhere"
                            ? "Deleted in another session"
                            : "Changed in another session"
                          : editor.localSaveState.status === "session_only"
                            ? "Session only"
                            : "All changes saved"
  const publishLabel =
    editor.publishSyncStatus === "syncing"
      ? "Publishing…"
      : editor.publishSyncStatus === "cancelling"
        ? "Stopping publication…"
        : editor.publishSyncStatus === "status_unknown"
          ? "Publication status unknown"
          : editor.publishSyncStatus === "error"
            ? "Publish sync failed"
            : editor.publishSyncStatus === "synced" &&
                editor.currentSnapshotPublishedVersion
              ? `Published v${editor.currentSnapshotPublishedVersion.version}`
              : "Publish"
  const studioErrors = [editor.assetError, editor.documentError].filter(
    (message): message is string => Boolean(message)
  )
  if (guideWorkspace.persistenceError) {
    studioErrors.push(guideWorkspace.persistenceError)
  }
  if (guideWorkspace.mutationError) {
    studioErrors.push(guideWorkspace.mutationError)
  }
  if (shellLayoutError) {
    studioErrors.push(shellLayoutError)
  }
  if (criticalActionError) {
    studioErrors.push(criticalActionError)
  }
  const pdfExportState =
    criticalActionLifecycle.status !== "idle" &&
    criticalActionLifecycle.action === "export-pdf"
      ? criticalActionLifecycle.status === "running" ||
        criticalActionLifecycle.status === "cancelling"
        ? "exporting"
        : criticalActionLifecycle.status === "failed" ||
            criticalActionLifecycle.status === "timed_out"
          ? "error"
          : "idle"
      : "idle"
  const reviewLocked = Boolean(
    editor.pendingChangeSet || editor.pendingGeneratedDocument
  )
  const quotationRefreshLocked = Boolean(pendingQuotationRefresh)
  const documentDecisionLocked = reviewLocked || quotationRefreshLocked
  const documentDecisionReason = quotationRefreshLocked
    ? "Accept or reject the pending Stuwiz refresh first."
    : editor.pendingGeneratedDocument
      ? "Create or discard the generated document first."
      : "Resolve or discard the review preview first."
  const cropLocked = Boolean(editor.imageCropSession)
  const outputBusy =
    criticalAction !== null ||
    pdfExportState === "exporting" ||
    documentDecisionLocked ||
    cropLocked

  const productCommandContext: ProductCommandRuntimeContext = {
    documentId: editor.document.id,
    snapshotId: editor.snapshotId,
    activePageId: activePage.id,
    activeOutputId: activeOutput?.id ?? null,
    pageIds: editor.document.pages.map((page) => page.id),
    outputIds: editor.document.outputs.map((output) => output.id),
    pdfOutputIds: editor.document.outputs
      .filter((output) => output.exportFormats.includes("pdf"))
      .map((output) => output.id),
    nodeIds: editor.document.nodes.map((node) => node.id),
    pageNodeCounts: Object.fromEntries(
      editor.document.pages.map((page) => [page.id, page.nodeIds.length])
    ),
    groupIds: editor.document.groups.map((group) => group.id),
    documentDisplayName: editor.document.name,
    pageDisplayNames: Object.fromEntries(
      editor.document.pages.map((page) => [page.id, page.name])
    ),
    outputDisplayNames: Object.fromEntries(
      editor.document.outputs.map((output) => [output.id, output.name])
    ),
    selection: editor.selection?.nodeIds.length
      ? {
          pageId: editor.selection.pageId,
          nodeIds: editor.selection.nodeIds,
          nodeTypes: editor.selectedNodes.map((node) => node.type),
          groupId: editor.selectedGroupId,
          anyLocked: editor.selectedNodes.some((node) => node.locked),
          allLocked: editor.selectedNodes.every((node) => node.locked),
          allVisible: editor.selectedNodes.every((node) => node.visible),
          allHidden: editor.selectedNodes.every((node) => !node.visible),
        }
      : null,
    activeTool: tool,
    editor: commandContext,
    mask: maskCommandCapabilities,
    structureByTarget: Object.fromEntries([
      ...editor.document.pages.map((page) => {
        const output = editor.document.outputs.find(
          (candidate) => candidate.id === page.outputId
        )
        return [
          page.id,
          {
            reviewPending: documentDecisionLocked,
            outputCount: editor.document.outputs.length,
            outputPageCount: output?.pageIds.length ?? 0,
            pageIndex: output?.pageIds.indexOf(page.id),
          },
        ] as const
      }),
      ...editor.document.outputs.map(
        (output) =>
          [
            output.id,
            {
              reviewPending: documentDecisionLocked,
              outputCount: editor.document.outputs.length,
              outputPageCount: output.pageIds.length,
            },
          ] as const
      ),
    ]),
    stateByCommandId: {
      ...projectGuideProductCommandState(guideWorkspace.preferences),
      "tool.select": {
        enabled: !cropLocked,
        disabledReason: cropLocked
          ? "Finish or cancel the active image crop before changing tools."
          : null,
      },
      "tool.hand": {
        enabled: !cropLocked,
        disabledReason: cropLocked
          ? "Finish or cancel the active image crop before changing tools."
          : null,
      },
      "document.home": {
        enabled:
          !cropLocked && !documentDecisionLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current Studio operation to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before going home."
            : documentDecisionLocked
              ? documentDecisionReason
              : null,
      },
      "document.export-json": {
        enabled: !cropLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current Studio operation to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before exporting."
            : null,
      },
      "document.import-json": {
        enabled:
          !cropLocked && !documentDecisionLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current Studio operation to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before importing."
            : documentDecisionLocked
              ? documentDecisionReason
              : null,
      },
      "document.import-quotation": {
        enabled:
          !cropLocked && !documentDecisionLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current Studio operation to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before importing."
            : documentDecisionLocked
              ? documentDecisionReason
              : null,
      },
      "output.export-png": {
        enabled: !outputBusy,
        disabledReason: outputBusy
          ? "Finish the active review, crop, or export first."
          : null,
      },
      "document.publish": {
        enabled:
          !cropLocked && !documentDecisionLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current Studio operation to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before publishing."
            : documentDecisionLocked
              ? documentDecisionReason
              : null,
      },
      "output.export-pdf": {
        enabled: !outputBusy,
        disabledReason: outputBusy
          ? "Finish the active review, crop, or export first."
          : null,
        label: activeOutput
          ? `${activeOutput.pageIds.length}-page PDF`
          : "Output PDF",
      },
      "arrange.forward": {
        enabled: editor.selectedNodes.length === 1,
        disabledReason:
          editor.selectedNodes.length === 1
            ? null
            : "Select one layer to move it forward one step.",
      },
      "arrange.backward": {
        enabled: editor.selectedNodes.length === 1,
        disabledReason:
          editor.selectedNodes.length === 1
            ? null
            : "Select one layer to move it backward one step.",
      },
    },
  }
  productCommandContextRef.current = productCommandContext

  // Product commands return synchronous dispatch acceptance. Critical async
  // actions claim the owner above before their first await; the status badge
  // and persistent error surface report their eventual outcome.
  const executeProductCommand = (
    invocation: ProductCommandInvocation
  ): boolean => {
    if (invocation.commandId === "mask.create") {
      if (
        invocation.target?.kind !== "selection" ||
        invocation.arguments?.kind !== "mask-create"
      ) {
        return false
      }
      return editor.createMaskGroup(
        invocation.arguments.sourceNodeIds,
        invocation.arguments.parentGroupId
      )
    }
    if (invocation.commandId === "mask.release") {
      return invocation.target?.kind === "group"
        ? editor.releaseMaskGroup(invocation.target.groupId)
        : false
    }
    if (
      invocation.commandId === "mask.type.vector" ||
      invocation.commandId === "mask.type.alpha" ||
      invocation.commandId === "mask.type.luminance"
    ) {
      if (invocation.target?.kind !== "group") return false
      const maskType = invocation.commandId.slice("mask.type.".length) as
        "vector" | "alpha" | "luminance"
      return editor.setMaskType(invocation.target.groupId, maskType)
    }
    if (invocation.commandId === "mask.sources.set") {
      if (
        invocation.target?.kind !== "group" ||
        invocation.arguments?.kind !== "mask-sources"
      ) {
        return false
      }
      return editor.setMaskSources(
        invocation.target.groupId,
        invocation.arguments.sourceNodeIds
      )
    }
    if (isEditorCommandId(invocation.commandId)) {
      return runEditorCommand(invocation.commandId)
    }
    if (isGuideProductCommandId(invocation.commandId)) {
      return executeGuideProductCommand(invocation.commandId, {
        preferences: guideWorkspace.preferences,
        setPreferences: guideWorkspace.setPreferences,
        openManager: () => {
          guideManagerTriggerRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
          rulerGuideOverlayRef.current?.cancelGuideDrag()
          setGuideManagerOpen(true)
        },
      })
    }

    switch (invocation.commandId) {
      case "document.home": {
        const action = "home" as const
        if (!claimCriticalAction(action)) return false
        if (!commitActiveTextEditing()) {
          releaseCriticalAction(action)
          return false
        }
        if (onHome) {
          setRouteTransitionPending(true)
          void Promise.resolve(onHome())
            .catch((error: unknown) => {
              setRouteTransitionPending(false)
              setCriticalActionError(
                error instanceof Error
                  ? error.message
                  : "Studio could not finish returning Home."
              )
            })
            .finally(() => releaseCriticalAction(action))
          return true
        }
        void editor
          .returnToStart()
          .then((returned) => {
            if (!returned) {
              setCriticalActionError(
                "Home was cancelled because the current document could not be safely saved."
              )
              return
            }
            setStartInitialFocus("document-library")
          })
          .catch((error: unknown) => {
            setRouteTransitionPending(false)
            setCriticalActionError(
              error instanceof Error
                ? error.message
                : "Studio could not finish returning Home."
            )
          })
          .finally(() => releaseCriticalAction(action))
        return true
      }
      case "document.new":
        setNewDocumentOpen(true)
        return true
      case "document.import-json":
        documentInputRef.current?.click()
        return true
      case "document.import-quotation":
        quotationInputRef.current?.click()
        return true
      case "document.export-json":
        return dispatchCriticalAction("export-json", exportDocumentJson)
      case "document.publish":
        setPublishDialogOpen(true)
        return true
      case "output.export-png":
        return dispatchCriticalAction(
          "export-png",
          ({ signal }) => exportPng(signal),
          {
            cancelable: true,
            timeoutMs: FOREGROUND_EXPORT_TIMEOUT_MS,
            timeoutMessage: "PNG export took too long. Nothing was downloaded.",
          }
        )
      case "output.export-pdf": {
        if (invocation.target?.kind !== "output") return false
        const outputId = invocation.target.outputId
        return dispatchCriticalAction(
          "export-pdf",
          ({ signal }) => exportPdf(signal, outputId),
          {
            cancelable: true,
            timeoutMs: FOREGROUND_EXPORT_TIMEOUT_MS,
            timeoutMessage: "PDF export took too long. Nothing was downloaded.",
          }
        )
      }
      case "developer.api-playground":
        setApiPlaygroundOpen(true)
        return true
      case "command.search":
        if (commandPaletteOpen) return false
        setCommandPaletteOpen(true)
        return true
      case "help.shortcuts":
        setShortcutReferenceOpen(true)
        return true
      case "object.rename": {
        const selected = editor.selectedNodes[0]
        if (editor.selectedNodes.length !== 1) return false
        setRenameLayerTarget({ nodeId: selected.id, name: selected.name })
        return true
      }
      case "object.visibility.toggle":
        editor.setSelectionVisible(
          editor.selectedNodes.every((node) => !node.visible)
        )
        return true
      case "object.lock.toggle":
        editor.setSelectionLocked(
          !editor.selectedNodes.every((node) => node.locked)
        )
        return true
      case "arrange.front":
        editor.reorderSelection("front")
        return true
      case "arrange.back":
        editor.reorderSelection("back")
        return true
      case "arrange.forward": {
        const selected = editor.selectedNodes[0]
        if (editor.selectedNodes.length !== 1) return false
        editor.reorderNode(selected.id, "forward")
        return true
      }
      case "arrange.backward": {
        const selected = editor.selectedNodes[0]
        if (editor.selectedNodes.length !== 1) return false
        editor.reorderNode(selected.id, "backward")
        return true
      }
      case "arrange.align":
        if (invocation.arguments?.kind !== "alignment") return false
        if (invocation.arguments.relativeTo === "page") {
          editor.alignSelectionToPage(invocation.arguments.alignment)
        } else {
          editor.alignSelection(invocation.arguments.alignment)
        }
        return true
      case "arrange.distribute":
        if (invocation.arguments?.kind !== "distribution") return false
        editor.distributeSelection(invocation.arguments.distribution)
        return true
      case "page.add": {
        const target = invocation.target
        const page =
          target?.kind === "page"
            ? editor.document.pages.find(
                (candidate) => candidate.id === target.pageId
              )
            : undefined
        if (!page) return false
        editor.addPage(page.outputId)
        return true
      }
      case "page.duplicate":
        if (invocation.target?.kind !== "page") return false
        editor.duplicatePage(invocation.target.pageId)
        return true
      case "page.update": {
        const target = invocation.target
        if (target?.kind !== "page") return false
        const page = editor.document.pages.find(
          (candidate) => candidate.id === target.pageId
        )
        if (!page) return false
        setStructureCommandDialog({
          kind: "rename-page",
          id: page.id,
          name: page.name,
        })
        return true
      }
      case "page.remove": {
        const target = invocation.target
        if (target?.kind !== "page") return false
        const page = editor.document.pages.find(
          (candidate) => candidate.id === target.pageId
        )
        if (!page) return false
        setStructureCommandDialog({
          kind: "delete-page",
          id: page.id,
          name: page.name,
          childCount: page.nodeIds.length,
        })
        return true
      }
      case "page.move-up":
      case "page.move-down": {
        const target = invocation.target
        if (target?.kind !== "page") return false
        const page = editor.document.pages.find(
          (candidate) => candidate.id === target.pageId
        )
        const output = page
          ? editor.document.outputs.find(
              (candidate) => candidate.id === page.outputId
            )
          : undefined
        if (!page || !output) return false
        const currentIndex = output.pageIds.indexOf(page.id)
        const direction = invocation.commandId === "page.move-up" ? -1 : 1
        editor.reorderPage(
          output.id,
          page.id,
          Math.max(
            0,
            Math.min(output.pageIds.length - 1, currentIndex + direction)
          )
        )
        return true
      }
      case "output.add":
        setStructureCommandDialog({ kind: "add-output" })
        return true
      case "output.update": {
        const target = invocation.target
        if (target?.kind !== "output") return false
        const output = editor.document.outputs.find(
          (candidate) => candidate.id === target.outputId
        )
        if (!output) return false
        setStructureCommandDialog({
          kind: "rename-output",
          id: output.id,
          name: output.name,
        })
        return true
      }
      case "output.remove": {
        const target = invocation.target
        if (target?.kind !== "output") return false
        const output = editor.document.outputs.find(
          (candidate) => candidate.id === target.outputId
        )
        if (!output) return false
        setStructureCommandDialog({
          kind: "delete-output",
          id: output.id,
          name: output.name,
          childCount: output.pageIds.length,
        })
        return true
      }
      default:
        return false
    }
  }

  executeProductCommandRef.current = executeProductCommand
  const productCommandRuntime = useMemo(
    () =>
      createProductCommandRuntime({
        getContext: () => {
          const context = productCommandContextRef.current
          if (!context) {
            throw new Error("Canonical command context is not ready yet.")
          }
          return context
        },
        execute: (invocation, context) =>
          executeProductCommandRef.current?.(invocation, context) === true,
      }),
    []
  )
  productCommandRunnerRef.current = productCommandRuntime.run
  const homeCommand = productCommandRuntime.resolve({
    commandId: "document.home",
  })
  const productMenus = buildProductAppMenus(productCommandContext)
  const canvasContextMenuGroups = buildCanvasContextMenu(productCommandContext)
  const productFileMenu = productMenus.find((menu) => menu.id === "file")
  const productDocumentMenuGroups =
    productFileMenu?.groups.filter((group) => group.id === "document") ?? []
  const productExportMenuGroups =
    productFileMenu?.groups
      .filter((group) => group.id === "export")
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.type !== "command" ||
            item.command.invocation.commandId.startsWith("output.export-")
        ),
      })) ?? []
  const productMenuRuntime = useMemo<ProductCommandMenuRuntime>(
    () => ({
      run: productCommandRuntime.run,
      shortcut: (commandId) =>
        formatProductCommandShortcut(commandId, shortcutPlatform),
    }),
    [productCommandRuntime, shortcutPlatform]
  )
  const commandPaletteItems: readonly StudioCommandPaletteItem[] =
    projectProductCommandPalette(productCommandContext, shortcutPlatform).map(
      (command) => ({
        id: productCommandInvocationKey(command.invocation),
        label: command.label,
        category: command.categoryLabel,
        keywords: command.definition.keywords,
        shortcut: command.shortcut,
        enabled: command.enabled,
        disabledReason: command.disabledReason,
        checked: command.checked,
        run: () =>
          productCommandRuntime.run(command.invocation).status === "accepted",
      })
    )

  const separateDraftTransitionPending =
    editor.sessionMode === "workspace" &&
    replacementRunning &&
    pendingDraftReplacement === null

  if (routeTransitionPending || separateDraftTransitionPending) {
    return (
      <main
        aria-busy="true"
        className="grid min-h-dvh place-items-center bg-muted/20"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>
            {routeTransitionPending
              ? "Opening the document route…"
              : "Creating the new document…"}
          </span>
        </div>
      </main>
    )
  }

  if (
    routeDocumentId &&
    (editor.routeSessionStatus === "installing" ||
      editor.sessionMode !== "workspace" ||
      editor.document.id !== routeDocumentId)
  ) {
    if (editor.routeSessionStatus === "failed") {
      return (
        <main className="grid min-h-dvh place-items-center bg-muted/20 p-4">
          <section
            aria-labelledby="route-session-error-heading"
            className="w-full max-w-sm border bg-background p-5 text-center shadow-sm"
            role="alert"
          >
            <h1
              className="text-base font-semibold"
              id="route-session-error-heading"
              tabIndex={-1}
            >
              Studio could not start this document
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {editor.documentError ??
                "The verified document could not acquire a local editing session."}
            </p>
            {onHome ? (
              <Button className="mt-4" onClick={() => void onHome()}>
                Return to documents
              </Button>
            ) : null}
          </section>
        </main>
      )
    }
    return (
      <main
        aria-busy="true"
        className="grid min-h-dvh place-items-center bg-muted/20"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>Starting the verified document session…</span>
        </div>
      </main>
    )
  }

  if (editor.sessionMode === "start") {
    if (editor.startModel.status === "opening") {
      return (
        <main
          aria-busy="true"
          className="grid min-h-dvh place-items-center bg-muted/20"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            <span>Opening your Studio documents…</span>
          </div>
        </main>
      )
    }
    if (editor.startModel.status === "recovery_required") {
      return (
        <main className="grid min-h-dvh place-items-center bg-muted/20">
          <p className="text-sm text-muted-foreground">
            Studio is waiting for draft recovery.
          </p>
          <Suspense fallback={null}>
            <DraftRecoveryDialog
              recovery={editor.draftRecovery}
              notice={editor.draftRecoveryNotice}
              onDownload={editor.downloadDraftRecovery}
              onRetry={editor.retryDraftRecovery}
              onReset={editor.resetDraftRecovery}
            />
          </Suspense>
        </main>
      )
    }

    return (
      <>
        <CriticalActionStatus
          lifecycle={criticalActionLifecycle}
          onCancel={() => void cancelCriticalAction()}
          onRetry={() => void retryCriticalAction()}
        />
        <StudioStartSurface
          actionError={
            routeNotice ?? criticalActionError ?? editor.documentError
          }
          hasQuotationSource={Boolean(editor.quotationSource)}
          initialFocus={startInitialFocus}
          model={editor.startModel}
          onDismissActionError={
            routeNotice && onDismissRouteNotice
              ? () => void onDismissRouteNotice()
              : undefined
          }
          pendingIntent={startPendingIntent}
          templateActionError={editor.templateActionError}
          onCreateBlank={() => setNewDocumentOpen(true)}
          onCreateFromTemplate={(template) => {
            void requestDraftReplacement(
              {
                kind: "template",
                templateId: template.id,
                version: template.version,
              },
              "Starting from the selected template",
              () => createFromLibraryTemplate(template)
            )
          }}
          onImportFile={async (file) =>
            (await requestDraftReplacement(
              { kind: "import" },
              "Opening the selected Studio JSON file",
              () => runOwnedStartImport(file)
            )) !== false
          }
          onOpenDocument={onOpenDocument ?? editor.openStoredDocument}
          onOpenSample={() => {
            void requestDraftReplacement(
              { kind: "sample" },
              "Opening the Northstar sample",
              editor.restoreDemoDocument
            )
          }}
        />
        {newDocumentOpen ? (
          <Suspense fallback={null}>
            <NewDocumentDialog
              open
              starterMetadata={editor.starterMetadata}
              onCreateBlank={(options) =>
                requestDraftReplacement(
                  { kind: "blank" },
                  `Creating “${options.name}”`,
                  () => editor.createBlankDocument(options)
                )
              }
              onCreated={finishOpenedSession}
              onOpenChange={setNewDocumentOpen}
              onRestoreDemo={() =>
                requestDraftReplacement(
                  { kind: "sample" },
                  "Opening the Northstar sample",
                  editor.restoreDemoDocument
                )
              }
            />
          </Suspense>
        ) : null}
        {pendingDraftReplacement ? (
          <Suspense fallback={null}>
            <ReplaceCurrentDraftDialog
              documentName={editor.document.name}
              error={editor.documentError}
              nextActionLabel={pendingDraftReplacement.nextActionLabel}
              open
              replacing={replacementRunning}
              sessionOnly={editor.localSaveState.status === "session_only"}
              onCancel={cancelDraftReplacement}
              onDownload={() => {
                if (commitActiveTextEditing()) editor.downloadCurrentVersion()
              }}
              onReplace={() => void confirmDraftReplacement()}
            />
          </Suspense>
        ) : null}
      </>
    )
  }

  const workspace = (
    <Sheet
      open={compactPanel !== null}
      onOpenChange={(open) => {
        if (!open) setCompactPanel(null)
      }}
    >
      <CriticalActionStatus
        lifecycle={criticalActionLifecycle}
        onCancel={() => void cancelCriticalAction()}
        onRetry={() => void retryCriticalAction()}
      />
      <main
        aria-hidden={compactPanel !== null ? true : undefined}
        inert={compactPanel !== null ? true : undefined}
        className="flex h-dvh min-h-dvh w-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic>
          {shellLayoutError ?? ""}
        </p>
        <header className="flex h-(--studio-topbar-height) min-w-0 shrink-0 items-center gap-1 border-b border-border bg-editor-panel px-2 min-[1280px]:gap-2 min-[1280px]:px-3">
          <button
            aria-label="Go to Studio home"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-[1280px]:w-60 min-[1280px]:flex-none min-[1280px]:gap-2.5"
            disabled={!homeCommand.enabled}
            title={homeCommand.disabledReason ?? "Studio home"}
            type="button"
            onClick={() => {
              productCommandRuntime.run({ commandId: "document.home" })
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <StudioMark className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-col leading-none">
              <span className="truncate text-sm font-medium">
                {editor.document.name}
              </span>
              <span className="mt-1 truncate text-[11px] leading-none text-muted-foreground">
                Template · Revision {editor.document.revision}
              </span>
            </div>
          </button>

          <Separator
            className="hidden min-[640px]:block"
            orientation="vertical"
          />
          <div className="hidden shrink-0 min-[1600px]:block">
            <ProductCommandMenubar
              menus={productMenus}
              runtime={productMenuRuntime}
            />
          </div>
          <Separator
            className="hidden min-[1600px]:block"
            orientation="vertical"
          />
          <div
            aria-label="Canvas tools"
            className="hidden shrink-0 items-center gap-0.5 min-[640px]:flex"
            role="toolbar"
          >
            <IconButton
              label="Select"
              shortcut="V"
              aria-pressed={tool === "select"}
              className="size-11 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85 min-[1280px]:size-7"
              disabled={!commandEnabled("tool.select")}
              variant="ghost"
              onClick={() => runEditorCommand("tool.select")}
            >
              <MousePointer2 />
            </IconButton>
            <IconButton
              label="Hand tool"
              shortcut="H"
              aria-pressed={tool === "hand"}
              className="size-11 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85 min-[1280px]:size-7"
              disabled={!commandEnabled("tool.hand")}
              variant="ghost"
              onClick={() => runEditorCommand("tool.hand")}
            >
              <Hand />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Add text"
                  title="Add text (T inserts body text)"
                  className="size-11 min-[1280px]:size-7"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!commandEnabled("object.add-text")}
                >
                  <Type />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-72"
                onCloseAutoFocus={restoreTextEditingAfterMenuClose}
              >
                <DropdownMenuLabel>Text styles</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <TextPresetMenuItems
                    disabled={!commandEnabled("object.add-text")}
                    onSelect={(presetId) =>
                      insertTextPreset(presetId, {
                        deferEditingUntilMenuClose: true,
                      })
                    }
                  />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={insertShapeTriggerRef}
                  aria-label="Insert shape"
                  title="Insert shape"
                  className="size-11 min-[1280px]:size-7"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!commandEnabled("object.add-rectangle")}
                >
                  <Shapes />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Add to canvas</DropdownMenuLabel>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    onSelect={() => runEditorCommand("object.add-rectangle")}
                  >
                    <Square />
                    Rectangle
                    <DropdownMenuShortcut>R</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    onSelect={() => runEditorCommand("object.add-ellipse")}
                  >
                    <Circle />
                    Ellipse
                    <DropdownMenuShortcut>O</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    onSelect={() => runEditorCommand("object.add-line")}
                  >
                    <Minus />
                    Line
                    <DropdownMenuShortcut>L</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    disabled={Boolean(
                      editor.pendingChangeSet || pendingQuotationRefresh
                    )}
                    onSelect={() =>
                      editor.addIcon({
                        name: "Heart icon",
                        path: HEART_ICON_PATH,
                        viewBox: "0 0 24 24",
                      })
                    }
                  >
                    <Heart />
                    Heart icon
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    disabled={
                      editor.isImportingAsset ||
                      Boolean(
                        editor.pendingChangeSet || pendingQuotationRefresh
                      )
                    }
                    onSelect={() =>
                      openMediaPicker(
                        "uploads",
                        undefined,
                        insertShapeTriggerRef.current
                      )
                    }
                  >
                    <ImagePlus />
                    {editor.isImportingAsset
                      ? "Adding image…"
                      : "Upload image…"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 min-[1280px]:min-h-0"
                    disabled={Boolean(editor.pendingChangeSet)}
                    onSelect={() =>
                      openMediaPicker(
                        "library",
                        undefined,
                        insertShapeTriggerRef.current
                      )
                    }
                  >
                    <Images />
                    Asset library…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={documentInputRef}
              aria-hidden="true"
              hidden
              tabIndex={-1}
              name="document-json-import"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file && commitActiveTextEditing()) {
                  dispatchCriticalAction(
                    "import-json",
                    async ({ signal }) => {
                      if (!(await editor.importDocumentFile(file, signal))) {
                        throw new Error(
                          "The document import did not complete. Review the file issue and retry when it is corrected."
                        )
                      }
                    },
                    {
                      cancelable: true,
                      timeoutMs: FOREGROUND_IMPORT_TIMEOUT_MS,
                      timeoutMessage:
                        "Document import took too long. The current document was not changed.",
                      cancelMessage:
                        "Document import cancelled. The current document was not changed.",
                    }
                  )
                }
                event.currentTarget.value = ""
              }}
            />
            <input
              ref={quotationInputRef}
              aria-hidden="true"
              hidden
              tabIndex={-1}
              name="quotation-json-import"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file && commitActiveTextEditing()) {
                  dispatchCriticalAction(
                    "import-quotation",
                    async ({ signal }) => {
                      if (!(await editor.importQuotationFile(file, signal))) {
                        throw new Error(
                          "The quotation import did not complete. Review the file issue and retry when it is corrected."
                        )
                      }
                    },
                    {
                      cancelable: true,
                      timeoutMs: FOREGROUND_IMPORT_TIMEOUT_MS,
                      timeoutMessage:
                        "Quotation import took too long. The current document was not changed.",
                      cancelMessage:
                        "Quotation import cancelled. The current document was not changed.",
                    }
                  )
                }
                event.currentTarget.value = ""
              }}
            />
          </div>
          <Separator
            className="hidden min-[860px]:block"
            orientation="vertical"
          />
          <div
            aria-label="History"
            className="hidden shrink-0 items-center gap-0.5 min-[860px]:flex"
            role="group"
          >
            <IconButton
              label="Undo"
              shortcut="⌘Z"
              className="size-11 min-[1280px]:size-7"
              disabled={!commandEnabled("history.undo")}
              onClick={() => runEditorCommand("history.undo")}
            >
              <Undo2 />
            </IconButton>
            <IconButton
              label="Redo"
              shortcut="⇧⌘Z"
              className="size-11 min-[1280px]:size-7"
              disabled={!commandEnabled("history.redo")}
              onClick={() => runEditorCommand("history.redo")}
            >
              <Redo2 />
            </IconButton>
          </div>

          {editor.selection?.nodeIds.length ? (
            <>
              <Separator
                className="hidden min-[1280px]:block"
                orientation="vertical"
              />
              <div
                aria-label="Selection actions"
                className="hidden items-center gap-0.5 min-[1280px]:flex"
                role="toolbar"
              >
                <IconButton
                  label="Copy"
                  shortcut="⌘C"
                  disabled={!commandEnabled("selection.copy")}
                  onClick={() => runEditorCommand("selection.copy")}
                >
                  <ClipboardCopy />
                </IconButton>
                <IconButton
                  label="Duplicate"
                  shortcut="⌘D"
                  disabled={!commandEnabled("object.duplicate")}
                  onClick={() => runEditorCommand("object.duplicate")}
                >
                  <CopyPlus />
                </IconButton>
                <IconButton
                  label="Group selection"
                  shortcut="⌘G"
                  disabled={!commandEnabled("object.group")}
                  onClick={() => runEditorCommand("object.group")}
                >
                  <Group />
                </IconButton>
                <IconButton
                  label="Ungroup selection"
                  shortcut="⇧⌘G"
                  disabled={!commandEnabled("object.ungroup")}
                  onClick={() => runEditorCommand("object.ungroup")}
                >
                  <Ungroup />
                </IconButton>
                <IconButton
                  label="Delete"
                  shortcut="⌫"
                  disabled={!commandEnabled("object.delete")}
                  onClick={() => runEditorCommand("object.delete")}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </>
          ) : null}

          {editor.canPaste ? (
            <IconButton
              label="Paste"
              shortcut="⌘V"
              className="hidden min-[1280px]:inline-flex"
              disabled={!commandEnabled("object.paste")}
              onClick={() => runEditorCommand("object.paste")}
            >
              <ClipboardPaste />
            </IconButton>
          ) : null}

          <div className="flex shrink-0 items-center gap-1 min-[1280px]:ml-auto min-[1280px]:gap-2">
            {pendingQuotationRefresh ? (
              <Button
                size="sm"
                variant="outline"
                className="h-11 min-[1280px]:h-8"
                onClick={() => setQuotationRefreshOpen(true)}
              >
                <DatabaseZap data-icon="inline-start" />
                <span className="hidden min-[1040px]:inline">
                  Review Stuwiz update
                </span>
                <Badge variant="secondary">
                  {pendingQuotationRefresh.base.sourceRevision}
                  <ArrowRight aria-hidden="true" />
                  {pendingQuotationRefresh.incoming.sourceRevision}
                </Badge>
              </Button>
            ) : null}
            <Badge
              variant={saveNeedsAttention ? "destructive" : "outline"}
              className="hidden max-w-40 truncate font-normal text-muted-foreground min-[1280px]:inline-flex"
              role="status"
              aria-live="polite"
            >
              {saveNeedsAttention || saveHasWarning ? (
                <AlertTriangle data-icon="inline-start" />
              ) : saveInProgress ? (
                <Cloud data-icon="inline-start" />
              ) : (
                <Check data-icon="inline-start" />
              )}
              {saveStatusLabel}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="hidden h-11 min-[940px]:inline-flex min-[1280px]:h-8"
              disabled={
                cropLocked || documentDecisionLocked || criticalAction !== null
              }
              onClick={() => setPublishDialogOpen(true)}
            >
              <Send data-icon="inline-start" />
              {publishLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="hidden h-11 min-[1100px]:inline-flex min-[1280px]:h-8"
              onClick={() => setApiPlaygroundOpen(true)}
            >
              <Code2 data-icon="inline-start" />
              API playground
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Document file actions"
                  className="hidden min-[1280px]:inline-flex"
                  size="icon-sm"
                  variant="outline"
                >
                  <FileJson2 />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Studio document</DropdownMenuLabel>
                <ProductCommandDropdownItems
                  groups={productDocumentMenuGroups}
                  runtime={productMenuRuntime}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="hidden h-11 min-[768px]:inline-flex min-[1280px]:h-8"
                  size="sm"
                  disabled={outputBusy}
                  aria-label="Export output"
                >
                  <Download data-icon="inline-start" />
                  {pdfExportState === "exporting"
                    ? "Exporting…"
                    : pdfExportState === "error"
                      ? "Export failed"
                      : "Export"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  {activeOutput?.name ?? "Current output"}
                </DropdownMenuLabel>
                <ProductCommandDropdownItems
                  groups={productExportMenuGroups}
                  runtime={productMenuRuntime}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={studioMoreActionsTriggerRef}
                  aria-label={
                    studioErrors.length ||
                    saveNeedsAttention ||
                    saveHasWarning ||
                    pdfExportState === "error"
                      ? "More studio actions, attention required"
                      : "More studio actions"
                  }
                  className="relative size-11 min-[1280px]:size-8"
                  size="icon-sm"
                  variant="outline"
                >
                  <MoreHorizontal />
                  {studioErrors.length ||
                  saveNeedsAttention ||
                  saveHasWarning ||
                  pdfExportState === "error" ? (
                    <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[min(18rem,calc(100vw-1rem))]"
                onCloseAutoFocus={restoreTextEditingAfterMenuClose}
              >
                <DropdownMenuLabel>Document status</DropdownMenuLabel>
                <div
                  className="space-y-1 px-1.5 py-1.5 text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2">
                    {studioErrors.length ||
                    saveNeedsAttention ||
                    saveHasWarning ||
                    pdfExportState === "error" ? (
                      <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                    ) : saveInProgress ? (
                      <Cloud className="size-3.5 shrink-0" />
                    ) : (
                      <Check className="size-3.5 shrink-0" />
                    )}
                    <span>{saveStatusLabel}</span>
                  </div>
                  {editor.localSaveState.status === "failed" ||
                  editor.localSaveState.status === "session_only" ? (
                    <p className="break-words">
                      {editor.localSaveState.message}
                    </p>
                  ) : editor.localSaveState.status === "conflict" ? (
                    <p className="break-words">
                      Download your version before choosing which copy to keep.
                    </p>
                  ) : editor.localSaveState.status === "external_change" ? (
                    <p className="break-words">
                      Your open version is unchanged. Download it before
                      reloading or editing if you need to preserve this copy.
                    </p>
                  ) : null}
                  {studioErrors.map((message) => (
                    <p key={message} className="break-words text-destructive">
                      {message}
                    </p>
                  ))}
                  {pdfExportState === "error" ? (
                    <p className="text-destructive">
                      Export failed. Check the document assets and try again.
                    </p>
                  ) : null}
                </div>
                {editor.localSaveState.status === "failed" &&
                editor.localSaveState.retryable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void editor.retryActiveDraftSave()}
                    >
                      Retry local save
                    </DropdownMenuItem>
                  </>
                ) : null}
                {saveNeedsAttention || saveHasWarning ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        if (commitActiveTextEditing()) {
                          editor.downloadCurrentVersion()
                        }
                      }}
                    >
                      Download my version
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="min-[640px]:hidden">
                  Text styles
                </DropdownMenuLabel>
                <div className="min-[640px]:hidden">
                  <TextPresetMenuItems
                    compactTargets
                    disabled={!commandEnabled("object.add-text")}
                    onSelect={(presetId) =>
                      insertTextPreset(presetId, {
                        deferEditingUntilMenuClose: true,
                      })
                    }
                  />
                  <DropdownMenuSeparator />
                </div>
                <ResponsiveProductCommandDropdownGroups
                  menus={productMenus}
                  runtime={productMenuRuntime}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {editor.mountedMediaRecoveryReconciliation.status === "checking" ||
        editor.mountedMediaRecoveryReconciliation.status === "error" ? (
          <section
            aria-label="Interrupted image recovery"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-500/8 px-3 py-2 text-xs"
          >
            {editor.mountedMediaRecoveryReconciliation.status === "checking" ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-amber-700" />
            )}
            <p className="min-w-48 flex-1 leading-5" role="status">
              {editor.mountedMediaRecoveryReconciliation.status === "checking"
                ? "Checking interrupted image recovery…"
                : (editor.mountedMediaRecoveryReconciliation.message ??
                  "Studio could not finish checking interrupted image recovery.")}
            </p>
            {editor.mountedMediaRecoveryReconciliation.status === "error" ? (
              <Button
                className="h-9"
                size="sm"
                type="button"
                onClick={editor.retryMountedMediaRecoveryReconciliation}
              >
                Retry
              </Button>
            ) : null}
          </section>
        ) : null}

        {editor.documentMediaAdmission &&
        (editor.documentMediaAdmission.receipt !== null ||
          editor.documentMediaAdmission.status === "receipt_pending" ||
          editor.documentMediaAdmission.status === "deferred" ||
          editor.documentMediaAdmission.unresolved.length > 0) ? (
          <section
            aria-label="Document image recovery"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-500/8 px-3 py-2 text-xs"
          >
            <AlertTriangle className="size-4 shrink-0 text-amber-700" />
            <p className="min-w-48 flex-1 leading-5" role="status">
              {editor.documentMediaAdmission.receipt
                ? (() => {
                    const aliases =
                      editor.documentMediaAdmission.receipt.aliases
                    const archived = aliases.filter(
                      (alias) => alias.managedStatus === "archived"
                    ).length
                    const ready = aliases.length - archived
                    return ready === 0
                      ? `Recovered ${archived} Studio ${archived === 1 ? "backup" : "backups"}. Review the affected uses before keeping or restoring this version.`
                      : archived === 0
                        ? `Recovered ${ready} Studio ${ready === 1 ? "image" : "images"}. Review the affected uses before keeping or restoring this version.`
                        : `Recovered ${ready} Studio ${ready === 1 ? "image" : "images"} and ${archived} ${archived === 1 ? "backup" : "backups"}. Review the affected uses before keeping or restoring this version.`
                  })()
                : (editor.documentMediaAdmission.message ??
                  `${editor.documentMediaAdmission.aliasCount} document images need review.`)}
            </p>
            <Button
              className="h-9"
              size="sm"
              type="button"
              variant="outline"
              onClick={(event) => {
                openMediaPicker(
                  "uploads",
                  undefined,
                  event.currentTarget,
                  "document images"
                )
              }}
            >
              Review document images
            </Button>
            {editor.documentMediaAdmission.receipt ? (
              <>
                {documentMediaAdmissionActionModel(
                  editor.documentMediaAdmission.receipt.restoredAt,
                  editor.documentMediaAdmissionRestoreUnavailable
                ).showRestore ? (
                  <Button
                    className="h-9"
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => void editor.restoreDocumentMediaAdmission()}
                  >
                    Restore device-only version
                  </Button>
                ) : null}
                <Button
                  className="h-9"
                  size="sm"
                  type="button"
                  onClick={() => void editor.keepDocumentMediaAdmission()}
                >
                  {
                    documentMediaAdmissionActionModel(
                      editor.documentMediaAdmission.receipt.restoredAt,
                      editor.documentMediaAdmissionRestoreUnavailable
                    ).keepLabel
                  }
                </Button>
                {documentMediaAdmissionActionModel(
                  editor.documentMediaAdmission.receipt.restoredAt,
                  editor.documentMediaAdmissionRestoreUnavailable
                ).showPreservation ? (
                  <>
                    <Button
                      className="h-9"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={editor.downloadDocumentMediaAdmissionPreimage}
                    >
                      Download device-only version
                    </Button>
                    <Button
                      className="h-9"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void editor.saveDocumentMediaAdmissionPreimageAsCopy()
                      }
                    >
                      Save device-only version as a copy
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        <div
          ref={installDesktopShellElement}
          className="relative flex min-h-0 min-w-0 flex-1"
          data-desktop-shell-layout={
            resolvedShellLayout.canUseDesktopLayout ? "adjustable" : "compact"
          }
        >
          {!shellLayout.leftPanel.collapsed ? (
            <>
              <div
                id="studio-document-panel"
                className="hidden min-h-0 shrink-0 min-[1280px]:block"
                style={{ width: resolvedShellLayout.leftPanelWidth }}
              >
                <QuotationSidebar
                  className="size-full border-r-0"
                  document={editor.document}
                  activePageId={editor.activePageId}
                  selection={editor.selection}
                  activeTemplate={editor.activeDesignTemplate}
                  hasQuotationSource={Boolean(editor.quotationSource)}
                  templateActionError={editor.templateActionError}
                  layerOrganizationUpgradeAvailable={
                    editor.quotationGroupOrganization.status === "available"
                  }
                  reviewPending={Boolean(
                    editor.pendingChangeSet || pendingQuotationRefresh
                  )}
                  activePanel={documentPanelTab}
                  onActivePanelChange={setDocumentPanelTab}
                  templateBrowserVisible={templateBrowserVisibility.desktop}
                  onLayerOrganizationUpgrade={() => {
                    if (!commitActiveTextEditing()) return
                    if (editor.upgradeQuotationLayerOrganization()) {
                      setDocumentPanelTab("layers")
                    }
                  }}
                  onCreateFromTemplate={async (template) =>
                    (await requestNewDraft(
                      {
                        kind: "template",
                        templateId: template.id,
                        version: template.version,
                      },
                      "Starting from the selected template",
                      () => createFromLibraryTemplate(template)
                    )) !== false
                  }
                  onResolveApplyTemplate={async (template) => {
                    if (!commitActiveTextEditing()) return null
                    return editor.resolveApplyLibraryTemplate(template)
                  }}
                  onConfirmApplyTemplate={async (resolved) => {
                    const applied =
                      await editor.confirmApplyLibraryTemplate(resolved)
                    if (applied) {
                      setAutoFit(true)
                    }
                    return applied
                  }}
                  onCancelTemplateAction={editor.cancelLibraryTemplateAction}
                  onSelectionChange={editor.setLayerSelection}
                  onFocusNode={focusNode}
                  onHoverNode={setHoveredNodeId}
                  onRenameNode={editor.renameLayerNode}
                  onRenameGroup={editor.updateGroup}
                  onUpdateLayerNodes={editor.updateLayerNodes}
                  onMoveLayer={editor.moveLayer}
                  onDeleteLayerNodes={editor.deleteLayerNodes}
                  canCreateComponentFromSelection={Boolean(
                    editor.selectedGroupId || editor.selectedNodes.length >= 2
                  )}
                  onCreateComponentFromSelection={createComponentFromSelection}
                  onInsertComponent={insertComponent}
                  onFocusComponentSource={focusComponentSource}
                  assetWorkspaceView={assetWorkspaceView}
                  mediaBrowserVisible={assetMediaBrowserVisibility.desktop}
                  mediaScope={assetMediaScope}
                  mediaPendingIdentity={
                    inlineMediaActionState?.pendingIdentity ?? null
                  }
                  mediaActionError={inlineMediaActionState?.actionError ?? null}
                  mediaActionsEnabled={inlineMediaActionsEnabled}
                  onAssetWorkspaceViewChange={setAssetWorkspaceView}
                  onMediaScopeChange={setAssetMediaScope}
                  onMediaSelect={insertMediaFromAssets}
                  productCommandContext={productCommandContext}
                  productCommandRuntime={productMenuRuntime}
                  onSelectPage={editor.selectPage}
                  onAddPage={editor.addPage}
                  onDuplicatePage={editor.duplicatePage}
                  onUpdatePage={editor.updatePage}
                  onRemovePage={editor.removePage}
                  onReorderPage={editor.reorderPage}
                  onAddOutput={editor.addOutput}
                  onUpdateOutput={editor.updateOutput}
                  onRemoveOutput={editor.removeOutput}
                />
              </div>
              <EditorPanelSplitter
                className="hidden min-[1280px]:block"
                controlsId="studio-document-panel"
                label="Resize document panel"
                value={leftShellResizeBounds.value}
                minValue={leftShellResizeBounds.minimum}
                maxValue={leftShellResizeBounds.maximum}
                disabled={leftShellResizeBounds.disabled}
                resizeDirection="right"
                onResize={(width) => previewShellPanelWidth("left", width)}
                onResizeEnd={(width) => commitShellPanelWidth("left", width)}
                onToggleCollapse={() => toggleShellPanel("left", true)}
              />
            </>
          ) : null}

          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-workspace min-[1280px]:min-w-[520px]">
            <EditorPanelHeader className="bg-editor-panel/92 backdrop-blur-sm">
              <IconButton
                label="Open document panel"
                className="mr-1 size-11 min-[1280px]:hidden"
                aria-controls="compact-document-panel"
                aria-expanded={compactPanel === "document"}
                onClick={(event) => {
                  compactPanelTriggerRef.current = event.currentTarget
                  setCompactPanel("document")
                }}
              >
                <Layers3 />
              </IconButton>
              <IconButton
                ref={leftPanelToggleRef}
                label={
                  shellLayout.leftPanel.collapsed
                    ? "Expand document panel"
                    : "Collapse document panel"
                }
                className="mr-1 hidden size-7 min-[1280px]:inline-flex"
                aria-controls={
                  shellLayout.leftPanel.collapsed
                    ? undefined
                    : "studio-document-panel"
                }
                aria-expanded={!shellLayout.leftPanel.collapsed}
                onClick={() => toggleShellPanel("left")}
              >
                {shellLayout.leftPanel.collapsed ? (
                  <PanelLeftOpen />
                ) : (
                  <PanelLeftClose />
                )}
              </IconButton>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-medium">
                  {activePage.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {activePage.width} × {activePage.height}
                </span>
              </div>
              {editor.selectedNodes.length ? (
                <div
                  className="ml-auto hidden min-w-0 items-center gap-1.5 rounded-md bg-studio-accent/8 px-2 py-1 min-[640px]:flex"
                  role="status"
                  aria-live="polite"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-studio-accent" />
                  <span className="max-w-64 truncate text-[11px] font-medium text-foreground">
                    {editor.selectedNodes.length === 1
                      ? editor.selectedNodes[0]?.name
                      : `${editor.selectedNodes.length} layers selected`}
                  </span>
                </div>
              ) : null}
              <IconButton
                ref={rightPanelToggleRef}
                label={
                  shellLayout.rightPanel.collapsed
                    ? "Expand properties panel"
                    : "Collapse properties panel"
                }
                className={cn(
                  "hidden size-7 min-[1280px]:inline-flex",
                  !editor.selectedNodes.length && "ml-auto"
                )}
                aria-controls={
                  shellLayout.rightPanel.collapsed
                    ? undefined
                    : "studio-properties-panel"
                }
                aria-expanded={!shellLayout.rightPanel.collapsed}
                onClick={() => toggleShellPanel("right")}
              >
                {shellLayout.rightPanel.collapsed ? (
                  <PanelRightOpen />
                ) : (
                  <PanelRightClose />
                )}
              </IconButton>
              <IconButton
                label="Open properties"
                className="ml-auto size-11 min-[1280px]:hidden"
                aria-controls="compact-inspector-panel"
                aria-expanded={compactPanel === "inspector"}
                onClick={(event) => {
                  compactPanelTriggerRef.current = event.currentTarget
                  setCompactPanel("inspector")
                }}
              >
                <SlidersHorizontal />
              </IconButton>
            </EditorPanelHeader>
            {!editor.imageCropSession &&
            selectedImage &&
            selectedImageToolbarPlacement?.mode === "docked" ? (
              <div className="relative z-30 flex shrink-0 justify-center border-b bg-editor-panel p-1">
                <SelectedImageToolbar
                  image={selectedImage}
                  className="max-w-full shadow-sm"
                  onRunCommand={runEditorCommand}
                  isCommandEnabled={commandEnabled}
                />
              </div>
            ) : null}
            {!editor.imageCropSession &&
            textEditingState &&
            textFormattingToolbarPlacement?.mode === "docked" ? (
              <div className="relative z-30 flex shrink-0 justify-center border-b bg-editor-panel p-1">
                <TextFormattingToolbar
                  state={textEditingState}
                  className="max-w-full shadow-sm"
                  onApply={(patch) => {
                    applyActiveTextEditingStyle(patch)
                  }}
                  onEditLink={openTextLinkEditor}
                />
              </div>
            ) : null}
            <ProductCommandContextMenu
              groups={canvasContextMenuGroups}
              runtime={productMenuRuntime}
            >
              <div
                ref={installWorkspaceElement}
                aria-label="Canvas viewport"
                className={`relative min-h-0 flex-1 overflow-hidden overscroll-contain bg-workspace ${
                  isPanning
                    ? "cursor-grabbing select-none"
                    : !editor.imageCropSession &&
                        (tool === "hand" || spacePressed)
                      ? "cursor-grab"
                      : ""
                }`}
                onPointerDownCapture={startPanning}
                onPointerMoveCapture={continuePanning}
                onPointerUpCapture={finishPanning}
                onPointerCancelCapture={finishPanning}
                onMouseDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    tool === "select"
                  ) {
                    editor.setSelection(null)
                    guideWorkspace.setSelectedGuideId(null)
                  }
                }}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest(".upper-canvas"))
                    return
                  zoomAtPoint(zoom * 1.75, event.clientX, event.clientY)
                }}
              >
                <div
                  ref={(element) => {
                    cameraTransformRef.current = element
                    if (element) {
                      const camera = cameraRef.current
                      element.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0)`
                    }
                  }}
                  className="absolute top-0 left-0 will-change-transform"
                  data-canvas-camera="true"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) {
                      editor.setSelection(null)
                      guideWorkspace.setSelectedGuideId(null)
                    }
                  }}
                >
                  <FabricArtboard
                    ref={artboardRef}
                    document={editor.previewDocument}
                    pageId={activePage.id}
                    selection={editor.selection}
                    hoveredNodeId={hoveredNodeId}
                    textEditingNodeId={textEditingNodeId}
                    textEditingSelection={textEditingSelection}
                    imageCropMode={
                      editor.imageCropSession
                        ? {
                            nodeId: editor.imageCropSession.target.nodeId,
                            placement: editor.imageCropSession.draft,
                          }
                        : null
                    }
                    imageCropPreviewStore={editor.imageCropPreviewStore}
                    imageResourceTokens={imageReplacementResourceTokens}
                    zoom={zoom}
                    snapTargets={activeGuideSnapTargets}
                    interactive={Boolean(
                      !editor.pendingChangeSet && !pendingQuotationRefresh
                    )}
                    onCanvasDoubleClick={({ clientX, clientY }) =>
                      zoomAtPoint(zoom * 1.75, clientX, clientY)
                    }
                    onNodeDoubleClick={(nodeId) =>
                      editor.setSelection({
                        pageId: activePage.id,
                        nodeIds: [nodeId],
                      })
                    }
                    onContextMenu={({ nodeId }) => {
                      if (!nodeId) {
                        editor.setSelection(null)
                        guideWorkspace.setSelectedGuideId(null)
                        return
                      }
                      if (editor.selection?.nodeIds.includes(nodeId)) return
                      editor.setSelection({
                        pageId: activePage.id,
                        nodeIds: [nodeId],
                      })
                    }}
                    onImageDoubleClick={(nodeId) =>
                      beginImageCrop(nodeId, { source: "canvas" })
                    }
                    onImageCropPreview={({ nodeId, placement }) => {
                      if (nodeId === editor.imageCropSession?.target.nodeId) {
                        editor.previewImageCrop(placement)
                      }
                    }}
                    onImageCropFramePreview={editor.previewImageCropFrame}
                    onImageCropUnavailable={({ nodeId }) => {
                      editor.rejectUnavailableImageCrop(nodeId)
                    }}
                    onImageSourceStateChange={handleImageSourceStateChange}
                    onTextEditingStart={(nodeId) => {
                      setTextEditingSelection(null)
                      setTextEditingNodeId((requestedNodeId) =>
                        requestedNodeId === nodeId ? null : requestedNodeId
                      )
                    }}
                    onTextEditingChange={setTextEditingState}
                    onSelectionChange={editor.setCanvasSelection}
                    onNodesChange={editor.updateNodes}
                  />
                </div>
                <CanvasRulerGuideOverlay
                  ref={rulerGuideOverlayRef}
                  pageId={activePage.id}
                  camera={{ ...cameraPosition, zoom }}
                  viewport={workspaceSize}
                  pageSize={{
                    width: activePage.width,
                    height: activePage.height,
                  }}
                  guides={guideWorkspace.activeGuides}
                  preferences={guideWorkspace.preferences}
                  selectionBounds={rulerSelectionBounds}
                  selectedGuideId={guideWorkspace.selectedGuideId}
                  interactive={
                    !editor.pendingChangeSet &&
                    !pendingQuotationRefresh &&
                    !editor.imageCropSession &&
                    !isPanning
                  }
                  onGuideSelectionChange={selectWorkspaceGuide}
                  onGuideHoverChange={guideWorkspace.setHoveredGuideId}
                  onAddGuide={(guide) => {
                    addWorkspaceGuide(guide)
                  }}
                  onMoveGuide={(guideId, position) => {
                    moveWorkspaceGuide(guideId, position)
                  }}
                  onDuplicateGuide={(guideId, position) => {
                    duplicateWorkspaceGuide(guideId, position)
                  }}
                  onRemoveGuide={(guideId) => {
                    removeWorkspaceGuide(guideId)
                  }}
                />
                {activePage.nodeIds.length === 0 && !editor.imageCropSession ? (
                  <EmptyCanvasActions
                    disabled={Boolean(
                      editor.pendingChangeSet ||
                      pendingQuotationRefresh ||
                      editor.draftRecovery
                    )}
                    onAddText={() => {
                      insertTextPreset()
                    }}
                    onAddImage={() => openMediaPicker("recent")}
                    onChooseTemplate={() => {
                      setDocumentPanelTab("templates")
                      if (desktopPresentation) {
                        if (shellLayoutRef.current.leftPanel.collapsed) {
                          toggleShellPanel("left")
                        }
                        return
                      }
                      compactPanelTriggerRef.current =
                        document.activeElement instanceof HTMLButtonElement
                          ? document.activeElement
                          : null
                      setCompactPanel("document")
                    }}
                    onAddPage={() => editor.addPage(activePage.outputId)}
                  />
                ) : null}
                {!editor.imageCropSession &&
                selectedImage &&
                selectedImageToolbarPlacement?.mode === "overlay" ? (
                  <div
                    ref={installSelectedImageToolbarOverlay}
                    className="pointer-events-none absolute z-30 flex justify-center"
                    data-editor-overlay-control="true"
                    data-selected-image-toolbar-overlay="true"
                    style={{
                      top: selectedImageToolbarPlacement.top,
                      left: selectedImageToolbarPlacement.left,
                      width: selectedImageToolbarPlacement.width,
                    }}
                  >
                    <SelectedImageToolbar
                      image={selectedImage}
                      className="pointer-events-auto"
                      onRunCommand={runEditorCommand}
                      isCommandEnabled={commandEnabled}
                    />
                  </div>
                ) : null}
                {!editor.imageCropSession &&
                textEditingState &&
                textFormattingToolbarPlacement?.mode === "overlay" ? (
                  <div
                    ref={installTextFormattingToolbarOverlay}
                    className="pointer-events-none absolute z-30 flex justify-center"
                    data-editor-overlay-control="true"
                    data-text-formatting-toolbar-overlay="true"
                    style={{
                      top: textFormattingToolbarPlacement.top,
                      left: textFormattingToolbarPlacement.left,
                      width: textFormattingToolbarPlacement.width,
                    }}
                  >
                    <TextFormattingToolbar
                      state={textEditingState}
                      className="pointer-events-auto"
                      onApply={(patch) => {
                        applyActiveTextEditingStyle(patch)
                      }}
                      onEditLink={openTextLinkEditor}
                    />
                  </div>
                ) : null}
                {textLinkEditor ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-2"
                    data-editor-overlay-control="true"
                  >
                    <TextLinkEditor
                      key={`${textLinkEditor.nodeId}:${textLinkEditor.selection.anchor}:${textLinkEditor.selection.focus}`}
                      link={textLinkEditor.link}
                      className="pointer-events-auto"
                      onApply={applyTextLinkEditor}
                      onCancel={closeTextLinkEditor}
                    />
                  </div>
                ) : null}
              </div>
            </ProductCommandContextMenu>

            <ProductPageFilmstrip
              document={editor.previewDocument}
              density={shellLayout.filmstripDensity}
              imageResourceTokens={imageReplacementResourceTokens}
              onImageResourceStateChange={handleReactImageResourceStateChange}
              activePageId={editor.activePageId}
              reviewPending={Boolean(
                editor.pendingChangeSet || pendingQuotationRefresh
              )}
              onSelectPage={editor.selectPage}
              onAddPage={editor.addPage}
              onDuplicatePage={editor.duplicatePage}
              onRemovePage={editor.removePage}
              onReorderPage={editor.reorderPage}
              productCommandContext={productCommandContext}
              productCommandRuntime={productMenuRuntime}
              raster={pageThumbnailRaster}
              onDensityChange={setFilmstripDensity}
            />

            {editor.imageCropPreviewStore && cropImageName ? (
              <ImageCropToolbar
                previewStore={editor.imageCropPreviewStore}
                imageName={cropImageName}
                focusOnMount={
                  cropFocusSessionRef.current?.focusToolbarOnMount ?? false
                }
                className={
                  cropToolbarEdge === "top"
                    ? "top-24 bottom-auto min-[1280px]:top-24 min-[1280px]:bottom-auto"
                    : shellLayout.filmstripDensity === "compact"
                      ? "bottom-[100px] min-[1280px]:bottom-[108px]"
                      : "bottom-[100px] min-[1280px]:bottom-[132px]"
                }
                onPreview={editor.previewImageCrop}
                onRunCommand={runEditorCommand}
                isCommandEnabled={commandEnabled}
                onCancel={() => runEditorCommand("image.crop.cancel")}
                onDone={() => runEditorCommand("image.crop.apply")}
              />
            ) : null}

            {!editor.imageCropSession ? (
              <CanvasZoomControls
                className={cn(
                  "absolute left-1/2 -translate-x-1/2",
                  shellLayout.filmstripDensity === "compact"
                    ? "bottom-[100px] min-[1280px]:bottom-[108px]"
                    : "bottom-[100px] min-[1280px]:bottom-[132px]"
                )}
                zoom={zoom}
                hasSelection={editor.selectedNodes.length > 0}
                onZoomChange={setManualZoom}
                onFit={() => {
                  setAutoFit(true)
                  fitCanvas()
                }}
                onZoomToSelection={zoomToSelection}
              />
            ) : null}
          </section>

          {!shellLayout.rightPanel.collapsed ? (
            <>
              <EditorPanelSplitter
                className="hidden min-[1280px]:block"
                controlsId="studio-properties-panel"
                label="Resize properties panel"
                value={rightShellResizeBounds.value}
                minValue={rightShellResizeBounds.minimum}
                maxValue={rightShellResizeBounds.maximum}
                disabled={rightShellResizeBounds.disabled}
                resizeDirection="left"
                onResize={(width) => previewShellPanelWidth("right", width)}
                onResizeEnd={(width) => commitShellPanelWidth("right", width)}
                onToggleCollapse={() => toggleShellPanel("right", true)}
              />
              <div
                id="studio-properties-panel"
                className="hidden min-h-0 shrink-0 min-[1280px]:block"
                style={{ width: resolvedShellLayout.rightPanelWidth }}
              >
                <InspectorSidebar
                  className="size-full border-l-0"
                  document={editor.document}
                  reviewNavigationDocument={editor.previewDocument}
                  selectedNodes={editor.selectedNodes}
                  selectedGroupId={editor.selectedGroupId}
                  productCommandContext={productCommandContext}
                  productCommandRuntime={productMenuRuntime}
                  textEditingState={textEditingState}
                  imageCropPreviewStore={editor.imageCropPreviewStore}
                  capabilityContext={inspectorCapabilityContext}
                  focusFieldId={mediaReviewFieldId}
                  pendingChangeSet={editor.pendingChangeSet}
                  pendingGeneratedDocument={editor.pendingGeneratedDocument}
                  generatedDocumentError={editor.generatedDocumentError}
                  isCreatingGeneratedDocument={
                    editor.isCreatingGeneratedDocument
                  }
                  lastResolvedChangeSet={editor.lastResolvedChangeSet}
                  reviewJournal={editor.reviewJournal}
                  changeSetConflict={editor.changeSetConflict}
                  changeSetError={editor.changeSetError}
                  isApplyingChangeSet={editor.isApplyingChangeSet}
                  webMcpStatus={webMcp.status}
                  webMcpError={webMcp.error}
                  onUpdateNode={updateNode}
                  onPreviewNodePatch={(nodeId, patch) =>
                    artboardRef.current?.previewNodePatch(nodeId, patch)
                  }
                  onCancelNodePreview={(nodeId) =>
                    artboardRef.current?.restoreNodePreview(nodeId)
                  }
                  onUpdateSelection={editor.updateSelectionNodes}
                  onTransformSelection={editor.transformSelectionNodes}
                  onUpdateField={editor.updateField}
                  onChooseFieldAsset={openFieldMediaPicker}
                  onCreateField={editor.createField}
                  onUpdateFieldDefinition={editor.updateFieldDefinition}
                  onRemoveField={editor.removeField}
                  onBindField={editor.bindField}
                  onUnbindField={editor.unbindField}
                  onFocusNode={focusNode}
                  onDecideChangeOperation={editor.decideOperation}
                  onDecideAllChangeOperations={editor.decideAllOperations}
                  onApplyChangeSet={editor.applyChangeSet}
                  onDiscardChangeSet={editor.discardChangeSet}
                  onCreateGeneratedDocument={editor.createGeneratedDocument}
                  onDiscardGeneratedDocument={editor.discardGeneratedDocument}
                  onFocusReviewTarget={focusReviewTarget}
                  onAlignSelection={editor.alignSelection}
                  onAlignSelectionToPage={editor.alignSelectionToPage}
                  onDistributeSelection={editor.distributeSelection}
                  onSetSelectionLocked={editor.setSelectionLocked}
                  onSetSelectionVisible={editor.setSelectionVisible}
                  onReorderSelection={editor.reorderSelection}
                  onDuplicateSelection={editor.duplicateSelection}
                  onDeleteSelection={editor.deleteSelection}
                  onUpdateImageFrameGeometry={updateImageCropFrameGeometry}
                  onSetImagePlacement={editor.setImagePlacement}
                  onSetImageFrameMask={editor.setImageFrameMask}
                  onRunImageCommand={runEditorCommand}
                  isImageCommandEnabled={commandEnabled}
                  onRetryImageSource={(nodeId) =>
                    artboardRef.current?.retryImageSource(nodeId)
                  }
                  onRemoveImageLayer={editor.deleteSelection}
                  onReviewDocumentImage={(localAssetId) =>
                    mediaPickerSession.openRecovery({
                      localAssetId,
                      targetName: "document image",
                    })
                  }
                  backgroundRemoval={
                    backgroundRemovalEnabled ? backgroundRemoval : undefined
                  }
                  onApplyTextEditingStyle={applyActiveTextEditingStyle}
                  onApplyTextEditingParagraphStyle={
                    applyActiveTextEditingParagraphStyle
                  }
                  onEditTextLink={openTextLinkEditor}
                  onCreateTypographyStyle={(style, nodeId) =>
                    editor.createTypographyStyle(
                      style,
                      nodeId ? [{ nodeId }] : []
                    )
                  }
                  onUpdateTypographyStyle={editor.updateTypographyStyle}
                  onDeleteTypographyStyle={editor.deleteTypographyStyle}
                  onApplyTypographyStyle={(styleId, nodeId) =>
                    editor.applyTypographyStyle(styleId, [{ nodeId }])
                  }
                  onDetachTypographyStyle={(nodeId) =>
                    editor.detachTypographyStyle([{ nodeId }])
                  }
                  onCreatePaintStyle={(style, nodeId) =>
                    editor.createPaintStyle(style, nodeId ? [{ nodeId }] : [])
                  }
                  onUpdatePaintStyle={editor.updatePaintStyle}
                  onDeletePaintStyle={editor.deletePaintStyle}
                  onApplyPaintStyle={(styleId, nodeId) =>
                    editor.applyPaintStyle(styleId, [{ nodeId }])
                  }
                  onDetachPaintStyle={(nodeId) =>
                    editor.detachPaintStyle([{ nodeId }])
                  }
                  onCreateVariable={editor.createVariable}
                  onUpdateVariable={editor.updateVariable}
                  onDeleteVariable={editor.deleteVariable}
                  onBindVariable={editor.bindVariable}
                  onUnbindVariable={editor.unbindVariable}
                  onUpdateComponent={editor.updateComponent}
                  onSwitchComponentVariant={editor.switchComponentVariant}
                  onResetComponentLayerOverrides={
                    editor.resetComponentLayerOverrides
                  }
                  onResetAllComponentOverrides={
                    editor.resetAllComponentOverrides
                  }
                  onDetachComponentInstance={editor.detachComponentInstance}
                  onFocusComponentSource={focusComponentSource}
                />
              </div>
            </>
          ) : null}

          <SheetContent
            id={
              compactPanel === "document"
                ? "compact-document-panel"
                : "compact-inspector-panel"
            }
            side={
              compactPanelUsesBottomSheet
                ? "bottom"
                : compactPanel === "document"
                  ? "left"
                  : "right"
            }
            className={cn(
              "gap-0 overflow-hidden overscroll-contain border-border/80 bg-background min-[1280px]:hidden [&>[data-slot=sheet-close]]:top-1.5 [&>[data-slot=sheet-close]]:right-1.5 [&>[data-slot=sheet-close]]:size-11",
              compactPanelUsesBottomSheet
                ? "!h-[min(78dvh,44rem)] w-full max-w-none rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
                : "w-[min(24rem,calc(100vw-0.75rem))] rounded-r-xl shadow-[12px_0_40px_rgba(0,0,0,0.14)] data-[side=right]:rounded-l-xl data-[side=right]:rounded-r-none data-[side=right]:shadow-[-12px_0_40px_rgba(0,0,0,0.14)] sm:max-w-96"
            )}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              compactPanelHeadingRef.current?.focus({ preventScroll: true })
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              compactPanelTriggerRef.current?.focus({ preventScroll: true })
            }}
          >
            <SheetHeader
              className={cn(
                "relative h-14 shrink-0 justify-center gap-0 border-b border-border/80 px-3 py-0 pr-14",
                compactPanelUsesBottomSheet && "pt-1"
              )}
            >
              {compactPanelUsesBottomSheet ? (
                <div
                  aria-hidden
                  className="absolute top-1.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-border"
                />
              ) : null}
              <SheetTitle
                ref={compactPanelHeadingRef}
                tabIndex={-1}
                className="text-xs leading-none font-semibold outline-none"
              >
                {compactPanel === "document" ? "Document" : "Properties"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {compactPanel === "document"
                  ? "Choose a template, manage pages and outputs, or select a document layer."
                  : "Edit the selected layer, document fields, and review changes."}
              </SheetDescription>
            </SheetHeader>
            {compactPanel === "document" ? (
              <QuotationSidebar
                compact
                className="min-h-0 w-full flex-1 border-r-0"
                document={editor.document}
                activePageId={editor.activePageId}
                selection={editor.selection}
                activeTemplate={editor.activeDesignTemplate}
                hasQuotationSource={Boolean(editor.quotationSource)}
                templateActionError={editor.templateActionError}
                layerOrganizationUpgradeAvailable={
                  editor.quotationGroupOrganization.status === "available"
                }
                reviewPending={Boolean(
                  editor.pendingChangeSet || pendingQuotationRefresh
                )}
                activePanel={documentPanelTab}
                onActivePanelChange={setDocumentPanelTab}
                templateBrowserVisible={templateBrowserVisibility.compact}
                onLayerOrganizationUpgrade={() => {
                  if (!commitActiveTextEditing()) return
                  if (editor.upgradeQuotationLayerOrganization()) {
                    setDocumentPanelTab("layers")
                  }
                }}
                onCreateFromTemplate={async (template) =>
                  (await requestNewDraft(
                    {
                      kind: "template",
                      templateId: template.id,
                      version: template.version,
                    },
                    "Starting from the selected template",
                    () => createFromLibraryTemplate(template)
                  )) !== false
                }
                onResolveApplyTemplate={async (template) => {
                  if (!commitActiveTextEditing()) return null
                  return editor.resolveApplyLibraryTemplate(template)
                }}
                onConfirmApplyTemplate={async (resolved) => {
                  const applied =
                    await editor.confirmApplyLibraryTemplate(resolved)
                  if (applied) {
                    setAutoFit(true)
                    setCompactPanel(null)
                  }
                  return applied
                }}
                onCancelTemplateAction={editor.cancelLibraryTemplateAction}
                onSelectionChange={editor.setLayerSelection}
                onFocusNode={focusNode}
                onHoverNode={setHoveredNodeId}
                onRenameNode={editor.renameLayerNode}
                onRenameGroup={editor.updateGroup}
                onUpdateLayerNodes={editor.updateLayerNodes}
                onMoveLayer={editor.moveLayer}
                onDeleteLayerNodes={editor.deleteLayerNodes}
                canCreateComponentFromSelection={Boolean(
                  editor.selectedGroupId || editor.selectedNodes.length >= 2
                )}
                onCreateComponentFromSelection={createComponentFromSelection}
                onInsertComponent={insertComponent}
                onFocusComponentSource={focusComponentSource}
                assetWorkspaceView={assetWorkspaceView}
                mediaBrowserVisible={assetMediaBrowserVisibility.compact}
                mediaScope={assetMediaScope}
                mediaPendingIdentity={
                  inlineMediaActionState?.pendingIdentity ?? null
                }
                mediaActionError={inlineMediaActionState?.actionError ?? null}
                mediaActionsEnabled={inlineMediaActionsEnabled}
                onAssetWorkspaceViewChange={setAssetWorkspaceView}
                onMediaScopeChange={setAssetMediaScope}
                onMediaSelect={insertMediaFromAssets}
                productCommandContext={productCommandContext}
                productCommandRuntime={productMenuRuntime}
                onSelectPage={(pageId) => {
                  editor.selectPage(pageId)
                  setCompactPanel(null)
                }}
                onAddPage={editor.addPage}
                onDuplicatePage={editor.duplicatePage}
                onUpdatePage={editor.updatePage}
                onRemovePage={editor.removePage}
                onReorderPage={editor.reorderPage}
                onAddOutput={editor.addOutput}
                onUpdateOutput={editor.updateOutput}
                onRemoveOutput={editor.removeOutput}
              />
            ) : (
              <InspectorSidebar
                className="min-h-0 w-full flex-1 border-l-0"
                document={editor.document}
                reviewNavigationDocument={editor.previewDocument}
                selectedNodes={editor.selectedNodes}
                selectedGroupId={editor.selectedGroupId}
                productCommandContext={productCommandContext}
                productCommandRuntime={productMenuRuntime}
                textEditingState={textEditingState}
                imageCropPreviewStore={editor.imageCropPreviewStore}
                capabilityContext={inspectorCapabilityContext}
                focusFieldId={mediaReviewFieldId}
                pendingChangeSet={editor.pendingChangeSet}
                pendingGeneratedDocument={editor.pendingGeneratedDocument}
                generatedDocumentError={editor.generatedDocumentError}
                isCreatingGeneratedDocument={editor.isCreatingGeneratedDocument}
                lastResolvedChangeSet={editor.lastResolvedChangeSet}
                reviewJournal={editor.reviewJournal}
                changeSetConflict={editor.changeSetConflict}
                changeSetError={editor.changeSetError}
                isApplyingChangeSet={editor.isApplyingChangeSet}
                webMcpStatus={webMcp.status}
                webMcpError={webMcp.error}
                onUpdateNode={updateNode}
                onPreviewNodePatch={(nodeId, patch) =>
                  artboardRef.current?.previewNodePatch(nodeId, patch)
                }
                onCancelNodePreview={(nodeId) =>
                  artboardRef.current?.restoreNodePreview(nodeId)
                }
                onUpdateSelection={editor.updateSelectionNodes}
                onTransformSelection={editor.transformSelectionNodes}
                onUpdateField={editor.updateField}
                onChooseFieldAsset={openFieldMediaPicker}
                onCreateField={editor.createField}
                onUpdateFieldDefinition={editor.updateFieldDefinition}
                onRemoveField={editor.removeField}
                onBindField={editor.bindField}
                onUnbindField={editor.unbindField}
                onFocusNode={focusNode}
                onDecideChangeOperation={editor.decideOperation}
                onDecideAllChangeOperations={editor.decideAllOperations}
                onApplyChangeSet={editor.applyChangeSet}
                onDiscardChangeSet={editor.discardChangeSet}
                onCreateGeneratedDocument={editor.createGeneratedDocument}
                onDiscardGeneratedDocument={editor.discardGeneratedDocument}
                onFocusReviewTarget={focusReviewTarget}
                onAlignSelection={editor.alignSelection}
                onAlignSelectionToPage={editor.alignSelectionToPage}
                onDistributeSelection={editor.distributeSelection}
                onSetSelectionLocked={editor.setSelectionLocked}
                onSetSelectionVisible={editor.setSelectionVisible}
                onReorderSelection={editor.reorderSelection}
                onDuplicateSelection={editor.duplicateSelection}
                onDeleteSelection={editor.deleteSelection}
                onUpdateImageFrameGeometry={updateImageCropFrameGeometry}
                onSetImagePlacement={editor.setImagePlacement}
                onSetImageFrameMask={editor.setImageFrameMask}
                onRunImageCommand={(commandId) => {
                  if (commandId !== "image.crop") {
                    runEditorCommand(commandId)
                    return
                  }
                  const opener = document.activeElement
                  setCompactPanel(null)
                  window.requestAnimationFrame(() => {
                    runEditorCommand(commandId, {
                      imageCropEntry: { source: "control", opener },
                    })
                  })
                }}
                isImageCommandEnabled={commandEnabled}
                onRetryImageSource={(nodeId) =>
                  artboardRef.current?.retryImageSource(nodeId)
                }
                backgroundRemoval={
                  backgroundRemovalEnabled ? backgroundRemoval : undefined
                }
                onRemoveImageLayer={editor.deleteSelection}
                onReviewDocumentImage={(localAssetId) =>
                  mediaPickerSession.openRecovery({
                    localAssetId,
                    targetName: "document image",
                  })
                }
                onApplyTextEditingStyle={applyActiveTextEditingStyle}
                onApplyTextEditingParagraphStyle={
                  applyActiveTextEditingParagraphStyle
                }
                onEditTextLink={openTextLinkEditor}
                onCreateTypographyStyle={(style, nodeId) =>
                  editor.createTypographyStyle(
                    style,
                    nodeId ? [{ nodeId }] : []
                  )
                }
                onUpdateTypographyStyle={editor.updateTypographyStyle}
                onDeleteTypographyStyle={editor.deleteTypographyStyle}
                onApplyTypographyStyle={(styleId, nodeId) =>
                  editor.applyTypographyStyle(styleId, [{ nodeId }])
                }
                onDetachTypographyStyle={(nodeId) =>
                  editor.detachTypographyStyle([{ nodeId }])
                }
                onCreatePaintStyle={(style, nodeId) =>
                  editor.createPaintStyle(style, nodeId ? [{ nodeId }] : [])
                }
                onUpdatePaintStyle={editor.updatePaintStyle}
                onDeletePaintStyle={editor.deletePaintStyle}
                onApplyPaintStyle={(styleId, nodeId) =>
                  editor.applyPaintStyle(styleId, [{ nodeId }])
                }
                onDetachPaintStyle={(nodeId) =>
                  editor.detachPaintStyle([{ nodeId }])
                }
                onCreateVariable={editor.createVariable}
                onUpdateVariable={editor.updateVariable}
                onDeleteVariable={editor.deleteVariable}
                onBindVariable={editor.bindVariable}
                onUnbindVariable={editor.unbindVariable}
                onUpdateComponent={editor.updateComponent}
                onSwitchComponentVariant={editor.switchComponentVariant}
                onResetComponentLayerOverrides={
                  editor.resetComponentLayerOverrides
                }
                onResetAllComponentOverrides={editor.resetAllComponentOverrides}
                onDetachComponentInstance={editor.detachComponentInstance}
                onFocusComponentSource={focusComponentSource}
              />
            )}
          </SheetContent>
        </div>
        {mediaUsageNotices.length ? (
          <div
            aria-label="Media action notices"
            className="fixed right-4 bottom-4 z-60 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2"
          >
            {mediaUsageNotices.map((notice) => (
              <section
                key={notice.id}
                className="rounded-lg border border-amber-500/35 bg-background p-3 shadow-xl"
                data-media-usage-notice={notice.id}
                role="status"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  <p className="min-w-0 flex-1 text-xs leading-5">
                    {notice.message}
                  </p>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      mediaPickerSession.dismissUsageNotice(notice.id)
                    }
                  >
                    Dismiss
                  </Button>
                  <Button
                    disabled={notice.status === "retrying"}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void mediaPickerSession.retryUsageNotice(notice.id)
                    }
                  >
                    {notice.status === "retrying"
                      ? "Retrying…"
                      : notice.status === "failed"
                        ? "Retry again"
                        : "Retry"}
                  </Button>
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {mediaPickerUsesDialog(mediaPicker) ? (
          <Suspense fallback={null}>
            <AssetLibraryDialog
              open={mediaPickerUsesDialog(mediaPicker)}
              onOpenChange={(open) => {
                if (!open) mediaPickerSession.close(true)
              }}
              mode={
                mediaPicker?.kind === "recover-local"
                  ? "recover-local"
                  : mediaPicker?.target.type === "replace"
                    ? "replace"
                    : mediaPicker?.target.type === "assign_field"
                      ? "assign_field"
                      : "insert"
              }
              targetName={mediaPicker?.targetName}
              document={editor.document}
              documentMediaAdmission={editor.documentMediaAdmission}
              localAssetRevision={editor.assetVersion}
              recoveryMutationDisabledReason={
                editor.imageCropSession
                  ? "Finish or cancel the active image crop before recovering document images."
                  : editor.pendingChangeSet
                    ? "Resolve or discard the pending Review before recovering document images."
                    : pendingQuotationRefresh
                      ? "Accept or reject the pending quotation refresh before recovering document images."
                      : null
              }
              localAssetPromotions={editor.localAssetPromotions}
              localMediaRecoveryOperations={editor.localMediaRecoveryOperations}
              mediaScope={mediaPicker?.scope ?? { kind: "recent" }}
              pendingIdentity={
                mediaPicker?.kind === "action"
                  ? mediaPicker.pendingIdentity
                  : null
              }
              actionError={
                mediaPicker?.kind === "action" ? mediaPicker.actionError : null
              }
              actionsEnabled={
                mediaPicker?.kind === "action" && !mediaPicker.pendingIdentity
              }
              onMediaScopeChange={mediaPickerSession.setScope}
              onMediaSelect={selectExactMedia}
              resolveUploadedMediaDetail={resolveUploadedMediaDetail}
              onRecoveryManagedSelect={selectManagedRecoveryMedia}
              onPromoteLocalAsset={(assetId) => {
                void editor.startLocalAssetPromotion(assetId)
              }}
              onCancelLocalAssetPromotion={editor.cancelLocalAssetPromotion}
              onLocateMissingLocalAsset={(assetId, file) => {
                void editor.locateMissingLocalAsset(assetId, file)
              }}
              onKeepLocatedFileAsNewLocalAsset={(assetId) => {
                void editor.keepLocatedFileAsNewLocalAsset(assetId)
              }}
              onUseStudioCopyForLocalAsset={(
                assetId,
                confirmIdentityConflict
              ) => {
                void editor.useStudioCopyForLocalAsset(
                  assetId,
                  confirmIdentityConflict
                )
              }}
              onRetryLocalMediaRecovery={(assetId) => {
                void editor.retryLocalMediaRecoverySave(assetId)
              }}
              onCancelLocalMediaRecovery={(assetId) => {
                editor.cancelLocalMediaRecovery(assetId)
              }}
              onRemoveMissingLocalAsset={(assetId, referenceKey) => {
                void editor.removeMissingLocalAsset(assetId, referenceKey)
              }}
              onChooseStudioImageForLocalAsset={(assetId) => {
                mediaPickerSession.openRecovery({
                  localAssetId: assetId,
                  targetName: mediaPicker?.targetName ?? "missing image",
                })
              }}
              onNavigateToReference={({ nodeId, pageId, fieldId }) => {
                if (fieldId) {
                  setMediaReviewFieldId(null)
                  setCompactPanel("inspector")
                  window.requestAnimationFrame(() =>
                    setMediaReviewFieldId(fieldId)
                  )
                } else if (nodeId) {
                  focusNode(nodeId)
                } else if (pageId) {
                  editor.selectPage(pageId)
                }
              }}
            />
          </Suspense>
        ) : null}
        <AlertDialog
          open={editor.pendingDocumentImportMediaReview !== null}
          onOpenChange={(open) => {
            if (!open) editor.cancelDocumentImportMediaReview()
          }}
        >
          <AlertDialogContent className="max-h-[min(760px,calc(100dvh-32px))] max-w-[min(680px,calc(100vw-32px))] overflow-y-auto sm:max-w-[680px]">
            <AlertDialogHeader>
              <AlertDialogTitle>Review document images</AlertDialogTitle>
              <AlertDialogDescription>
                {editor.pendingDocumentImportMediaReview
                  ? `${editor.pendingDocumentImportMediaReview.fileName} contains ${editor.pendingDocumentImportMediaReview.manifest.aliasCount} device-only image ${editor.pendingDocumentImportMediaReview.manifest.aliasCount === 1 ? "reference" : "references"}. Choose whether exact Studio copies should be used before the document is installed.`
                  : "Review image recovery before installing this document."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {editor.pendingDocumentImportMediaReview ? (
              <div
                className="grid gap-2"
                aria-label="Imported document image review"
              >
                {editor.pendingDocumentImportMediaReview.manifest.items.map(
                  (item) => {
                    const reviewDocument =
                      editor.pendingDocumentImportMediaReview!.originalDocument
                    const namedUses = namedDocumentMediaUses(
                      reviewDocument,
                      item
                    )
                    const visibleUses = namedUses.slice(0, 50)
                    return (
                      <div
                        key={item.localAssetId}
                        className="rounded-lg border bg-muted/25 px-3 py-2.5 text-xs"
                      >
                        <p className="font-medium">
                          {item.state === "studio_backup"
                            ? "Studio backup found"
                            : item.state === "studio_copy"
                              ? "Studio copy available"
                              : item.state === "identity_conflict"
                                ? "Different file on this device"
                                : item.state === "on_device"
                                  ? "On this device"
                                  : item.state === "backup_status_unknown"
                                    ? "Backup status unknown"
                                    : "File missing"}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {item.pageIds.length}{" "}
                          {item.pageIds.length === 1 ? "page" : "pages"} ·{" "}
                          {item.nodeIds.length}{" "}
                          {item.nodeIds.length === 1 ? "layer" : "layers"} ·{" "}
                          {item.fieldIds.length}{" "}
                          {item.fieldIds.length === 1 ? "field" : "fields"} ·{" "}
                          {item.outputIds.length}{" "}
                          {item.outputIds.length === 1 ? "output" : "outputs"}
                        </p>
                        {item.requiresChoice ? (
                          <p className="mt-1 text-amber-800">
                            This identity is unresolved and will remain
                            unchanged.
                          </p>
                        ) : null}
                        {visibleUses.length ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-medium">
                              Review named uses
                            </summary>
                            <ul className="mt-2 grid gap-1">
                              {visibleUses.map((use) => (
                                <li
                                  key={use.key}
                                  className="flex items-center justify-between gap-3 rounded-md bg-background px-2 py-1.5"
                                >
                                  <span className="min-w-0 truncate">
                                    {use.label}
                                  </span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {use.kind}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {namedUses.length > visibleUses.length ? (
                              <p className="mt-1 text-muted-foreground">
                                {namedUses.length - visibleUses.length} more
                                uses are included in this recovery decision.
                              </p>
                            ) : null}
                          </details>
                        ) : null}
                      </div>
                    )
                  }
                )}
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void editor.resolveDocumentImportMediaReview(false)
                }
              >
                {editor.pendingDocumentImportMediaReview?.kind === "open"
                  ? "Open without recovering"
                  : "Import without recovering"}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void editor.resolveDocumentImportMediaReview(true)
                }
              >
                {editor.pendingDocumentImportMediaReview?.kind === "open"
                  ? "Open with Studio copies"
                  : "Import with Studio copies"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {editor.draftRecovery ? (
          <Suspense fallback={null}>
            <DraftRecoveryDialog
              recovery={editor.draftRecovery}
              notice={editor.draftRecoveryNotice}
              onDownload={editor.downloadDraftRecovery}
              onRetry={() => {
                cancelActiveTextEditing()
                editor.retryDraftRecovery()
              }}
              onReset={() => {
                cancelActiveTextEditing()
                editor.resetDraftRecovery()
              }}
            />
          </Suspense>
        ) : null}
        {editor.conflictRecoveryModel.status !== "none" ? (
          <Suspense fallback={null}>
            <DocumentConflictDialog
              model={editor.conflictRecoveryModel}
              onDownload={() => {
                if (commitActiveTextEditing()) {
                  return editor.downloadCurrentVersion()
                }
                return false
              }}
              onReload={reloadSavedDocument}
              onReturnHome={returnToDocumentsFromConflictRecovery}
              onSaveCopy={saveRecoveredDocumentAsCopy}
            />
          </Suspense>
        ) : null}
        {pendingDraftReplacement ? (
          <Suspense fallback={null}>
            <ReplaceCurrentDraftDialog
              documentName={editor.document.name}
              error={editor.documentError}
              nextActionLabel={pendingDraftReplacement.nextActionLabel}
              open
              replacing={replacementRunning}
              sessionOnly={editor.localSaveState.status === "session_only"}
              onCancel={cancelDraftReplacement}
              onDownload={() => {
                if (commitActiveTextEditing()) editor.downloadCurrentVersion()
              }}
              onReplace={() => void confirmDraftReplacement()}
            />
          </Suspense>
        ) : null}
        {newDocumentOpen ? (
          <Suspense fallback={null}>
            <NewDocumentDialog
              open
              onOpenChange={setNewDocumentOpen}
              onCreateBlank={(options) => {
                return requestNewDraft(
                  { kind: "blank" },
                  `Creating “${options.name}”`,
                  () => editor.createBlankDocument(options)
                )
              }}
              onRestoreDemo={() => {
                return requestNewDraft(
                  { kind: "sample" },
                  "Opening the Northstar sample",
                  editor.restoreDemoDocument
                )
              }}
              onCreated={() => {
                setAutoFit(true)
                window.requestAnimationFrame(() => {
                  fitCanvas()
                  workspaceRef.current
                    ?.querySelector<HTMLElement>(
                      ".upper-canvas, [role='application'][aria-label='Interactive design canvas']"
                    )
                    ?.focus()
                })
              }}
              starterMetadata={editor.starterMetadata}
            />
          </Suspense>
        ) : null}
        {quotationRefreshOpen && pendingQuotationRefresh ? (
          <Suspense fallback={null}>
            <QuotationRefreshDialog
              open
              pending={pendingQuotationRefresh}
              error={editor.documentError}
              onOpenChange={setQuotationRefreshOpen}
              onChooseConflict={editor.chooseQuotationRefreshConflict}
              onAccept={editor.acceptQuotationRefresh}
              onReject={editor.rejectQuotationRefresh}
            />
          </Suspense>
        ) : null}
        {publishDialogOpen ? (
          <Suspense fallback={null}>
            <PublishDialog
              open
              onOpenChange={setPublishDialogOpen}
              document={editor.document}
              documentSnapshotId={editor.documentSnapshotId}
              templateId={editor.currentTemplateId}
              latestVersion={editor.latestPublishedVersion}
              currentSnapshotVersion={editor.currentSnapshotPublishedVersion}
              pendingChangeSet={Boolean(
                editor.pendingChangeSet || pendingQuotationRefresh
              )}
              publishError={editor.publishError}
              publishSyncStatus={editor.publishSyncStatus}
              onCancelPublish={editor.cancelPublication}
              onPublish={async () => {
                if (!commitActiveTextEditing()) {
                  throw new Error(
                    "Studio could not finish the active text edit before publishing."
                  )
                }
                return editor.publishTemplate()
              }}
            />
          </Suspense>
        ) : null}
        {apiPlaygroundOpen ? (
          <Suspense fallback={null}>
            <ApiPlaygroundDialog
              open
              onOpenChange={setApiPlaygroundOpen}
              version={publishedVersion}
              renderHistory={renderHistory}
              onRequestPublish={() => {
                setApiPlaygroundOpen(false)
                setPublishDialogOpen(true)
              }}
            />
          </Suspense>
        ) : null}
        {commandPaletteOpen ? (
          <Suspense fallback={null}>
            <StudioCommandPalette
              open
              onOpenChange={setCommandPaletteOpen}
              items={commandPaletteItems}
            />
          </Suspense>
        ) : null}
        {shortcutReferenceOpen ? (
          <Suspense fallback={null}>
            <KeyboardShortcutsDialog
              open
              onOpenChange={setShortcutReferenceOpen}
              items={commandPaletteItems}
            />
          </Suspense>
        ) : null}
        {guideManagerOpen ? (
          <Suspense fallback={null}>
            <GuideManagerDialog
              open
              onOpenChange={setGuideManagerOpen}
              pageName={activePage.name}
              pageSize={{
                width: activePage.width,
                height: activePage.height,
              }}
              guides={guideWorkspace.activeGuides}
              onAddGuide={(guide) => {
                addWorkspaceGuide(guide)
              }}
              onMoveGuide={(guideId, position) => {
                moveWorkspaceGuide(guideId, position)
              }}
              onRemoveGuide={(guideId) => {
                removeWorkspaceGuide(guideId)
              }}
              returnFocusRef={guideManagerTriggerRef}
            />
          </Suspense>
        ) : null}
        {renameLayerTarget ? (
          <Suspense fallback={null}>
            <RenameLayerDialog
              target={renameLayerTarget}
              onOpenChange={(open) => {
                if (!open) setRenameLayerTarget(null)
              }}
              onRename={editor.renameLayerNode}
            />
          </Suspense>
        ) : null}
        {structureCommandDialog ? (
          <Suspense fallback={null}>
            <StructureCommandDialogs
              state={structureCommandDialog}
              onOpenChange={(open) => {
                if (!open) setStructureCommandDialog(null)
              }}
              onRenamePage={(pageId, name) =>
                editor.updatePage(pageId, { name })
              }
              onRenameOutput={editor.updateOutput}
              onAddOutput={editor.addOutput}
              onDeletePage={editor.removePage}
              onDeleteOutput={editor.removeOutput}
            />
          </Suspense>
        ) : null}
      </main>
    </Sheet>
  )

  return (
    <Suspense
      fallback={
        <main
          aria-busy="true"
          className="grid min-h-dvh place-items-center bg-muted/20"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            <span>Preparing the editor…</span>
          </div>
        </main>
      }
    >
      {workspace}
    </Suspense>
  )
}
