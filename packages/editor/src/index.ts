import type {
  ChangeSet,
  Document,
  DocumentCommand,
  SceneNode,
} from "@webmcp/document"

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
  onNodesChange(changes: CanvasNodeChange[]): void
}

export type CanvasNodeChange = {
  nodeId: string
  patch: Partial<SceneNode>
}

export interface CanvasAdapter {
  mount(element: HTMLCanvasElement): void
  unmount(): Promise<void>
  sync(document: Document, pageId: string): Promise<void>
  select(selection: Selection | null): void
  getSelection(): Selection | null
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
