import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  Clipboard,
  Cloud,
  Copy,
  Download,
  Layers3,
  MousePointer2,
  Redo2,
  Scan,
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
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { DocumentSidebar } from "./editor/document-sidebar"
import {
  FabricArtboard,
  type FabricArtboardHandle,
} from "./editor/fabric-artboard"
import { InspectorSidebar } from "./editor/inspector-sidebar"
import { useDocumentEditor } from "./editor/use-document-editor"

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
  const [apiCopied, setApiCopied] = useState(false)
  const [compactPanel, setCompactPanel] = useState<
    "document" | "inspector" | null
  >(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const artboardRef = useRef<FabricArtboardHandle>(null)
  const activePage = editor.document.pages.find(
    (page) => page.id === editor.activePageId
  )

  const fitCanvas = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace || !activePage) return
    const nextZoom = Math.min(
      (workspace.clientWidth - 112) / activePage.width,
      (workspace.clientHeight - 112) / activePage.height,
      0.7
    )
    setZoom(Math.max(0.22, nextZoom))
  }, [activePage])

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

  return (
    <main className="flex h-dvh min-h-dvh w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
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

        <Separator className="h-5" orientation="vertical" />
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Select"
            shortcut="V"
            onClick={() => editor.setSelection(null)}
          >
            <MousePointer2 />
          </IconButton>
          <IconButton label="Add text" shortcut="T" onClick={editor.addText}>
            <Type />
          </IconButton>
          <IconButton
            label="Add rectangle"
            shortcut="R"
            onClick={editor.addRectangle}
          >
            <Square />
          </IconButton>
        </div>
        <Separator className="h-5" orientation="vertical" />
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
            <Separator className="h-5" orientation="vertical" />
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Duplicate"
                shortcut="⌘D"
                onClick={editor.duplicateSelection}
              >
                <Copy />
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

        <div className="ml-auto flex items-center gap-2">
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
          <Button size="sm" onClick={exportPng}>
            <Download data-icon="inline-start" />
            Export PNG
          </Button>
        </div>
      </header>

      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] min-[1120px]:grid-cols-[236px_minmax(540px,1fr)_320px]">
        <DocumentSidebar
          className="hidden min-[1120px]:flex"
          document={editor.document}
          activePageId={editor.activePageId}
          selection={editor.selection}
          onSelectPage={editor.selectPage}
          onSelectNode={selectNode}
          onUpdateNode={updateNode}
          onReorderNode={editor.reorderNode}
        />

        <section className="relative flex min-h-0 flex-col bg-workspace">
          <div className="flex h-11 shrink-0 items-center border-b bg-background/92 px-3 backdrop-blur-sm">
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
          </div>
          <div
            ref={workspaceRef}
            className="workspace-grid flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 min-[1120px]:p-14 sm:p-10"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                editor.setSelection(null)
            }}
          >
            <FabricArtboard
              ref={artboardRef}
              document={editor.document}
              pageId={activePage.id}
              selection={editor.selection}
              zoom={zoom}
              onSelectionChange={editor.setSelection}
              onNodesChange={editor.updateNodes}
            />
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
          </div>
        </section>

        <InspectorSidebar
          className="hidden min-[1120px]:flex"
          document={editor.document}
          selectedNodes={editor.selectedNodes}
          onUpdateNode={updateNode}
          onUpdateField={editor.updateField}
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
              <div className="flex h-11 shrink-0 items-center border-b px-3">
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
              </div>
              {compactPanel === "document" ? (
                <DocumentSidebar
                  className="min-h-0 flex-1 border-r-0"
                  document={editor.document}
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
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
