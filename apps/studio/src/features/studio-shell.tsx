import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Code2,
  Cloud,
  CopyPlus,
  Circle,
  Download,
  FileJson2,
  Focus,
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
  Rocket,
  Scan,
  Shapes,
  Sparkles,
  Square,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import type { DesignTemplateCatalogItem, SceneNode } from "@webmcp/document"
import type { NodeGeometryPatch } from "@webmcp/editor"
import type { ImageResourceStateChange } from "@webmcp/render-view"
import {
  applyEditorImageFrameCommand,
  applyEditorImagePlacementCommand,
  deriveEditorImageCommandCapabilities,
  dispatchEditorImageCommand,
  editorCommandIds,
  editorImageCommandIds,
  isEditorCommandEnabled,
  projectEditorCommandCapabilities,
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
import { createInspectorSelectionModel } from "@webmcp/editor/inspector"
import type { InspectorImageSourceState } from "@webmcp/editor/inspector"
import { getNodeBounds, getSelectionBounds } from "@webmcp/editor/geometry"
import type { NodeBounds } from "@webmcp/editor/geometry"
import {
  fitPageInViewport,
  focusCameraOnBounds,
  zoomCameraAtPoint,
} from "@webmcp/editor/viewport"
import type { CanvasCamera } from "@webmcp/editor/viewport"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
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
import { Slider } from "@webmcp/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"
import { ProductPageFilmstrip } from "./editor/page-filmstrip"
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
  studioPageThumbnailRendererRevision,
} from "./editor/page-thumbnail-raster-producer"
import type { PageThumbnailDocumentSnapshot } from "./editor/page-thumbnail-raster-producer"
import { QuotationSidebar } from "./editor/quotation-sidebar"
import type { DocumentPanelTab } from "./editor/quotation-sidebar"
import { AssetLibraryDialog } from "./editor/asset-library-dialog"
import type { AssetLibrarySelection } from "./editor/asset-library-dialog"
import { ApiPlaygroundDialog } from "./editor/api-playground-dialog"
import { studioAssets } from "./editor/asset-catalog"
import { NewDocumentDialog } from "./editor/new-document-dialog"
import { StudioStartSurface } from "./editor/studio-start-surface"
import { useRecentDocumentsVisibility } from "./editor/recent-documents-provider"
import { ReplaceCurrentDraftDialog } from "./editor/replace-current-draft-dialog"
import { EmptyCanvasActions } from "./editor/empty-canvas-actions"
import { DraftRecoveryDialog } from "./editor/draft-recovery-dialog"
import { PublishDialog } from "./editor/publish-dialog"
import { FabricArtboard } from "./editor/fabric-artboard"
import type {
  FabricArtboardHandle,
  ImageSourceStateChange,
} from "./editor/fabric-artboard"
import { handleEditorEscape } from "./editor/editor-escape"
import { InspectorSidebar } from "./editor/inspector-sidebar"
import {
  captureImageCropFocusSession,
  isImageCropCanvasFocus,
  restoreImageCropFocus,
} from "./editor/image-crop-focus"
import type {
  ImageCropEntrySource,
  ImageCropFocusSession,
} from "./editor/image-crop-focus"
import { ImageCropToolbar } from "./editor/image-crop-toolbar"
import { SelectedImageToolbar } from "./editor/selected-image-toolbar"
import { resolveSelectedImageToolbarPlacement } from "./editor/selected-image-toolbar-placement"
import { resolveImageCropToolbarEdge } from "./editor/image-crop-toolbar-placement"
import { imageCropKeyboardScreenDelta } from "./editor/image-crop-keyboard"
import { projectNumericImageCropFrameEdit } from "./editor/image-crop-frame-numeric"
import type { ImageCropArrowKey } from "./editor/image-crop-keyboard"
import { imageReplacementConstraintsByNodeId } from "./editor/image-replacement-binding"
import { useDocumentEditor } from "./editor/use-document-editor"
import { useStudioPersistence } from "./persistence/studio-persistence-provider"
import { useCriticalActionOwner } from "./editor/use-critical-action-owner"
import { exportPagePng } from "./editor/export-page-png"
import { useRenderHistory } from "./editor/use-render-history"
import { useStudioWebMcp } from "./editor/use-studio-webmcp"
import { useDraftReplacement } from "./editor/use-draft-replacement"
import { useCanvasGestureNavigation } from "./editor/use-canvas-gesture-navigation"
import { CanvasRulerGuideOverlay } from "./editor/canvas-ruler-guide-overlay"
import type { CanvasRulerGuideOverlayHandle } from "./editor/canvas-ruler-guide-overlay"
import { GuideManagerDialog } from "./editor/guide-manager-dialog"
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
  resetSessionHistoryForDocument,
  takeSessionRedo,
  takeSessionUndo,
} from "./editor/studio-session-history"
import type {
  SessionHistoryAction,
  SessionHistoryLedger,
} from "./editor/studio-session-history"
import {
  StudioCommandPalette,
  productCommandInvocationKey,
} from "./editor/command-palette"
import type { StudioCommandPaletteItem } from "./editor/command-palette"
import { KeyboardShortcutsDialog } from "./editor/keyboard-shortcuts-dialog"
import {
  ProductCommandContextMenu,
  ProductCommandDropdownGroups,
  ProductCommandDropdownItems,
  ProductCommandMenubar,
} from "./editor/product-command-menu"
import type { ProductCommandMenuRuntime } from "./editor/product-command-menu"
import { RenameLayerDialog } from "./editor/rename-layer-dialog"
import type { RenameLayerTarget } from "./editor/rename-layer-dialog"
import { StructureCommandDialogs } from "./editor/structure-command-dialogs"
import type { StructureCommandDialogState } from "./editor/structure-command-dialogs"
import {
  defaultStudioTextPresetId,
  studioTextPresets,
} from "./editor/text-presets"
import type { StudioTextPresetId } from "./editor/text-presets"
import {
  loadLocalAsset,
  localAssetIdFromSource,
} from "./editor/local-asset-store"

