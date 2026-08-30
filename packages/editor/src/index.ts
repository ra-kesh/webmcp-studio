import type {
  ChangeSet,
  Document,
  DocumentCommand,
  ImageFrameMask,
  ImagePlacement,
  SceneNode,
  TextRunStylePatch,
  TextSelection,
  TextSelectionStyleState,
} from "@webmcp/document"
import type { AlignmentSnapTarget } from "./snapping"

export type Selection = {
  pageId: string
  nodeIds: string[]
}

export type NodeGeometryPatch = Pick<
  SceneNode,
  "x" | "y" | "width" | "height" | "rotation"
>

export type CanvasAdapterEvents = {
  onSelectionChange(selection: Selection | null): void
  onNodesChange(changes: CanvasNodeChange[]): boolean | void
  onCanvasDoubleClick?(point: { clientX: number; clientY: number }): void
  onContextMenu?(request: CanvasContextMenuRequest): void
  onImageDoubleClick?(nodeId: string): void
  onImageCropPreview?(preview: CanvasImageCropPreview): void
  onTextEditingChange?(state: CanvasTextEditingState | null): void
}

export type CanvasTextEditingState = Readonly<{
  nodeId: string
  text: string
  selection: TextSelection
  style: TextSelectionStyleState
}>

export type CanvasContextMenuRequest = Readonly<{
  clientX: number
  clientY: number
  nodeId: string | null
}>

export type CanvasImageCropMode = Readonly<{
  nodeId: string
  placement: Readonly<ImagePlacement>
}>

export type CanvasImageCropPreview = Readonly<{
  nodeId: string
  placement: Readonly<ImagePlacement>
}>

export type CanvasImageCropDraft = Readonly<{
  nodeId: string
  placement: Readonly<ImagePlacement>
  frame: NodeGeometryPatch
  frameMask: Readonly<ImageFrameMask>
}>

export type CanvasImageSourceReadiness = "ready" | "unavailable"

export type CanvasNodeChange = {
  nodeId: string
  patch: Partial<SceneNode>
}

export interface CanvasAdapter {
  mount(element: HTMLCanvasElement): void
  unmount(): Promise<void>
  sync(document: Document, pageId: string, signal?: AbortSignal): Promise<void>
  setViewportZoom(zoom: number): void
  setSnapTargets(pageId: string, targets: readonly AlignmentSnapTarget[]): void
  select(selection: Selection | null): void
  getSelection(): Selection | null
  enterTextEditing(nodeId: string): boolean
  commitTextEditing(): boolean
  cancelTextEditing(): boolean
  applyTextEditingStyle(patch: TextRunStylePatch): boolean
  cancelTransform(): boolean
  setImageCropMode(mode: CanvasImageCropMode | null): boolean
  previewImageCropDraft(draft: CanvasImageCropDraft): boolean
  nudgeImageCrop(screenDelta: { x: number; y: number }, zoom: number): boolean
  getImageNaturalSize(
    nodeId: string
  ): Readonly<{ width: number; height: number }> | null
  getImageSourceReadiness(nodeId: string): CanvasImageSourceReadiness | null
  retryImageSource(
    nodeId: string,
    signal?: AbortSignal
  ): Promise<CanvasImageSourceReadiness | null>
  exportPng(): string | null
}

export type EditorState = {
  document: Document
  activePageId: string
  selection: Selection | null
  pendingChangeSet: ChangeSet | null
  undoDepth: number
  redoDepth: number
}

// Renderers implement this boundary. Their runtime objects never become stored data.
export type CanvasAdapterFactory = (
  events: CanvasAdapterEvents
) => CanvasAdapter

export type CommandDraft = DocumentCommand extends infer Command
  ? Command extends DocumentCommand
    ? Omit<Command, "id" | "at" | "actor">
    : never
  : never

export * from "./layer-tree"
export * from "./inspector"
export * from "./text-lists"
export * from "./image-crop-session"
export * from "./image-crop-frame-resize"
export * from "./image-crop-preview-store"
export * from "./transform-session"
export * from "./transform-constraints"
export * from "./snapping"
export * from "./product-commands"
export * from "./page-guides"
