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

export interface CanvasAdapter {
  mount(element: HTMLElement): void
  unmount(): void
  load(document: Document, pageId: string): void
  select(selection: Selection): void
  getSelection(): Selection | null
  toCommand(before: SceneNode, after: SceneNode): DocumentCommand
}

export type EditorState = {
  document: Document
  activePageId: string
  selection: Selection | null
  pendingChangeSet: ChangeSet | null
  undoDepth: number
  redoDepth: number
}

// Fabric implements this boundary. Fabric objects never become the stored document.
export type CanvasAdapterFactory = () => CanvasAdapter