const HEART_ICON_PATH =
  "M12 21.35 10.55 20.03C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.54Z"

type MediaPickerState = {
  mode: "insert" | "replace"
  targetNodeId?: string
  targetName?: string
  initialCollection: "recent" | "uploads" | "library"
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
        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
          {preset.description}
        </span>
      </span>
      {preset.id === defaultStudioTextPresetId ? (
        <DropdownMenuShortcut className="mt-0.5">T</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  ))
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The image could not be prepared for export."))
    reader.onerror = () =>
      reject(reader.error ?? new Error("The image could not be read."))
    reader.readAsDataURL(blob)
  })

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
        <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut ? (
          <kbd className="font-mono text-[9px] text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function StudioShell() {
  const persistence = useStudioPersistence()
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
  const [shellLayoutError, setShellLayoutError] = useState<string | null>(
    initialShellLayoutState.error
  )
  const desktopShellRef = useRef<HTMLDivElement>(null)
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
    (entry: { id: string }) => {
      clearGuideRedoRef.current()
      recordSessionAction({ kind: "document", id: entry.id })
    },
    [recordSessionAction]
  )
  const editor = useDocumentEditor({
    persistence,
    onHistoryCommit: onDocumentHistoryCommit,
  })
  useRecentDocumentsVisibility(editor.sessionMode === "start")
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
  const pageThumbnailRaster = useMemo(
    () => ({
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
  const publishedVersion =
    editor.publishSyncStatus === "synced"
      ? editor.latestPublishedVersion
      : undefined
  const renderHistory = useRenderHistory(publishedVersion)
  const [zoom, setZoom] = useState(0.34)
  const [autoFit, setAutoFit] = useState(true)
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
  const [mediaPicker, setMediaPicker] = useState<MediaPickerState | null>(null)
  const [newDocumentOpen, setNewDocumentOpen] = useState(false)
  const [startInitialFocus, setStartInitialFocus] = useState<
    "heading" | "document-library"
  >("heading")
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [guideManagerOpen, setGuideManagerOpen] = useState(false)
  const guideManagerTriggerRef = useRef<HTMLElement | null>(null)
  const [textEditingNodeId, setTextEditingNodeId] = useState<string | null>(
    null
  )
  const [documentPanelTab, setDocumentPanelTab] =
    useState<DocumentPanelTab>("templates")
  const [pdfExportState, setPdfExportState] = useState<
    "idle" | "exporting" | "error"
  >("idle")
  const {
    activeAction: criticalAction,
    error: criticalActionError,
    setError: setCriticalActionError,
    claim: claimCriticalAction,
    release: releaseCriticalAction,
    dispatch: dispatchCriticalAction,
  } = useCriticalActionOwner<
    "home" | "export-json" | "export-png" | "export-pdf"
  >()
  const [compactPanel, setCompactPanel] = useState<
    "document" | "inspector" | null
  >(null)
  const [imageSourceStateByNodeId, setImageSourceStateByNodeId] = useState<
    Partial<Record<string, InspectorImageSourceState>>
  >({})
  const workspaceRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<CanvasCamera>({ x: 0, y: 0, zoom: 0.34 })
  const artboardRef = useRef<FabricArtboardHandle>(null)
  const rulerGuideOverlayRef = useRef<CanvasRulerGuideOverlayHandle>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const quotationInputRef = useRef<HTMLInputElement>(null)
  const compactPanelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const insertShapeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mediaPickerFocusReturnRef = useRef<HTMLElement | null>(null)
  const cropFocusSessionRef = useRef<ImageCropFocusSession | null>(null)
  const cropWasActiveRef = useRef(false)
  const shortcutPlatform = useMemo(detectShortcutPlatform, [])
  const panSessionRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    cameraX: number
    cameraY: number
  } | null>(null)

  useEffect(() => {
    const shell = desktopShellRef.current
    if (!shell) return
    const measure = () => {
      const width = Math.max(0, Math.floor(shell.clientWidth))
      setShellAvailableWidth((current) => (current === width ? current : width))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    measure()
    return () => observer.disconnect()
  }, [])

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
    (presetId: StudioTextPresetId = defaultStudioTextPresetId) => {
      const nodeId = editor.addText(presetId)
      if (!nodeId) return false
      setTextEditingNodeId(nodeId)
      return true
    },
    [editor]
  )

  useEffect(() => {
    if (!textEditingNodeId) return
    if (editor.pendingChangeSet) {
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
    editor.selection,
    textEditingNodeId,
  ])

  const applyCamera = useCallback((camera: CanvasCamera) => {
    cameraRef.current = camera
    setZoom(camera.zoom)
    setCameraPosition({ x: camera.x, y: camera.y })
  }, [])

  const fitCanvas = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const camera = fitPageInViewport(
      { width: activePage.width, height: activePage.height },
      { width: workspace.clientWidth, height: workspace.clientHeight }
    )
    applyCamera(camera)
  }, [activePage.height, activePage.width, applyCamera])

  const focusWorkspaceAfterOpen = useCallback(() => {
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

  const draftReplacement = useDraftReplacement({
    hasCurrentDraft: editor.sessionMode === "workspace",
    workspaceActive: editor.sessionMode === "workspace",
    settleWorkspaceEdits: commitActiveTextEditing,
    flushCurrentDraft: editor.flushActiveDraft,
    onOpened: focusWorkspaceAfterOpen,
    onQueued: () => setNewDocumentOpen(false),
  })
  const pendingDraftReplacement = draftReplacement.pending
  const startPendingIntent = draftReplacement.pendingIntent
  const replacementRunning = draftReplacement.replacing
  const requestDraftReplacement = draftReplacement.request
  const confirmDraftReplacement = draftReplacement.confirm

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
    workspaceRef,
    cameraRef,
    applyCamera,
    onManualNavigation: markManualNavigation,
  })

  const zoomToSelection = useCallback(() => {
    const bounds = getSelectionBounds(editor.selectedNodes)
    if (bounds) focusBounds(bounds)
  }, [editor.selectedNodes, focusBounds])

  const inspectorCapabilityContext = {
    documentEditable: !editor.pendingChangeSet,
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
      initialCollection: MediaPickerState["initialCollection"] = "recent",
      targetNodeId?: string,
      focusReturnTarget?: HTMLElement | null
    ) => {
      mediaPickerFocusReturnRef.current =
        focusReturnTarget ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null)
      const target = targetNodeId
        ? editor.document.nodes.find((node) => node.id === targetNodeId)
        : null
      setMediaPicker({
        mode: targetNodeId ? "replace" : "insert",
        targetNodeId,
        targetName: target?.name,
        initialCollection,
      })
    },
    [editor.document.nodes]
  )

  const imageCommandCapabilities = deriveEditorImageCommandCapabilities({
    selectedNodes: editor.selectedNodes,
    inspectorCapabilities: imageSelectionCapabilities,
    documentEditable: !editor.pendingChangeSet,
    imageCropActive: Boolean(editor.imageCropSession),
    imageCropDraftChanged: editor.imageCropSession
      ? imageCropSessionHasChanges(editor.imageCropSession)
      : false,
    cropFrameMaskDraftSupported: true,
    activeImagePlacement: editor.imageCropSession?.draft,
    activeImageFrameMask: editor.imageCropSession?.draftFrameMask,
  })

  const commandContext: EditorCommandContext = {
    reviewPending: Boolean(editor.pendingChangeSet),
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
  const commandEnabled = (commandId: EditorCommandId) => {
    const cropSession = readImageCropSession()
    if (!cropSession) return isEditorCommandEnabled(commandId, commandContext)
    return isEditorCommandEnabled(commandId, {
      ...commandContext,
      imageCropActive: true,
      image: deriveEditorImageCommandCapabilities({
        selectedNodes: editor.selectedNodes,
        inspectorCapabilities: imageSelectionCapabilities,
        documentEditable: !editor.pendingChangeSet,
        imageCropActive: true,
        imageCropDraftChanged: imageCropSessionHasChanges(cropSession),
        cropFrameMaskDraftSupported: true,
        resizeFrameToImageSupported: Boolean(readResizeFrameToImagePreview()),
        activeImagePlacement: cropSession.draft,
        activeImageFrameMask: cropSession.draftFrameMask,
      }),
    })
  }
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
      getCommandCapabilities: () =>
        projectEditorCommandCapabilities(commandContext).map((capability) => ({
          ...capability,
          enabled: commandEnabled(capability.id),
        })),
      proposeChangeSet: editor.proposeChangeSet,
      publishTemplate: async () => {
        if (!commitActiveTextEditing()) {
          throw new Error(
            "Studio could not finish the active text edit before publishing."
          )
        }
        return editor.publishTemplate()
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
        reviewPending: Boolean(editor.pendingChangeSet),
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
          documentEditable: !editor.pendingChangeSet,
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
          "image.insert": () => openMediaPicker("recent"),
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
    const workspace = workspaceRef.current
    if (!workspace) return
    const measureWorkspace = () => {
      const next = {
        width: workspace.clientWidth,
        height: workspace.clientHeight,
      }
      setWorkspaceSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next
      )
      if (autoFit) fitCanvas()
    }
    const observer = new ResizeObserver(measureWorkspace)
    observer.observe(workspace)
    measureWorkspace()
    return () => observer.disconnect()
  }, [autoFit, fitCanvas])

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
      if (
        commandId &&
        runEditorCommand(commandId, { largeNudge: event.shiftKey })
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
    renameLayerTarget,
    removeWorkspaceGuide,
    runEditorCommand,
    shortcutReferenceOpen,
    structureCommandDialog,
    textEditingNodeId,
  ])

  useEffect(() => {
    const desktopShell = window.matchMedia("(min-width: 1280px)")
    const closeCompactPanel = () => {
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

  const materializeLocalExportNodes = async (
    documentSnapshot: ReturnType<typeof editor.getCurrentDocumentSnapshot>
  ) =>
    Promise.all(
      documentSnapshot.nodes.map(async (node) => {
        if (node.type !== "image") return node
        const localAssetId = localAssetIdFromSource(node.src)
        if (!localAssetId) return node
        const blob = await loadLocalAsset(localAssetId)
        if (!blob) {
          throw new Error(`The local image “${node.name}” is unavailable.`)
        }
        return { ...node, src: await blobToDataUrl(blob) }
      })
    )

  const exportPng = async () => {
    const requestedPageId = activePage.id
    try {
      if (editor.imageCropSession) return false
      if (!commitActiveTextEditing()) return false
      return exportPagePng({
        requestedPageId,
        flushActiveDraft: editor.flushActiveDraft,
        getCurrentDocumentSnapshot: editor.getCurrentDocumentSnapshot,
        materializeNodes: materializeLocalExportNodes,
        fetcher: fetch,
        download: (blob, filename) => {
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
    } catch (error) {
      setCriticalActionError(
        error instanceof Error ? error.message : "PNG export failed."
      )
      return false
    }
  }

  const exportPdf = async (outputId = activeOutput?.id) => {
    setPdfExportState("exporting")
    try {
      if (editor.imageCropSession) {
        setPdfExportState("idle")
        return false
      }
      if (!commitActiveTextEditing()) {
        setPdfExportState("idle")
        return false
      }
      if (!(await editor.flushActiveDraft())) {
        throw new Error(
          "PDF export stopped because the current document is not durably saved."
        )
      }
      const documentSnapshot = editor.getCurrentDocumentSnapshot()
      const exportOutput = documentSnapshot.outputs.find(
        (output) => output.id === outputId
      )
      if (!exportOutput || !exportOutput.exportFormats.includes("pdf")) {
        throw new Error("The selected output is not available for PDF export.")
      }
      const exportNodes = await materializeLocalExportNodes(documentSnapshot)
      const response = await fetch("/v1/studio/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputId: exportOutput.id,
          document: { ...documentSnapshot, nodes: exportNodes },
        }),
      })
      if (!response.ok) {
        throw new Error(`PDF export failed (${response.status}).`)
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.download = `${exportOutput.name.toLowerCase().replaceAll(" ", "-")}.pdf`
      link.href = objectUrl
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      setPdfExportState("idle")
      return true
    } catch (error) {
      setPdfExportState("error")
      setCriticalActionError(
        error instanceof Error ? error.message : "PDF export failed."
      )
      return false
    }
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

  const selectMediaAsset = async (selection: AssetLibrarySelection) => {
    if (!mediaPicker) return false
    if (mediaPicker.mode === "replace") {
      const nodeId = mediaPicker.targetNodeId
      if (!nodeId) return false
      const replacementBlock = editor.imageReplacementBlock(nodeId)
      if (replacementBlock) {
        return { ok: false, message: replacementBlock }
      }
      if (selection.kind === "library") {
        return editor.replaceImageWithLibraryAsset(nodeId, selection.asset)
      }
      if (selection.kind === "local") {
        return editor.replaceImageWithLocalAsset(nodeId, selection.asset)
      }
      return editor.replaceImageWithManagedMediaAsset(nodeId, selection.asset)
    }
    if (selection.kind === "library") {
      return editor.addLibraryAsset(selection.asset)
    }
    if (selection.kind === "local") {
      return editor.addLocalAsset(selection.asset)
    }
    return editor.addManagedMediaAsset(selection.asset)
  }

  const setManualZoom = (nextZoom: number) => zoomAtPoint(nextZoom)

  const updateNode = (nodeId: string, patch: Partial<SceneNode>) =>
    editor.updateNode(nodeId, patch)

  const startPanning = (event: React.PointerEvent<HTMLDivElement>) => {
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
      : editor.publishSyncStatus === "error"
        ? "Publish sync failed"
        : editor.publishSyncStatus === "synced" &&
            editor.latestPublishedVersion?.sourceSnapshotId ===
              editor.documentSnapshotId
          ? `Published v${editor.latestPublishedVersion.version}`
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
  const reviewLocked = Boolean(editor.pendingChangeSet)
  const cropLocked = Boolean(editor.imageCropSession)
  const outputBusy =
    criticalAction !== null ||
    pdfExportState === "exporting" ||
    reviewLocked ||
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
    structureByTarget: Object.fromEntries([
      ...editor.document.pages.map((page) => {
        const output = editor.document.outputs.find(
          (candidate) => candidate.id === page.outputId
        )
        return [
          page.id,
          {
            reviewPending: reviewLocked,
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
              reviewPending: reviewLocked,
              outputCount: editor.document.outputs.length,
              outputPageCount: output.pageIds.length,
            },
          ] as const
      ),
    ]),
    stateByCommandId: {
      ...projectGuideProductCommandState(guideWorkspace.preferences),
      "document.home": {
        enabled: !cropLocked && !reviewLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current save or export to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before going home."
            : reviewLocked
              ? "Resolve or discard the review preview before going home."
              : null,
      },
      "document.export-json": {
        enabled: !cropLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current save or export to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before exporting."
            : null,
      },
      "output.export-png": {
        enabled: !outputBusy,
        disabledReason: outputBusy
          ? "Finish the active review, crop, or export first."
          : null,
      },
      "document.publish": {
        enabled: !cropLocked && !reviewLocked && criticalAction === null,
        disabledReason: criticalAction
          ? "Wait for the current save or export to finish."
          : cropLocked
            ? "Finish or cancel the active image crop before publishing."
            : reviewLocked
              ? "Resolve or discard the review preview before publishing."
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

  // Product commands return synchronous dispatch acceptance. Critical async
  // actions claim the owner above before their first await; the status badge
  // and persistent error surface report their eventual outcome.
  const executeProductCommand = (
    invocation: ProductCommandInvocation
  ): boolean => {
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
        void editor
          .returnToStart()
          .then((returned) => {
            if (returned) {
              setStartInitialFocus("document-library")
              return
            }
            setCriticalActionError(
              "Home was cancelled because the current document could not be safely saved."
            )
          })
          .catch((error: unknown) => {
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
        return dispatchCriticalAction("export-png", exportPng)
      case "output.export-pdf": {
        if (invocation.target?.kind !== "output") return false
        const outputId = invocation.target.outputId
        return dispatchCriticalAction("export-pdf", () => exportPdf(outputId))
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

  const productCommandRuntime = createProductCommandRuntime({
    getContext: () => productCommandContext,
    execute: executeProductCommand,
  })
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
  const productMenuRuntime: ProductCommandMenuRuntime = {
    run: productCommandRuntime.run,
    shortcut: (commandId) =>
      formatProductCommandShortcut(commandId, shortcutPlatform),
  }
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
          <DraftRecoveryDialog
            recovery={editor.draftRecovery}
            notice={editor.draftRecoveryNotice}
            onDownload={editor.downloadDraftRecovery}
            onRetry={editor.retryDraftRecovery}
            onReset={editor.resetDraftRecovery}
          />
        </main>
      )
    }

    return (
      <>
        <StudioStartSurface
          actionError={editor.documentError ?? editor.templateActionError}
          hasQuotationSource={Boolean(editor.quotationSource)}
          initialFocus={startInitialFocus}
          model={editor.startModel}
          pendingIntent={startPendingIntent}
          templateLoadState={
            editor.designTemplateCatalog.status === "error"
              ? {
                  status: "error",
                  message:
                    editor.designTemplateCatalog.error ??
                    "The template catalog could not be loaded.",
                }
              : { status: editor.designTemplateCatalog.status }
          }
          templates={editor.designTemplateCatalog.items}
          onCreateBlank={() => setNewDocumentOpen(true)}
          onCreateFromTemplate={(template: DesignTemplateCatalogItem) => {
            void requestDraftReplacement(
              {
                kind: "template",
                templateId: template.id,
                version: template.version,
              },
              `Starting from ${template.name}`,
              () =>
                editor.createDocumentFromTemplate(template.id, template.version)
            )
          }}
          onImportFile={async (file) =>
            (await requestDraftReplacement(
              { kind: "import" },
              "Opening the selected Studio JSON file",
              () => editor.openDocumentFile(file)
            )) !== false
          }
          onOpenDocument={editor.openStoredDocument}
          onOpenSample={() => {
            void requestDraftReplacement(
              { kind: "sample" },
              "Opening the Northstar sample",
              editor.restoreDemoDocument
            )
          }}
          onRetryTemplates={editor.reloadDesignTemplateCatalog}
        />
        <NewDocumentDialog
          open={newDocumentOpen}
          starterMetadata={editor.starterMetadata}
          onCreateBlank={(options) =>
            requestDraftReplacement(
              { kind: "blank" },
              `Creating “${options.name}”`,
              () => editor.createBlankDocument(options)
            )
          }
          onCreated={focusWorkspaceAfterOpen}
          onOpenChange={setNewDocumentOpen}
          onRestoreDemo={() =>
            requestDraftReplacement(
              { kind: "sample" },
              "Opening the Northstar sample",
              editor.restoreDemoDocument
            )
          }
        />
        <ReplaceCurrentDraftDialog
          documentName={editor.document.name}
          error={editor.documentError}
          nextActionLabel={pendingDraftReplacement?.nextActionLabel ?? "This"}
          open={pendingDraftReplacement !== null}
          replacing={replacementRunning}
          onCancel={draftReplacement.cancel}
          onDownload={() => {
            if (commitActiveTextEditing()) editor.downloadCurrentVersion()
          }}
          onReplace={() => void confirmDraftReplacement()}
        />
      </>
    )
  }

  return (
    <Sheet
      open={compactPanel !== null}
      onOpenChange={(open) => {
        if (!open) setCompactPanel(null)
      }}
    >
      <main
        aria-hidden={compactPanel !== null ? true : undefined}
        inert={compactPanel !== null ? true : undefined}
        className="flex h-dvh min-h-dvh w-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic>
          {shellLayoutError ?? ""}
        </p>
        <header className="flex h-(--studio-topbar-height) min-w-0 shrink-0 items-center gap-1 border-b px-2 min-[1280px]:gap-3 min-[1280px]:px-3">
          <button
            aria-label="Go to Studio home"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 min-[1280px]:w-56 min-[1280px]:flex-none min-[1280px]:gap-2.5"
            disabled={!homeCommand.enabled}
            title={homeCommand.disabledReason ?? "Studio home"}
            type="button"
            onClick={() => {
              productCommandRuntime.run({ commandId: "document.home" })
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-col leading-none">
              <span className="truncate text-sm font-medium">
                {editor.document.name}
              </span>
              <span className="mt-1 truncate text-[10px] text-muted-foreground">
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
          <div className="hidden shrink-0 items-center gap-0.5 min-[640px]:flex">
            <IconButton
              label="Select"
              shortcut="V"
              className="size-11 min-[1280px]:size-7"
              variant={tool === "select" ? "secondary" : "ghost"}
              onClick={() => runEditorCommand("tool.select")}
            >
              <MousePointer2 />
            </IconButton>
            <IconButton
              label="Hand tool"
              shortcut="H"
              className="size-11 min-[1280px]:size-7"
              variant={tool === "hand" ? "secondary" : "ghost"}
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
              <DropdownMenuContent className="w-72">
                <DropdownMenuLabel>Text styles</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <TextPresetMenuItems
                    disabled={!commandEnabled("object.add-text")}
                    onSelect={insertTextPreset}
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
                    disabled={Boolean(editor.pendingChangeSet)}
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
                      Boolean(editor.pendingChangeSet)
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
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file && commitActiveTextEditing()) {
                  void editor.importDocumentFile(file)
                }
                event.currentTarget.value = ""
              }}
            />
            <input
              ref={quotationInputRef}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file && commitActiveTextEditing()) {
                  void editor.importQuotationFile(file)
                }
                event.currentTarget.value = ""
              }}
            />
          </div>
          <Separator
            className="hidden min-[860px]:block"
            orientation="vertical"
          />
          <div className="hidden shrink-0 items-center gap-0.5 min-[860px]:flex">
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
              <div className="hidden items-center gap-0.5 min-[1280px]:flex">
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
              disabled={cropLocked || reviewLocked || criticalAction !== null}
              onClick={() => setPublishDialogOpen(true)}
            >
              <Rocket data-icon="inline-start" />
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
                <ProductCommandDropdownGroups
                  menus={productMenus}
                  runtime={productMenuRuntime}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div
          ref={desktopShellRef}
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
                  templates={editor.designTemplateCatalog.items}
                  templateLoadState={
                    editor.designTemplateCatalog.status === "error"
                      ? {
                          status: "error",
                          message:
                            editor.designTemplateCatalog.error ??
                            "The template catalog could not be loaded.",
                        }
                      : { status: editor.designTemplateCatalog.status }
                  }
                  activeTemplate={editor.activeDesignTemplate}
                  hasQuotationSource={Boolean(editor.quotationSource)}
                  templateActionError={editor.templateActionError}
                  reviewPending={Boolean(editor.pendingChangeSet)}
                  activePanel={documentPanelTab}
                  onActivePanelChange={setDocumentPanelTab}
                  onRetryTemplates={editor.reloadDesignTemplateCatalog}
                  onCreateFromTemplate={(template) => {
                    void requestDraftReplacement(
                      {
                        kind: "template",
                        templateId: template.id,
                        version: template.version,
                      },
                      `Starting from ${template.name}`,
                      () =>
                        editor.createDocumentFromTemplate(
                          template.id,
                          template.version
                        )
                    )
                  }}
                  onApplyTemplate={(template) => {
                    if (!commitActiveTextEditing()) return
                    if (
                      editor.applyDesignTemplate(template.id, template.version)
                    ) {
                      setAutoFit(true)
                    }
                  }}
                  getTemplateApplicationImpact={(template) =>
                    editor.getDesignTemplateImpact(
                      template.id,
                      template.version
                    )
                  }
                  onSelectionChange={editor.setLayerSelection}
                  onFocusNode={focusNode}
                  onHoverNode={setHoveredNodeId}
                  onRenameNode={editor.renameLayerNode}
                  onRenameGroup={editor.updateGroup}
                  onUpdateLayerNodes={editor.updateLayerNodes}
                  onMoveLayer={editor.moveLayer}
                  onDeleteLayerNodes={editor.deleteLayerNodes}
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
            <EditorPanelHeader className="bg-background/92 backdrop-blur-sm">
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
                <span className="text-[10px] text-muted-foreground">
                  {activePage.width} × {activePage.height}
                </span>
              </div>
              {editor.selectedNodes.length ? (
                <div
                  className="ml-auto hidden min-w-0 items-center gap-1.5 rounded-md bg-[#0d99ff]/8 px-2 py-1 min-[640px]:flex"
                  role="status"
                  aria-live="polite"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-[#0d99ff]" />
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
              <div className="relative z-30 flex shrink-0 justify-center border-b bg-background/92 p-1 backdrop-blur-sm">
                <SelectedImageToolbar
                  image={selectedImage}
                  className="max-w-full shadow-sm"
                  onRunCommand={runEditorCommand}
                  isCommandEnabled={commandEnabled}
                />
              </div>
            ) : null}
            <ProductCommandContextMenu
              groups={canvasContextMenuGroups}
              runtime={productMenuRuntime}
            >
              <div
                ref={workspaceRef}
                aria-label="Canvas viewport"
                className={`workspace-grid relative min-h-0 flex-1 overflow-hidden overscroll-contain ${
                  isPanning
                    ? "cursor-grabbing select-none"
                    : tool === "hand" || spacePressed
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
                  className="absolute top-0 left-0 will-change-transform"
                  style={{
                    transform: `translate3d(${cameraPosition.x}px, ${cameraPosition.y}px, 0)`,
                  }}
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
                    interactive={!editor.pendingChangeSet}
                    onCanvasDoubleClick={({ clientX, clientY }) =>
                      zoomAtPoint(zoom * 1.75, clientX, clientY)
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
                      setTextEditingNodeId((requestedNodeId) =>
                        requestedNodeId === nodeId ? null : requestedNodeId
                      )
                    }}
                    onSelectionChange={editor.setSelection}
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
                      editor.pendingChangeSet || editor.draftRecovery
                    )}
                    onAddText={() => {
                      insertTextPreset()
                    }}
                    onAddImage={() => openMediaPicker("recent")}
                    onChooseTemplate={() => {
                      setDocumentPanelTab("templates")
                      if (resolvedShellLayout.canUseDesktopLayout) {
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
                    className="pointer-events-none absolute z-30 flex justify-center"
                    data-editor-overlay-control="true"
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
              </div>
            </ProductCommandContextMenu>

            <ProductPageFilmstrip
              document={editor.previewDocument}
              density={shellLayout.filmstripDensity}
              imageResourceTokens={imageReplacementResourceTokens}
              onImageResourceStateChange={handleReactImageResourceStateChange}
              activePageId={editor.activePageId}
              reviewPending={Boolean(editor.pendingChangeSet)}
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
              <div
                className={cn(
                  "absolute left-1/2 flex h-12 max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-lg border bg-background/96 px-1.5 shadow-sm backdrop-blur-sm min-[1280px]:h-9",
                  shellLayout.filmstripDensity === "compact"
                    ? "bottom-[100px] min-[1280px]:bottom-[108px]"
                    : "bottom-[100px] min-[1280px]:bottom-[132px]"
                )}
              >
                <IconButton
                  label="Zoom out"
                  shortcut="⌘−"
                  className="size-11 min-[1280px]:size-7"
                  onClick={() => setManualZoom(zoom / 1.2)}
                >
                  <ZoomOut />
                </IconButton>
                <Slider
                  aria-label="Canvas zoom"
                  className="mx-1 hidden w-24 min-[480px]:flex"
                  min={10}
                  max={400}
                  step={1}
                  value={[zoom * 100]}
                  onValueChange={([value]) => setManualZoom(value / 100)}
                />
                <Button
                  aria-label="Reset zoom to 100%"
                  className="h-11 w-14 px-1 font-mono text-[10px] text-muted-foreground tabular-nums min-[1280px]:h-7 min-[1280px]:w-12"
                  size="sm"
                  variant="ghost"
                  onClick={() => setManualZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </Button>
                <IconButton
                  label="Zoom in"
                  shortcut="⌘+"
                  className="size-11 min-[1280px]:size-7"
                  onClick={() => setManualZoom(zoom * 1.2)}
                >
                  <ZoomIn />
                </IconButton>
                <Separator
                  className="mx-0.5 hidden h-4 min-[640px]:block"
                  orientation="vertical"
                />
                <IconButton
                  label="Fit canvas"
                  shortcut="⇧1"
                  className="size-11 min-[1280px]:size-7"
                  onClick={() => {
                    setAutoFit(true)
                    fitCanvas()
                  }}
                >
                  <Scan />
                </IconButton>
                <IconButton
                  label="Zoom to selection"
                  shortcut="⇧2"
                  className="hidden size-11 min-[640px]:inline-flex min-[1280px]:size-7"
                  disabled={!editor.selectedNodes.length}
                  onClick={zoomToSelection}
                >
                  <Focus />
                </IconButton>
              </div>
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
                  selectedNodes={editor.selectedNodes}
                  imageCropPreviewStore={editor.imageCropPreviewStore}
                  capabilityContext={inspectorCapabilityContext}
                  pendingChangeSet={editor.pendingChangeSet}
                  lastResolvedChangeSet={editor.lastResolvedChangeSet}
                  changeSetConflict={editor.changeSetConflict}
                  changeSetError={editor.changeSetError}
                  isApplyingChangeSet={editor.isApplyingChangeSet}
                  webMcpStatus={webMcp.status}
                  webMcpError={webMcp.error}
                  onUpdateNode={updateNode}
                  onUpdateSelection={editor.updateSelectionNodes}
                  onUpdateField={editor.updateField}
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
            side={compactPanel === "document" ? "left" : "right"}
            className="w-[min(22rem,calc(100vw-0.5rem))] gap-0 overflow-hidden overscroll-contain bg-background min-[1280px]:hidden sm:max-w-[22rem] [&>[data-slot=sheet-close]]:size-11"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              compactPanelTriggerRef.current?.focus()
            }}
          >
            <SheetHeader className="h-11 shrink-0 justify-center gap-0 border-b px-3 py-0 pr-14">
              <SheetTitle className="text-xs leading-none font-medium">
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
                templates={editor.designTemplateCatalog.items}
                templateLoadState={
                  editor.designTemplateCatalog.status === "error"
                    ? {
                        status: "error",
                        message:
                          editor.designTemplateCatalog.error ??
                          "The template catalog could not be loaded.",
                      }
                    : { status: editor.designTemplateCatalog.status }
                }
                activeTemplate={editor.activeDesignTemplate}
                hasQuotationSource={Boolean(editor.quotationSource)}
                templateActionError={editor.templateActionError}
                reviewPending={Boolean(editor.pendingChangeSet)}
                activePanel={documentPanelTab}
                onActivePanelChange={setDocumentPanelTab}
                onRetryTemplates={editor.reloadDesignTemplateCatalog}
                onCreateFromTemplate={(template) => {
                  setCompactPanel(null)
                  void requestDraftReplacement(
                    {
                      kind: "template",
                      templateId: template.id,
                      version: template.version,
                    },
                    `Starting from ${template.name}`,
                    () =>
                      editor.createDocumentFromTemplate(
                        template.id,
                        template.version
                      )
                  )
                }}
                onApplyTemplate={(template) => {
                  if (!commitActiveTextEditing()) return
                  if (
                    editor.applyDesignTemplate(template.id, template.version)
                  ) {
                    setAutoFit(true)
                    setCompactPanel(null)
                  }
                }}
                getTemplateApplicationImpact={(template) =>
                  editor.getDesignTemplateImpact(template.id, template.version)
                }
                onSelectionChange={editor.setLayerSelection}
                onFocusNode={focusNode}
                onHoverNode={setHoveredNodeId}
                onRenameNode={editor.renameLayerNode}
                onRenameGroup={editor.updateGroup}
                onUpdateLayerNodes={editor.updateLayerNodes}
                onMoveLayer={editor.moveLayer}
                onDeleteLayerNodes={editor.deleteLayerNodes}
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
                selectedNodes={editor.selectedNodes}
                imageCropPreviewStore={editor.imageCropPreviewStore}
                capabilityContext={inspectorCapabilityContext}
                pendingChangeSet={editor.pendingChangeSet}
                lastResolvedChangeSet={editor.lastResolvedChangeSet}
                changeSetConflict={editor.changeSetConflict}
                changeSetError={editor.changeSetError}
                isApplyingChangeSet={editor.isApplyingChangeSet}
                webMcpStatus={webMcp.status}
                webMcpError={webMcp.error}
                onUpdateNode={updateNode}
                onUpdateSelection={editor.updateSelectionNodes}
                onUpdateField={editor.updateField}
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
                onRemoveImageLayer={editor.deleteSelection}
              />
            )}
          </SheetContent>
        </div>
        <AssetLibraryDialog
          open={mediaPicker !== null}
          onOpenChange={(open) => {
            if (!open) {
              const focusReturnTarget = mediaPickerFocusReturnRef.current
              setMediaPicker(null)
              window.requestAnimationFrame(() => {
                if (focusReturnTarget?.isConnected) focusReturnTarget.focus()
                mediaPickerFocusReturnRef.current = null
              })
            }
          }}
          mode={mediaPicker?.mode ?? "insert"}
          targetName={mediaPicker?.targetName}
          document={editor.document}
          initialCollection={mediaPicker?.initialCollection}
          onSelect={selectMediaAsset}
          onLocateMissingLocalAsset={(assetId) => {
            const target = editor.document.nodes.find(
              (node) =>
                node.type === "image" &&
                (node.assetId === assetId ||
                  node.src === `asset:local/${assetId}`)
            )
            if (!target) return
            focusNode(target.id)
            setMediaPicker({
              mode: "replace",
              targetNodeId: target.id,
              targetName: target.name,
              initialCollection: "uploads",
            })
          }}
          onNavigateToReference={({ nodeId, pageId }) => {
            if (nodeId) {
              focusNode(nodeId)
            } else if (pageId) {
              editor.selectPage(pageId)
            }
          }}
        />
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
        <ReplaceCurrentDraftDialog
          documentName={editor.document.name}
          error={editor.documentError}
          nextActionLabel={pendingDraftReplacement?.nextActionLabel ?? "This"}
          open={pendingDraftReplacement !== null}
          replacing={replacementRunning}
          onCancel={draftReplacement.cancel}
          onDownload={() => {
            if (commitActiveTextEditing()) editor.downloadCurrentVersion()
          }}
          onReplace={() => void confirmDraftReplacement()}
        />
        <NewDocumentDialog
          open={newDocumentOpen}
          onOpenChange={setNewDocumentOpen}
          onCreateBlank={(options) => {
            return requestDraftReplacement(
              { kind: "blank" },
              `Creating “${options.name}”`,
              () => editor.createBlankDocument(options)
            )
          }}
          onRestoreDemo={() => {
            return requestDraftReplacement(
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
        <PublishDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          document={editor.document}
          documentSnapshotId={editor.documentSnapshotId}
          templateId={editor.currentTemplateId}
          latestVersion={editor.latestPublishedVersion}
          pendingChangeSet={Boolean(editor.pendingChangeSet)}
          publishError={editor.publishError}
          publishSyncStatus={editor.publishSyncStatus}
          onPublish={async () => {
            if (!commitActiveTextEditing()) {
              throw new Error(
                "Studio could not finish the active text edit before publishing."
              )
            }
            return editor.publishTemplate()
          }}
        />
        <ApiPlaygroundDialog
          open={apiPlaygroundOpen}
          onOpenChange={setApiPlaygroundOpen}
          version={publishedVersion}
          renderHistory={renderHistory}
          onRequestPublish={() => {
            setApiPlaygroundOpen(false)
            setPublishDialogOpen(true)
          }}
        />
        <StudioCommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          items={commandPaletteItems}
        />
        <KeyboardShortcutsDialog
          open={shortcutReferenceOpen}
          onOpenChange={setShortcutReferenceOpen}
          items={commandPaletteItems}
        />
        <GuideManagerDialog
          open={guideManagerOpen}
          onOpenChange={setGuideManagerOpen}
          pageName={activePage.name}
          pageSize={{ width: activePage.width, height: activePage.height }}
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
        <RenameLayerDialog
          target={renameLayerTarget}
          onOpenChange={(open) => {
            if (!open) setRenameLayerTarget(null)
          }}
          onRename={editor.renameLayerNode}
        />
        <StructureCommandDialogs
          state={structureCommandDialog}
          onOpenChange={(open) => {
            if (!open) setStructureCommandDialog(null)
          }}
          onRenamePage={(pageId, name) => editor.updatePage(pageId, { name })}
          onRenameOutput={editor.updateOutput}
          onAddOutput={editor.addOutput}
          onDeletePage={editor.removePage}
          onDeleteOutput={editor.removeOutput}
        />
      </main>
    </Sheet>
  )
}
