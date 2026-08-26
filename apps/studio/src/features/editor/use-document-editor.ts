import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  changeSetSchema,
  createTemplateVersion,
  decideAllChangeOperations,
  decideChangeOperation,
  documentSchema,
  findSelectedGroupId,
  getChangeSetConflict,
  getGroupNodeIds,
  northstarSeed,
  previewChangeSet,
  templateVersionSchema,
  type ChangeOperation,
  type ChangeSet,
  type Document,
  type DocumentCommand,
  type FieldBinding,
  type FieldDefinition,
  type SceneNode,
  type TemplateVersion,
} from "@webmcp/document"
import type { CanvasNodeChange, CommandDraft, Selection } from "@webmcp/editor"
import {
  alignNodes,
  alignNodesToBounds,
  distributeNodes,
  type Alignment,
  type Distribution,
} from "@webmcp/editor/geometry"
import {
  commitCommands,
  createDocumentHistory,
  redoDocument,
  replaceDocument,
  undoDocument,
  type DocumentHistory,
} from "@webmcp/editor/history"
import {
  getImageDimensions,
  loadLocalAsset,
  localAssetIdFromSource,
  localAssetSource,
  saveLocalAsset,
} from "./local-asset-store"
import type { StudioAsset } from "./asset-catalog"

const STORAGE_KEY = "webmcp-studio:northstar-document:v1"
const PUBLISHED_STORAGE_KEY = "webmcp-studio:published-versions:v1"

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
  const [assetVersion, setAssetVersion] = useState(0)
  const [isImportingAsset, setIsImportingAsset] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [pendingChangeSet, setPendingChangeSet] = useState<ChangeSet | null>(
    null
  )
  const [lastResolvedChangeSet, setLastResolvedChangeSet] =
    useState<ChangeSet | null>(null)
  const [changeSetError, setChangeSetError] = useState<string | null>(null)
  const [publishedVersions, setPublishedVersions] = useState<TemplateVersion[]>(
    []
  )
  const [publishError, setPublishError] = useState<string | null>(null)
  const didRestore = useRef(false)
  const clipboardRef = useRef<SceneNode[]>([])
  const assetUrlsRef = useRef(new Map<string, string>())
  const loadingAssetIdsRef = useRef(new Set<string>())
  const historyRef = useRef(history)
  historyRef.current = history
  const pendingChangeSetRef = useRef(pendingChangeSet)
  pendingChangeSetRef.current = pendingChangeSet

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
    const storedVersions = localStorage.getItem(PUBLISHED_STORAGE_KEY)
    if (storedVersions) {
      try {
        const parsed = templateVersionSchema
          .array()
          .safeParse(JSON.parse(storedVersions) as unknown)
        if (parsed.success) setPublishedVersions(parsed.data)
      } catch {
        setPublishError("Published versions could not be restored.")
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

  useEffect(() => {
    let cancelled = false
    const missingAssetIds = history.document.nodes.flatMap((node) => {
      if (node.type !== "image") return []
      const assetId = localAssetIdFromSource(node.src)
      return assetId &&
        !assetUrlsRef.current.has(assetId) &&
        !loadingAssetIdsRef.current.has(assetId)
        ? [assetId]
        : []
    })
    if (!missingAssetIds.length) return
    const uniqueAssetIds = [...new Set(missingAssetIds)]
    for (const assetId of uniqueAssetIds) {
      loadingAssetIdsRef.current.add(assetId)
    }
    void Promise.all(
      uniqueAssetIds.map(async (assetId) => {
        const blob = await loadLocalAsset(assetId)
        return blob ? ([assetId, URL.createObjectURL(blob)] as const) : null
      })
    )
      .then((assets) => {
        if (cancelled) {
          for (const asset of assets) {
            if (asset) URL.revokeObjectURL(asset[1])
          }
          return
        }
        let changed = false
        for (const asset of assets) {
          if (!asset || assetUrlsRef.current.has(asset[0])) continue
          assetUrlsRef.current.set(asset[0], asset[1])
          changed = true
        }
        if (changed) setAssetVersion((current) => current + 1)
      })
      .catch(() => {
        if (!cancelled) {
          setAssetError("A saved image could not be restored on this device.")
        }
      })
      .finally(() => {
        for (const assetId of uniqueAssetIds) {
          loadingAssetIdsRef.current.delete(assetId)
        }
      })
    return () => {
      cancelled = true
    }
  }, [history.document.nodes])

  useEffect(
    () => () => {
      for (const url of assetUrlsRef.current.values()) URL.revokeObjectURL(url)
      assetUrlsRef.current.clear()
    },
    []
  )

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

  const createField = useCallback(
    (field: Omit<FieldDefinition, "id">) => {
      commit([
        {
          type: "add_field",
          field: { ...field, id: `field-${crypto.randomUUID()}` },
        },
      ])
    },
    [commit]
  )

  const updateFieldDefinition = useCallback(
    (fieldId: string, patch: Partial<Omit<FieldDefinition, "id">>) => {
      commit([{ type: "update_field", fieldId, patch }])
    },
    [commit]
  )

  const removeField = useCallback(
    (fieldId: string) => {
      commit([{ type: "remove_field", fieldId }])
    },
    [commit]
  )

  const bindField = useCallback(
    (fieldId: string, nodeId: string, property: FieldBinding["property"]) => {
      commit([
        {
          type: "bind_field",
          binding: {
            id: `binding-${crypto.randomUUID()}`,
            fieldId,
            nodeId,
            property,
          },
        },
      ])
    },
    [commit]
  )

  const unbindField = useCallback(
    (bindingId: string) => {
      commit([{ type: "unbind_field", bindingId }])
    },
    [commit]
  )

  const proposeChangeSet = useCallback((changeSetInput: ChangeSet) => {
    if (pendingChangeSetRef.current) {
      throw new Error("Resolve or discard the pending change set first.")
    }
    const changeSet = changeSetSchema.parse(changeSetInput)
    const conflict = getChangeSetConflict(
      historyRef.current.document,
      changeSet
    )
    if (conflict) throw new Error(conflict.message)
    previewChangeSet(historyRef.current.document, changeSet)
    setPendingChangeSet(changeSet)
    setChangeSetError(null)
    return changeSet
  }, [])

  const decideOperation = useCallback(
    (operationId: string, status: ChangeOperation["status"]) => {
      setPendingChangeSet((current) =>
        current ? decideChangeOperation(current, operationId, status) : current
      )
      setChangeSetError(null)
    },
    []
  )

  const decideAllOperations = useCallback(
    (status: Exclude<ChangeOperation["status"], "pending">) => {
      setPendingChangeSet((current) =>
        current ? decideAllChangeOperations(current, status) : current
      )
      setChangeSetError(null)
    },
    []
  )

  const discardChangeSet = useCallback(() => {
    const current = pendingChangeSetRef.current
    if (!current) return
    const rejected = decideAllChangeOperations(current, "rejected")
    setLastResolvedChangeSet(rejected)
    setPendingChangeSet(null)
    setChangeSetError(null)
  }, [])

  const applyChangeSet = useCallback(() => {
    const current = pendingChangeSetRef.current
    if (!current) return
    const conflict = getChangeSetConflict(historyRef.current.document, current)
    if (conflict) {
      setChangeSetError(conflict.message)
      return
    }
    const commands = current.operations
      .filter((operation) => operation.status === "accepted")
      .map((operation) => operation.command)
    if (!commands.length) {
      setChangeSetError("Accept at least one operation before applying.")
      return
    }
    setHistory((history) => commitCommands(history, commands))
    setLastResolvedChangeSet(current)
    setPendingChangeSet(null)
    setChangeSetError(null)
    setSaveStatus("saving")
    setSelection(null)
  }, [])

  const publishTemplate = useCallback(() => {
    if (pendingChangeSetRef.current) {
      const message = "Resolve the pending change set before publishing."
      setPublishError(message)
      throw new Error(message)
    }
    const document = historyRef.current.document
    const templateId =
      document.id === northstarSeed.id
        ? "northstar-wedding-proposal"
        : `template-${document.id}`
    const existing = publishedVersions
      .filter((version) => version.templateId === templateId)
      .sort((a, b) => b.version - a.version)
    const latest = existing[0]
    if (latest?.sourceRevision === document.revision) return latest
    try {
      const version = createTemplateVersion(document, {
        id: `template-version-${crypto.randomUUID()}`,
        templateId,
        version: (latest?.version ?? 0) + 1,
        publishedAt: new Date().toISOString(),
      })
      const next = [...publishedVersions, version]
      localStorage.setItem(PUBLISHED_STORAGE_KEY, JSON.stringify(next))
      setPublishedVersions(next)
      setPublishError(null)
      return version
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Publishing failed."
      setPublishError(message)
      throw error
    }
  }, [publishedVersions])

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
      lineHeight: 1.18,
      letterSpacing: 0,
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
      strokeWidth: 0,
    }
    commit([{ type: "add_node", pageId: page.id, node }])
    setSelection({ pageId: page.id, nodeIds: [id] })
  }, [activePageId, commit])

  const addEllipse = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `ellipse-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "ellipse",
      name: "Ellipse",
      x: Math.round(page.width / 2 - 150),
      y: Math.round(page.height / 2 - 150),
      width: 300,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#d9c9b2",
      strokeWidth: 0,
    }
    commit([{ type: "add_node", pageId: page.id, node }])
    setSelection({ pageId: page.id, nodeIds: [id] })
  }, [activePageId, commit])

  const addLine = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `line-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "line",
      name: "Line",
      x: Math.round(page.width / 2 - 180),
      y: Math.round(page.height / 2),
      width: 360,
      height: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      stroke: "#1e2622",
      strokeWidth: 4,
    }
    commit([{ type: "add_node", pageId: page.id, node }])
    setSelection({ pageId: page.id, nodeIds: [id] })
  }, [activePageId, commit])

  const addIcon = useCallback(
    ({
      name,
      path,
      viewBox,
    }: {
      name: string
      path: string
      viewBox: string
    }) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const id = `icon-${crypto.randomUUID()}`
      const node: SceneNode = {
        id,
        type: "icon",
        name,
        path,
        viewBox,
        x: Math.round(page.width / 2 - 90),
        y: Math.round(page.height / 2 - 90),
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#8a5d38",
        strokeWidth: 0,
      }
      commit([{ type: "add_node", pageId: page.id, node }])
      setSelection({ pageId: page.id, nodeIds: [id] })
    },
    [activePageId, commit]
  )

  const addImageFile = useCallback(
    async (file: File) => {
      setAssetError(null)
      if (!file.type.startsWith("image/")) {
        setAssetError("Choose a PNG, JPEG, WebP, GIF, or SVG image.")
        return
      }
      if (file.size > 25 * 1024 * 1024) {
        setAssetError("Images must be smaller than 25 MB.")
        return
      }
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      setIsImportingAsset(true)
      try {
        const assetId = `asset-${crypto.randomUUID()}`
        const dimensions = await getImageDimensions(file)
        await saveLocalAsset(file, assetId)
        const objectUrl = URL.createObjectURL(file)
        assetUrlsRef.current.set(assetId, objectUrl)
        setAssetVersion((current) => current + 1)

        const maxWidth = Math.min(640, page.width * 0.64)
        const maxHeight = Math.min(640, page.height * 0.64)
        const scale = Math.min(
          maxWidth / dimensions.width,
          maxHeight / dimensions.height,
          1
        )
        const width = Math.max(1, Math.round(dimensions.width * scale))
        const height = Math.max(1, Math.round(dimensions.height * scale))
        const id = `image-${crypto.randomUUID()}`
        const node: SceneNode = {
          id,
          type: "image",
          name: file.name.replace(/\.[^.]+$/, "") || "Image",
          assetId,
          src: localAssetSource(assetId),
          alt: file.name,
          fit: "cover",
          cropX: 0.5,
          cropY: 0.5,
          x: Math.round((page.width - width) / 2),
          y: Math.round((page.height - height) / 2),
          width,
          height,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        }
        commit([{ type: "add_node", pageId: page.id, node }])
        setSelection({ pageId: page.id, nodeIds: [id] })
      } catch {
        setAssetError(
          "The image could not be added. The local asset store may be unavailable."
        )
      } finally {
        setIsImportingAsset(false)
      }
    },
    [activePageId, commit]
  )

  const addLibraryAsset = useCallback(
    (asset: StudioAsset) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const maxWidth = Math.min(640, page.width * 0.64)
      const maxHeight = Math.min(640, page.height * 0.64)
      const scale = Math.min(
        maxWidth / asset.width,
        maxHeight / asset.height,
        1
      )
      const width = Math.max(1, Math.round(asset.width * scale))
      const height = Math.max(1, Math.round(asset.height * scale))
      const id = `image-${crypto.randomUUID()}`
      const node: SceneNode = {
        id,
        type: "image",
        name: asset.name,
        assetId: `library-${asset.id}`,
        src: asset.src,
        alt: asset.description,
        fit: "cover",
        cropX: 0.5,
        cropY: 0.5,
        x: Math.round((page.width - width) / 2),
        y: Math.round((page.height - height) / 2),
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      }
      commit([{ type: "add_node", pageId: page.id, node }])
      setSelection({ pageId: page.id, nodeIds: [id] })
    },
    [activePageId, commit]
  )

  const replaceImageFile = useCallback(
    async (nodeId: string, file: File) => {
      setAssetError(null)
      if (!file.type.startsWith("image/")) {
        setAssetError("Choose a PNG, JPEG, WebP, GIF, or SVG image.")
        return
      }
      if (file.size > 25 * 1024 * 1024) {
        setAssetError("Images must be smaller than 25 MB.")
        return
      }
      const node = findNode(historyRef.current.document, nodeId)
      if (!node || node.type !== "image") return
      setIsImportingAsset(true)
      try {
        await getImageDimensions(file)
        const assetId = `asset-${crypto.randomUUID()}`
        await saveLocalAsset(file, assetId)
        assetUrlsRef.current.set(assetId, URL.createObjectURL(file))
        setAssetVersion((current) => current + 1)
        commit([
          {
            type: "update_node",
            nodeId,
            patch: {
              assetId,
              src: localAssetSource(assetId),
              alt: file.name,
            },
          },
        ])
      } catch {
        setAssetError(
          "The image could not be replaced. The local asset store may be unavailable."
        )
      } finally {
        setIsImportingAsset(false)
      }
    },
    [commit]
  )

  const importDocumentFile = useCallback(async (file: File) => {
    setDocumentError(null)
    try {
      const parsedJson = JSON.parse(await file.text()) as unknown
      const parsed = documentSchema.safeParse(parsedJson)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const location = issue?.path.length ? issue.path.join(".") : "document"
        throw new Error(`${location}: ${issue?.message ?? "Invalid document"}`)
      }
      setHistory((current) => replaceDocument(current, parsed.data))
      setActivePageId((current) =>
        parsed.data.pages.some((page) => page.id === current)
          ? current
          : (parsed.data.pages[0]?.id ?? current)
      )
      setSelection(null)
      setSaveStatus("saving")
    } catch (error) {
      setDocumentError(
        error instanceof SyntaxError
          ? "This file is not valid JSON."
          : error instanceof Error
            ? `The document could not be imported: ${error.message}`
            : "The document could not be imported."
      )
    }
  }, [])

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

  const alignSelectionToPage = useCallback(
    (alignment: Alignment) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(
        alignNodesToBounds(nodes, alignment, {
          left: 0,
          top: 0,
          right: page.width,
          bottom: page.height,
          width: page.width,
          height: page.height,
          centerX: page.width / 2,
          centerY: page.height / 2,
        })
      )
    },
    [activePageId, selection, updateNodes]
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

  const groupSelection = useCallback(() => {
    const nodeIds = selection?.nodeIds ?? []
    if (nodeIds.length < 2) return
    commit([
      {
        type: "group_nodes",
        groupId: `group-${crypto.randomUUID()}`,
        pageId: activePageId,
        name: "Group",
        nodeIds,
      },
    ])
  }, [activePageId, commit, selection])

  const selectedGroupId = findSelectedGroupId(
    history.document,
    selection?.nodeIds ?? []
  )

  const selectGroup = useCallback(
    (groupId: string, additive: boolean) => {
      const groupNodeIds = getGroupNodeIds(historyRef.current.document, groupId)
      if (!groupNodeIds.length) return
      const current = additive ? (selection?.nodeIds ?? []) : []
      const nodeIds = [...new Set([...current, ...groupNodeIds])]
      setSelection({ pageId: activePageId, nodeIds })
    },
    [activePageId, selection]
  )

  const updateGroup = useCallback(
    (groupId: string, name: string) => {
      if (!name.trim()) return
      commit([{ type: "update_group", groupId, name: name.trim() }])
    },
    [commit]
  )

  const updateGroupNodes = useCallback(
    (groupId: string, patch: Partial<SceneNode>) => {
      updateNodes(
        getGroupNodeIds(historyRef.current.document, groupId).map((nodeId) => ({
          nodeId,
          patch,
        }))
      )
    },
    [updateNodes]
  )

  const ungroupSelection = useCallback(() => {
    if (!selectedGroupId) return
    commit([{ type: "ungroup_nodes", groupId: selectedGroupId }])
  }, [commit, selectedGroupId])

  const addPage = useCallback(
    (outputId: string) => {
      const document = historyRef.current.document
      const output = document.outputs.find(
        (candidate) => candidate.id === outputId
      )
      const referencePage = output
        ? document.pages.find((page) => page.id === output.pageIds.at(-1))
        : undefined
      if (!output) return
      const pageId = `page-${crypto.randomUUID()}`
      commit([
        {
          type: "add_page",
          outputId,
          page: {
            id: pageId,
            outputId,
            name: `Page ${output.pageIds.length + 1}`,
            width: referencePage?.width ?? 1080,
            height: referencePage?.height ?? 1080,
            background: referencePage?.background ?? "#ffffff",
            nodeIds: [],
          },
        },
      ])
      setActivePageId(pageId)
      setSelection(null)
    },
    [commit]
  )

  const duplicatePage = useCallback(
    (pageId: string) => {
      const document = historyRef.current.document
      const page = document.pages.find((candidate) => candidate.id === pageId)
      if (!page) return
      const nextPageId = `page-${crypto.randomUUID()}`
      const nodeIdMap = new Map(
        page.nodeIds.map((nodeId) => [nodeId, `node-${crypto.randomUUID()}`])
      )
      const nodes = page.nodeIds.flatMap((nodeId) => {
        const node = findNode(document, nodeId)
        const nextNodeId = nodeIdMap.get(nodeId)
        return node && nextNodeId
          ? [{ ...node, id: nextNodeId, name: node.name } as SceneNode]
          : []
      })
      const groupIdMap = new Map(
        document.groups
          .filter((group) => group.pageId === page.id)
          .map((group) => [group.id, `group-${crypto.randomUUID()}`])
      )
      const groups = document.groups
        .filter((group) => group.pageId === page.id)
        .map((group) => ({
          ...group,
          id: groupIdMap.get(group.id) ?? group.id,
          pageId: nextPageId,
          nodeIds: group.nodeIds.flatMap((nodeId) => {
            const nextNodeId = nodeIdMap.get(nodeId)
            return nextNodeId ? [nextNodeId] : []
          }),
          parentGroupId: group.parentGroupId
            ? groupIdMap.get(group.parentGroupId)
            : undefined,
        }))
      commit([
        {
          type: "duplicate_page",
          outputId: page.outputId,
          page: {
            ...page,
            id: nextPageId,
            name: `${page.name} copy`,
            nodeIds: page.nodeIds.flatMap((nodeId) => {
              const nextNodeId = nodeIdMap.get(nodeId)
              return nextNodeId ? [nextNodeId] : []
            }),
          },
          nodes,
          groups,
        },
      ])
      setActivePageId(nextPageId)
      setSelection(null)
    },
    [commit]
  )

  const updatePage = useCallback(
    (
      pageId: string,
      patch: {
        name?: string
        width?: number
        height?: number
        background?: string
      }
    ) => commit([{ type: "update_page", pageId, patch }]),
    [commit]
  )

  const removePage = useCallback(
    (pageId: string) => {
      const document = historyRef.current.document
      const page = document.pages.find((candidate) => candidate.id === pageId)
      const output = page
        ? document.outputs.find((candidate) => candidate.id === page.outputId)
        : undefined
      if (!page || !output || output.pageIds.length <= 1) return
      const nextPageId =
        output.pageIds.find((candidate) => candidate !== pageId) ?? activePageId
      commit([{ type: "remove_page", pageId }])
      if (activePageId === pageId) setActivePageId(nextPageId)
      setSelection(null)
    },
    [activePageId, commit]
  )

  const reorderPage = useCallback(
    (outputId: string, pageId: string, toIndex: number) =>
      commit([{ type: "reorder_page", outputId, pageId, toIndex }]),
    [commit]
  )

  const addOutput = useCallback(
    (options: { name: string; width: number; height: number }) => {
      const outputId = `output-${crypto.randomUUID()}`
      const pageId = `page-${crypto.randomUUID()}`
      commit([
        {
          type: "add_output",
          output: {
            id: outputId,
            name: options.name.trim() || "Untitled output",
            kind: "square",
            pageIds: [pageId],
            exportFormats: ["png"],
          },
          page: {
            id: pageId,
            outputId,
            name: "Page 1",
            width: options.width,
            height: options.height,
            background: "#ffffff",
            nodeIds: [],
          },
        },
      ])
      setActivePageId(pageId)
      setSelection(null)
    },
    [commit]
  )

  const updateOutput = useCallback(
    (outputId: string, name: string) => {
      if (name.trim())
        commit([{ type: "update_output", outputId, name: name.trim() }])
    },
    [commit]
  )

  const removeOutput = useCallback(
    (outputId: string) => {
      const document = historyRef.current.document
      const output = document.outputs.find(
        (candidate) => candidate.id === outputId
      )
      if (!output || document.outputs.length <= 1) return
      const nextPageId = document.outputs.find(
        (candidate) => candidate.id !== outputId
      )?.pageIds[0]
      commit([{ type: "remove_output", outputId }])
      if (output.pageIds.includes(activePageId) && nextPageId) {
        setActivePageId(nextPageId)
        setSelection(null)
      }
    },
    [activePageId, commit]
  )

  const createBlankDocument = useCallback(
    (options: { name: string; width: number; height: number }) => {
      const now = new Date().toISOString()
      const outputId = `output-${crypto.randomUUID()}`
      const pageId = `page-${crypto.randomUUID()}`
      const document = documentSchema.parse({
        schemaVersion: 1,
        id: `document-${crypto.randomUUID()}`,
        name: options.name,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        outputs: [
          {
            id: outputId,
            name: options.name,
            kind: "square",
            pageIds: [pageId],
            exportFormats: ["png"],
          },
        ],
        pages: [
          {
            id: pageId,
            outputId,
            name: "Page 1",
            width: options.width,
            height: options.height,
            background: "#ffffff",
            nodeIds: [],
          },
        ],
        nodes: [],
        groups: [],
        fields: [],
        fieldValues: {},
        bindings: [],
      })
      setHistory((current) => replaceDocument(current, document))
      setActivePageId(pageId)
      setSelection(null)
      setSaveStatus("saving")
    },
    []
  )

  const restoreDemoDocument = useCallback(() => {
    setHistory((current) => replaceDocument(current, northstarSeed))
    setActivePageId(northstarSeed.pages[0]?.id ?? "cover")
    setSelection(null)
    setSaveStatus("saving")
  }, [])

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
      if (modifier && event.key.toLowerCase() === "g") {
        event.preventDefault()
        if (event.shiftKey) ungroupSelection()
        else groupSelection()
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
      if (!modifier && event.key.toLowerCase() === "o") {
        event.preventDefault()
        addEllipse()
        return
      }
      if (!modifier && event.key.toLowerCase() === "l") {
        event.preventDefault()
        addLine()
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
    addEllipse,
    addLine,
    addText,
    copySelection,
    deleteSelection,
    duplicateSelection,
    groupSelection,
    nudgeSelection,
    pasteSelection,
    redo,
    selectAll,
    ungroupSelection,
    undo,
  ])

  const selectedNodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
    const node = findNode(history.document, nodeId)
    return node ? [node] : []
  })

  const changeSetConflict = pendingChangeSet
    ? getChangeSetConflict(history.document, pendingChangeSet)
    : null

  const currentTemplateId =
    history.document.id === northstarSeed.id
      ? "northstar-wedding-proposal"
      : `template-${history.document.id}`
  const latestPublishedVersion = publishedVersions
    .filter((version) => version.templateId === currentTemplateId)
    .sort((a, b) => b.version - a.version)[0]

  const previewDocument = useMemo(() => {
    const changeSetPreview =
      pendingChangeSet && !changeSetConflict
        ? previewChangeSet(history.document, pendingChangeSet)
        : history.document
    return {
      ...changeSetPreview,
      nodes: changeSetPreview.nodes.map((node) => {
        if (node.type !== "image") return node
        const assetId = localAssetIdFromSource(node.src)
        const previewUrl = assetId ? assetUrlsRef.current.get(assetId) : null
        return previewUrl ? { ...node, src: previewUrl } : node
      }),
    }
  }, [assetVersion, changeSetConflict, history.document, pendingChangeSet])

  return {
    document: history.document,
    previewDocument,
    activePageId,
    selection,
    selectedNodes,
    selectedGroupId,
    saveStatus,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    canPaste: clipboardCount > 0,
    isImportingAsset,
    assetError,
    documentError,
    pendingChangeSet,
    lastResolvedChangeSet,
    changeSetConflict,
    changeSetError,
    publishedVersions,
    latestPublishedVersion,
    currentTemplateId,
    publishError,
    selectPage,
    setSelection,
    updateNodes,
    updateNode,
    updateField,
    createField,
    updateFieldDefinition,
    removeField,
    bindField,
    unbindField,
    proposeChangeSet,
    decideOperation,
    decideAllOperations,
    applyChangeSet,
    discardChangeSet,
    publishTemplate,
    addText,
    addRectangle,
    addEllipse,
    addLine,
    addIcon,
    addImageFile,
    addLibraryAsset,
    replaceImageFile,
    importDocumentFile,
    deleteSelection,
    duplicateSelection,
    copySelection,
    pasteSelection,
    alignSelection,
    alignSelectionToPage,
    distributeSelection,
    setSelectionLocked,
    setSelectionVisible,
    reorderSelection,
    reorderNode,
    groupSelection,
    ungroupSelection,
    selectGroup,
    updateGroup,
    updateGroupNodes,
    addPage,
    duplicatePage,
    updatePage,
    removePage,
    reorderPage,
    addOutput,
    updateOutput,
    removeOutput,
    createBlankDocument,
    restoreDemoDocument,
    undo,
    redo,
  }
}
