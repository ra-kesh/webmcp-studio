import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Clipboard,
  Cloud,
  CopyPlus,
  Circle,
  Download,
  FileJson2,
  Focus,
  Heart,
  Hand,
  ImagePlus,
  Images,
  Layers3,
  Minus,
  MousePointer2,
  Redo2,
  Scan,
  Shapes,
  Sparkles,
  Square,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react"
import type { SceneNode } from "@webmcp/document"
import { getSelectionBounds } from "@webmcp/editor/geometry"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { EditorPanelHeader } from "@webmcp/ui/components/editor-chrome"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { DocumentSidebar } from "./editor/document-sidebar"
import { AssetLibraryDialog } from "./editor/asset-library-dialog"
import {
  FabricArtboard,
  type FabricArtboardHandle,
} from "./editor/fabric-artboard"
import { InspectorSidebar } from "./editor/inspector-sidebar"
import { useDocumentEditor } from "./editor/use-document-editor"

const HEART_ICON_PATH =
  "M12 21.35 10.55 20.03C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.54Z"

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

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
  const editor = useDocumentEditor()
  const [zoom, setZoom] = useState(0.34)
  const [autoFit, setAutoFit] = useState(true)
  const [focusGutter, setFocusGutter] = useState<{
    x: number
    y: number
  } | null>(null)
  const [tool, setTool] = useState<"select" | "hand">("select")
  const [spacePressed, setSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [apiCopied, setApiCopied] = useState(false)
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
  const [compactPanel, setCompactPanel] = useState<
    "document" | "inspector" | null
  >(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const artboardRef = useRef<FabricArtboardHandle>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const pendingImageReplacementRef = useRef<string | null>(null)
  const panSessionRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const activePage = editor.document.pages.find(
    (page) => page.id === editor.activePageId
  )

  const centerCanvasInWorkspace = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const workspace = workspaceRef.current
        const canvas = workspace?.querySelector<HTMLElement>(".upper-canvas")
        if (!workspace || !canvas) return
        const workspaceRect = workspace.getBoundingClientRect()
        const canvasRect = canvas.getBoundingClientRect()
        workspace.scrollTo({
          left:
            workspace.scrollLeft +
            canvasRect.left +
            canvasRect.width / 2 -
            (workspaceRect.left + workspaceRect.width / 2),
          top:
            workspace.scrollTop +
            canvasRect.top +
            canvasRect.height / 2 -
            (workspaceRect.top + workspaceRect.height / 2),
          behavior: "auto",
        })
      })
    })
  }, [])

  const fitCanvas = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace || !activePage) return
    const nextZoom = Math.min(
      (workspace.clientWidth - 112) / activePage.width,
      (workspace.clientHeight - 112) / activePage.height,
      0.7
    )
    setFocusGutter(null)
    setZoom(Math.max(0.22, nextZoom))
    centerCanvasInWorkspace()
  }, [activePage, centerCanvasInWorkspace])

  const zoomToSelection = useCallback(() => {
    const workspace = workspaceRef.current
    const bounds = getSelectionBounds(editor.selectedNodes)
    if (!workspace || !bounds) return
    const nextZoom = Math.min(
      (workspace.clientWidth - 128) / Math.max(bounds.width, 1),
      (workspace.clientHeight - 128) / Math.max(bounds.height, 1),
      0.7
    )
    setAutoFit(false)
    setFocusGutter({
      x: workspace.clientWidth / 2,
      y: workspace.clientHeight / 2,
    })
    setZoom(Math.max(0.12, nextZoom))
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const canvas = workspace.querySelector<HTMLElement>(".upper-canvas")
        if (!canvas) return
        const workspaceRect = workspace.getBoundingClientRect()
        const canvasRect = canvas.getBoundingClientRect()
        const selectedCenterX =
          canvasRect.left - workspaceRect.left + bounds.centerX * nextZoom
        const selectedCenterY =
          canvasRect.top - workspaceRect.top + bounds.centerY * nextZoom
        workspace.scrollTo({
          left:
            workspace.scrollLeft + selectedCenterX - workspace.clientWidth / 2,
          top:
            workspace.scrollTop + selectedCenterY - workspace.clientHeight / 2,
          behavior: "auto",
        })
      })
    })
  }, [editor.selectedNodes])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const observer = new ResizeObserver(() => {
      if (autoFit) fitCanvas()
    })
    observer.observe(workspace)
    if (autoFit) fitCanvas()
    return () => observer.disconnect()
  }, [autoFit, fitCanvas])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.code === "Space") {
        event.preventDefault()
        setSpacePressed(true)
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "h"
      ) {
        setTool("hand")
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "v"
      ) {
        setTool("select")
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
  }, [])

  if (!activePage) return null

  const selectNode = (nodeId: string, additive: boolean) => {
    const current = editor.selection?.nodeIds ?? []
    const nodeIds = additive
      ? current.includes(nodeId)
        ? current.filter((currentId) => currentId !== nodeId)
        : [...current, nodeId]
      : [nodeId]
    editor.setSelection(
      nodeIds.length ? { pageId: activePage.id, nodeIds } : null
    )
  }

  const exportPng = () => {
    const dataUrl = artboardRef.current?.exportPng()
    if (!dataUrl) return
    const [header, payload] = dataUrl.split(",")
    if (!header || !payload) return
    const bytes = Uint8Array.from(atob(payload), (character) =>
      character.charCodeAt(0)
    )
    const objectUrl = URL.createObjectURL(
      new Blob([bytes], { type: "image/png" })
    )
    const link = document.createElement("a")
    link.download = `${activePage.name.toLowerCase().replaceAll(" ", "-")}.png`
    link.href = objectUrl
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  const exportDocumentJson = () => {
    const contents = JSON.stringify(editor.document, null, 2)
    const objectUrl = URL.createObjectURL(
      new Blob([contents], { type: "application/json" })
    )
    const link = document.createElement("a")
    const slug =
      editor.document.name
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
  }

  const openImagePicker = (replacementNodeId: string | null = null) => {
    pendingImageReplacementRef.current = replacementNodeId
    imageInputRef.current?.click()
  }

  const copyApiExample = async () => {
    await navigator.clipboard.writeText(
      `curl -X POST https://your-studio.example/v1/studio/render \\\n+  -H "Authorization: Bearer $STUDIO_API_KEY" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"templateId":"northstar-wedding","data":{"couple_names":"Aditi & Kabir"},"formats":["png"]}'`
    )
    setApiCopied(true)
    window.setTimeout(() => setApiCopied(false), 1600)
  }

  const setManualZoom = (nextZoom: number) => {
    setAutoFit(false)
    setZoom(Math.min(0.7, Math.max(0.12, nextZoom)))
  }

  const updateNode = (nodeId: string, patch: Partial<SceneNode>) =>
    editor.updateNode(nodeId, patch)

  const startPanning = (event: React.PointerEvent<HTMLDivElement>) => {
    const shouldPan = tool === "hand" || spacePressed || event.button === 1
    if (!shouldPan) return
    event.preventDefault()
    event.stopPropagation()
    const workspace = event.currentTarget
    panSessionRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop,
    }
    workspace.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  const continuePanning = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.scrollLeft =
      session.scrollLeft - (event.clientX - session.clientX)
    event.currentTarget.scrollTop =
      session.scrollTop - (event.clientY - session.clientY)
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

  return (
    <main className="flex h-dvh min-h-dvh w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-(--studio-topbar-height) shrink-0 items-center gap-3 border-b px-3">
        <div className="flex w-44 min-w-0 items-center gap-2.5 sm:w-60">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
          <div className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-sm font-medium">
              {editor.document.name}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">
              Template · Revision {editor.document.revision}
            </span>
          </div>
        </div>

        <Separator orientation="vertical" />
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Select"
            shortcut="V"
            variant={tool === "select" ? "secondary" : "ghost"}
            onClick={() => {
              setTool("select")
              editor.setSelection(null)
            }}
          >
            <MousePointer2 />
          </IconButton>
          <IconButton
            label="Hand tool"
            shortcut="H"
            variant={tool === "hand" ? "secondary" : "ghost"}
            onClick={() => setTool("hand")}
          >
            <Hand />
          </IconButton>
          <IconButton label="Add text" shortcut="T" onClick={editor.addText}>
            <Type />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Insert shape"
                title="Insert shape"
                size="icon-sm"
                variant="ghost"
              >
                <Shapes />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Add to canvas</DropdownMenuLabel>
                <DropdownMenuItem onSelect={editor.addRectangle}>
                  <Square />
                  Rectangle
                  <DropdownMenuShortcut>R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={editor.addEllipse}>
                  <Circle />
                  Ellipse
                  <DropdownMenuShortcut>O</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={editor.addLine}>
                  <Minus />
                  Line
                  <DropdownMenuShortcut>L</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
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
                  disabled={editor.isImportingAsset}
                  onSelect={() => openImagePicker()}
                >
                  <ImagePlus />
                  {editor.isImportingAsset ? "Adding image…" : "Upload image…"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAssetLibraryOpen(true)}>
                  <Images />
                  Asset library…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={imageInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              const replacementNodeId = pendingImageReplacementRef.current
              if (file && replacementNodeId) {
                void editor.replaceImageFile(replacementNodeId, file)
              } else if (file) {
                void editor.addImageFile(file)
              }
              pendingImageReplacementRef.current = null
              event.currentTarget.value = ""
            }}
          />
          <input
            ref={documentInputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void editor.importDocumentFile(file)
              event.currentTarget.value = ""
            }}
          />
        </div>
        <Separator orientation="vertical" />
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Undo"
            shortcut="⌘Z"
            disabled={!editor.canUndo}
            onClick={editor.undo}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            label="Redo"
            shortcut="⇧⌘Z"
            disabled={!editor.canRedo}
            onClick={editor.redo}
          >
            <Redo2 />
          </IconButton>
        </div>

        {editor.selection?.nodeIds.length ? (
          <>
            <Separator orientation="vertical" />
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Copy"
                shortcut="⌘C"
                onClick={editor.copySelection}
              >
                <ClipboardCopy />
              </IconButton>
              <IconButton
                label="Duplicate"
                shortcut="⌘D"
                onClick={editor.duplicateSelection}
              >
                <CopyPlus />
              </IconButton>
              <IconButton
                label="Delete"
                shortcut="⌫"
                onClick={editor.deleteSelection}
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
            onClick={editor.pasteSelection}
          >
            <ClipboardPaste />
          </IconButton>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {editor.assetError ? (
            <Badge
              variant="destructive"
              className="hidden max-w-64 truncate font-normal min-[1050px]:inline-flex"
              title={editor.assetError}
            >
              {editor.assetError}
            </Badge>
          ) : null}
          {editor.documentError ? (
            <Badge
              variant="destructive"
              className="hidden max-w-64 truncate font-normal min-[1050px]:inline-flex"
              title={editor.documentError}
            >
              {editor.documentError}
            </Badge>
          ) : null}
          <Badge
            variant={editor.saveStatus === "error" ? "destructive" : "outline"}
            className="hidden font-normal text-muted-foreground min-[900px]:inline-flex"
          >
            {editor.saveStatus === "saving" ? (
              <Cloud data-icon="inline-start" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            {editor.saveStatus === "error"
              ? "Draft could not be saved"
              : editor.saveStatus === "saving"
                ? "Saving…"
                : editor.saveStatus === "restored"
                  ? "Draft restored"
                  : "All changes saved"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="hidden min-[760px]:inline-flex"
            onClick={() => void copyApiExample()}
          >
            {apiCopied ? (
              <Check data-icon="inline-start" />
            ) : (
              <Clipboard data-icon="inline-start" />
            )}
            {apiCopied ? "Copied" : "API example"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Document file actions"
                size="icon-sm"
                variant="outline"
              >
                <FileJson2 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Studio document</DropdownMenuLabel>
              <DropdownMenuItem onSelect={exportDocumentJson}>
                <Download />
                Export document JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => documentInputRef.current?.click()}
              >
                <FileJson2 />
                Import document JSON…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={exportPng}>
            <Download data-icon="inline-start" />
            Export PNG
          </Button>
        </div>
      </header>

      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] min-[1120px]:grid-cols-[236px_minmax(540px,1fr)_320px]">
        <DocumentSidebar
          className="hidden min-[1120px]:flex"
          document={editor.previewDocument}
          activePageId={editor.activePageId}
          selection={editor.selection}
          onSelectPage={editor.selectPage}
          onSelectNode={selectNode}
          onUpdateNode={updateNode}
          onReorderNode={editor.reorderNode}
        />

        <section className="relative flex min-h-0 flex-col bg-workspace">
          <EditorPanelHeader className="bg-background/92 backdrop-blur-sm">
            <IconButton
              label="Open outputs and layers"
              className="mr-1 min-[1120px]:hidden"
              onClick={() => setCompactPanel("document")}
            >
              <Layers3 />
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
              <div className="ml-auto flex items-center gap-2">
                <span className="max-w-64 truncate text-[11px] text-muted-foreground">
                  {editor.selectedNodes.length === 1
                    ? editor.selectedNodes[0]?.name
                    : `${editor.selectedNodes.length} layers selected`}
                </span>
              </div>
            ) : null}
            <IconButton
              label="Open properties"
              className="ml-1 min-[1120px]:hidden"
              onClick={() => setCompactPanel("inspector")}
            >
              <SlidersHorizontal />
            </IconButton>
          </EditorPanelHeader>
          <div
            ref={workspaceRef}
            className={`workspace-grid min-h-0 flex-1 overflow-auto ${
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
          >
            <div
              className="flex h-max min-h-full w-max min-w-full items-center justify-center p-6 min-[1120px]:p-14 sm:p-10"
              style={
                focusGutter
                  ? {
                      paddingInline: focusGutter.x,
                      paddingBlock: focusGutter.y,
                    }
                  : undefined
              }
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  editor.setSelection(null)
                }
              }}
            >
              <FabricArtboard
                ref={artboardRef}
                document={editor.previewDocument}
                pageId={activePage.id}
                selection={editor.selection}
                zoom={zoom}
                onSelectionChange={editor.setSelection}
                onNodesChange={editor.updateNodes}
              />
            </div>
          </div>

          <div className="absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-lg border bg-background/96 px-1.5 shadow-sm backdrop-blur-sm">
            <IconButton
              label="Zoom out"
              onClick={() => setManualZoom(zoom - 0.05)}
            >
              <ZoomOut />
            </IconButton>
            <Slider
              aria-label="Canvas zoom"
              className="mx-1 w-24"
              min={12}
              max={70}
              step={1}
              value={[zoom * 100]}
              onValueChange={([value]) =>
                value !== undefined && setManualZoom(value / 100)
              }
            />
            <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <IconButton
              label="Zoom in"
              onClick={() => setManualZoom(zoom + 0.05)}
            >
              <ZoomIn />
            </IconButton>
            <Separator className="mx-0.5 h-4" orientation="vertical" />
            <IconButton
              label="Fit canvas"
              onClick={() => {
                setAutoFit(true)
                fitCanvas()
              }}
            >
              <Scan />
            </IconButton>
            <IconButton
              label="Zoom to selection"
              disabled={!editor.selectedNodes.length}
              onClick={zoomToSelection}
            >
              <Focus />
            </IconButton>
          </div>
        </section>

        <InspectorSidebar
          className="hidden min-[1120px]:flex"
          document={editor.document}
          selectedNodes={editor.selectedNodes}
          onUpdateNode={updateNode}
          onUpdateField={editor.updateField}
          onAlignSelection={editor.alignSelection}
          onAlignSelectionToPage={editor.alignSelectionToPage}
          onDistributeSelection={editor.distributeSelection}
          onSetSelectionLocked={editor.setSelectionLocked}
          onSetSelectionVisible={editor.setSelectionVisible}
          onReorderSelection={editor.reorderSelection}
          onDuplicateSelection={editor.duplicateSelection}
          onDeleteSelection={editor.deleteSelection}
          onReplaceImage={openImagePicker}
        />

        {compactPanel ? (
          <div className="absolute inset-0 z-40 min-[1120px]:hidden">
            <button
              type="button"
              aria-label="Close panel"
              className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
              onClick={() => setCompactPanel(null)}
            />
            <div
              className={`absolute inset-y-0 flex w-[min(22rem,88vw)] flex-col bg-background shadow-2xl ${
                compactPanel === "document" ? "left-0" : "right-0"
              }`}
            >
              <EditorPanelHeader>
                <span className="text-xs font-medium">
                  {compactPanel === "document"
                    ? "Document navigator"
                    : "Properties"}
                </span>
                <Button
                  aria-label="Close panel"
                  className="ml-auto"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setCompactPanel(null)}
                >
                  <X />
                </Button>
              </EditorPanelHeader>
              {compactPanel === "document" ? (
                <DocumentSidebar
                  className="min-h-0 flex-1 border-r-0"
                  document={editor.previewDocument}
                  activePageId={editor.activePageId}
                  selection={editor.selection}
                  onSelectPage={(pageId) => {
                    editor.selectPage(pageId)
                    setCompactPanel(null)
                  }}
                  onSelectNode={selectNode}
                  onUpdateNode={updateNode}
                  onReorderNode={editor.reorderNode}
                />
              ) : (
                <InspectorSidebar
                  className="min-h-0 flex-1 border-l-0"
                  document={editor.document}
                  selectedNodes={editor.selectedNodes}
                  onUpdateNode={updateNode}
                  onUpdateField={editor.updateField}
                  onAlignSelection={editor.alignSelection}
                  onAlignSelectionToPage={editor.alignSelectionToPage}
                  onDistributeSelection={editor.distributeSelection}
                  onSetSelectionLocked={editor.setSelectionLocked}
                  onSetSelectionVisible={editor.setSelectionVisible}
                  onReorderSelection={editor.reorderSelection}
                  onDuplicateSelection={editor.duplicateSelection}
                  onDeleteSelection={editor.deleteSelection}
                  onReplaceImage={openImagePicker}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
      <AssetLibraryDialog
        open={assetLibraryOpen}
        onOpenChange={setAssetLibraryOpen}
        onInsert={editor.addLibraryAsset}
        onUpload={() => openImagePicker()}
      />
    </main>
  )
}
