import { useCallback, useEffect, useRef, useState } from "react"
import {
  documentSchema,
  northstarSeed,
  type Document,
  type DocumentCommand,
  type SceneNode,
} from "@webmcp/document"
import type { CanvasNodeChange, CommandDraft, Selection } from "@webmcp/editor"
import {
  alignNodes,
  distributeNodes,
  type Alignment,
  type Distribution,
} from "@webmcp/editor/geometry"
import {
  commitCommands,
  createDocumentHistory,
  redoDocument,
  undoDocument,
  type DocumentHistory,
} from "@webmcp/editor/history"

const STORAGE_KEY = "webmcp-studio:northstar-document:v1"

type SaveStatus = "saved" | "saving" | "restored" | "error"

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

function commandFromDraft(draft: CommandDraft): DocumentCommand {
  return {
    ...draft,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: "human",
  } as DocumentCommand
}

function findNode(document: Document, nodeId: string) {
  return document.nodes.find((node) => node.id === nodeId)
}

export function useDocumentEditor() {
  const [history, setHistory] = useState<DocumentHistory>(() =>
    createDocumentHistory(northstarSeed)
  )
  const [activePageId, setActivePageId] = useState("cover")
  const [selection, setSelection] = useState<Selection | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [clipboardCount, setClipboardCount] = useState(0)
  const didRestore = useRef(false)
  const clipboardRef = useRef<SceneNode[]>([])
  const historyRef = useRef(history)
  historyRef.current = history

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = documentSchema.safeParse(JSON.parse(stored) as unknown)
        if (parsed.success) {
          setHistory(createDocumentHistory(parsed.data))
          setSaveStatus("restored")
        }
      } catch {
        setSaveStatus("error")
      }
    }
    didRestore.current = true
  }, [])

  useEffect(() => {
    if (!didRestore.current) return
    setSaveStatus("saving")
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.document))
        setSaveStatus("saved")
      } catch {
        setSaveStatus("error")
      }
    }, 450)
    return () => window.clearTimeout(timeout)
  }, [history.document])

  const commit = useCallback((drafts: CommandDraft[]) => {
    if (!drafts.length) return
    setHistory((current) =>
      commitCommands(current, drafts.map(commandFromDraft))
    )
    setSaveStatus("saving")
  }, [])

  const selectPage = useCallback((pageId: string) => {
    setActivePageId(pageId)
    setSelection(null)
  }, [])

  const updateNodes = useCallback(
    (changes: CanvasNodeChange[]) => {
      commit(
        changes.map(({ nodeId, patch }) => ({
          type: "update_node",
          nodeId,
          patch,
        }))
      )
    },
    [commit]
  )

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<SceneNode>) => {
      commit([{ type: "update_node", nodeId, patch }])
    },
    [commit]
  )

  const updateField = useCallback(
    (fieldId: string, value: string | number | boolean) => {
      commit([{ type: "set_field", fieldId, value }])
    },
    [commit]
  )

  const addText = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `text-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "text",
      name: "Text",
      text: "Double-click to edit",
      x: Math.round(page.width / 2 - 240),
      y: Math.round(page.height / 2 - 40),
      width: 480,
      height: 90,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      color: "#1e2622",
      fontFamily: "Geist Variable",
      fontSize: 44,
      fontWeight: 500,
      align: "left",
    }
    commit([{ type: "add_node", pageId: page.id, node }])
    setSelection({ pageId: page.id, nodeIds: [id] })
  }, [activePageId, commit])

  const addRectangle = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `rect-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "rect",
      name: "Rectangle",
      x: Math.round(page.width / 2 - 180),
      y: Math.round(page.height / 2 - 130),
      width: 360,
      height: 260,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#d9c9b2",
      radius: 24,
    }
    commit([{ type: "add_node", pageId: page.id, node }])
    setSelection({ pageId: page.id, nodeIds: [id] })
  }, [activePageId, commit])

  const deleteSelection = useCallback(() => {
    if (!selection?.nodeIds.length) return
    commit(selection.nodeIds.map((nodeId) => ({ type: "remove_node", nodeId })))
    setSelection(null)
  }, [commit, selection])

  const duplicateSelection = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page || !selection?.nodeIds.length) return
    const copies = selection.nodeIds.flatMap((nodeId) => {
      const node = findNode(historyRef.current.document, nodeId)
      if (!node) return []
      return [
        {
          ...node,
          id: `${node.type}-${crypto.randomUUID()}`,
          name: `${node.name} copy`,
          x: node.x + 24,
          y: node.y + 24,
        } as SceneNode,
      ]
    })
    commit(copies.map((node) => ({ type: "add_node", pageId: page.id, node })))
    setSelection({ pageId: page.id, nodeIds: copies.map((node) => node.id) })
  }, [activePageId, commit, selection])

  const copySelection = useCallback(() => {
    if (!selection?.nodeIds.length) return
    const nodes = selection.nodeIds.flatMap((nodeId) => {
      const node = findNode(historyRef.current.document, nodeId)
      return node ? [{ ...node } as SceneNode] : []
    })
    clipboardRef.current = nodes
    setClipboardCount(nodes.length)
  }, [selection])

  const pasteSelection = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page || !clipboardRef.current.length) return
    const copies = clipboardRef.current.map(
      (node) =>
        ({
          ...node,
          id: `${node.type}-${crypto.randomUUID()}`,
          name: `${node.name} copy`,
          x: node.x + 24,
          y: node.y + 24,
        }) as SceneNode
    )
    commit(copies.map((node) => ({ type: "add_node", pageId: page.id, node })))
    clipboardRef.current = copies
    setSelection({ pageId: page.id, nodeIds: copies.map((node) => node.id) })
  }, [activePageId, commit])

  const alignSelection = useCallback(
    (alignment: Alignment) => {
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(alignNodes(nodes, alignment))
    },
    [selection, updateNodes]
  )

  const distributeSelection = useCallback(
    (distribution: Distribution) => {
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(distributeNodes(nodes, distribution))
    },
    [selection, updateNodes]
  )

  const setSelectionLocked = useCallback(
    (locked: boolean) => {
      if (!selection?.nodeIds.length) return
      updateNodes(
        selection.nodeIds.map((nodeId) => ({ nodeId, patch: { locked } }))
      )
      if (locked) setSelection(null)
    },
    [selection, updateNodes]
  )

  const setSelectionVisible = useCallback(
    (visible: boolean) => {
      if (!selection?.nodeIds.length) return
      updateNodes(
        selection.nodeIds.map((nodeId) => ({ nodeId, patch: { visible } }))
      )
      if (!visible) setSelection(null)
    },
    [selection, updateNodes]
  )

  const reorderSelection = useCallback(
    (edge: "front" | "back") => {
      const document = historyRef.current.document
      const page = document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page || !selection?.nodeIds.length) return
      const selected = new Set(
        selection.nodeIds.filter(
          (nodeId) => !findNode(document, nodeId)?.locked
        )
      )
      const nodeIds = page.nodeIds.filter((nodeId) => selected.has(nodeId))
      if (!nodeIds.length) return
      if (edge === "back") nodeIds.reverse()
      commit(
        nodeIds.map((nodeId) => ({
          type: "reorder_node",
          pageId: page.id,
          nodeId,
          toIndex: edge === "front" ? page.nodeIds.length - 1 : 0,
        }))
      )
    },
    [activePageId, commit, selection]
  )

  const reorderNode = useCallback(
    (nodeId: string, direction: "forward" | "backward") => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const currentIndex = page.nodeIds.indexOf(nodeId)
      if (currentIndex < 0) return
      const toIndex =
        direction === "forward"
          ? Math.min(page.nodeIds.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
      if (toIndex === currentIndex) return
      commit([{ type: "reorder_node", pageId: page.id, nodeId, toIndex }])
    },
    [activePageId, commit]
  )

  const undo = useCallback(() => {
    setHistory((current) => undoDocument(current))
    setSelection(null)
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => redoDocument(current))
    setSelection(null)
  }, [])

  const selectAll = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (page?.nodeIds.length) {
      setSelection({ pageId: page.id, nodeIds: [...page.nodeIds] })
    }
  }, [activePageId])

  const nudgeSelection = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!selection?.nodeIds.length) return
      const changes = selection.nodeIds.flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        if (!node || node.locked) return []
        return [
          {
            nodeId,
            patch: { x: node.x + deltaX, y: node.y + deltaY },
          },
        ]
      })
      updateNodes(changes)
    },
    [selection, updateNodes]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault()
        duplicateSelection()
        return
      }
      if (modifier && event.key.toLowerCase() === "c") {
        event.preventDefault()
        copySelection()
        return
      }
      if (modifier && event.key.toLowerCase() === "v") {
        event.preventDefault()
        pasteSelection()
        return
      }
      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault()
        selectAll()
        return
      }
      if (!modifier && event.key.toLowerCase() === "t") {
        event.preventDefault()
        addText()
        return
      }
      if (!modifier && event.key.toLowerCase() === "r") {
        event.preventDefault()
        addRectangle()
        return
      }
      if (!modifier && event.key.toLowerCase() === "v") {
        event.preventDefault()
        setSelection(null)
        return
      }
      const nudge = event.shiftKey ? 10 : 1
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        nudgeSelection(-nudge, 0)
        return
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        nudgeSelection(nudge, 0)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        nudgeSelection(0, -nudge)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        nudgeSelection(0, nudge)
        return
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault()
        deleteSelection()
      } else if (event.key === "Escape") {
        setSelection(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    addRectangle,
    addText,
    copySelection,
    deleteSelection,
    duplicateSelection,
    nudgeSelection,
    pasteSelection,
    redo,
    selectAll,
    undo,
  ])

  const selectedNodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
    const node = findNode(history.document, nodeId)
    return node ? [node] : []
  })

  return {
    document: history.document,
    activePageId,
    selection,
    selectedNodes,
    saveStatus,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    canPaste: clipboardCount > 0,
    selectPage,
    setSelection,
    updateNodes,
    updateNode,
    updateField,
    addText,
    addRectangle,
    deleteSelection,
    duplicateSelection,
    copySelection,
    pasteSelection,
    alignSelection,
    distributeSelection,
    setSelectionLocked,
    setSelectionVisible,
    reorderSelection,
    reorderNode,
    undo,
    redo,
  }
}
