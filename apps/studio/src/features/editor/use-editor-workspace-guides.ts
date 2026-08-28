import { useCallback, useEffect, useRef, useState } from "react"
import {
  addPageGuide,
  commitGuideHistory,
  createEditorWorkspaceRecord,
  createGuideHistory,
  duplicatePageGuide,
  movePageGuide,
  PAGE_GUIDE_LIMIT,
  redoGuideHistory,
  removePageGuide,
  undoGuideHistory,
} from "@webmcp/editor/page-guides"
import type {
  EditorWorkspacePreferences,
  EditorWorkspaceRecordV1,
  GuideHistory,
  GuideHistoryEntry,
  PageGuide,
  PageSize,
} from "@webmcp/editor/page-guides"
import {
  EditorWorkspaceRepository,
  getPageGuides,
  pruneEditorWorkspaceRecord,
  setEditorWorkspacePreferences,
  setPageGuides,
} from "./editor-workspace-state"

type WorkspaceLoadStatus = "loading" | "ready" | "recovered" | "unavailable"

const sameRecord = (
  left: EditorWorkspaceRecordV1,
  right: EditorWorkspaceRecordV1
) => JSON.stringify(left) === JSON.stringify(right)

const nextGuideId = () => `guide-${crypto.randomUUID()}`

export function useEditorWorkspaceGuides({
  documentId,
  pageIds,
  activePageId,
  pageSize,
}: {
  documentId: string
  pageIds: readonly string[]
  activePageId: string
  pageSize: PageSize
}) {
  const [record, setRecordState] = useState<EditorWorkspaceRecordV1>(() =>
    createEditorWorkspaceRecord()
  )
  const recordRef = useRef(record)
  recordRef.current = record
  const [history, setHistoryState] = useState<GuideHistory>(() =>
    createGuideHistory()
  )
  const historyRef = useRef(history)
  historyRef.current = history
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null)
  const [hoveredGuideId, setHoveredGuideId] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState<WorkspaceLoadStatus>("loading")
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const repositoryRef = useRef<EditorWorkspaceRepository | null>(null)
  const loadedRef = useRef(false)
  const previousDocumentIdRef = useRef(documentId)

  const installRecord = useCallback((next: EditorWorkspaceRecordV1) => {
    recordRef.current = next
    setRecordState(next)
  }, [])

  const installHistory = useCallback((next: GuideHistory) => {
    historyRef.current = next
    setHistoryState(next)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const repository = new EditorWorkspaceRepository(window.localStorage)
    repositoryRef.current = repository
    const result = repository.load()
    installRecord(result.record)
    if (result.status === "recovered") {
      setLoadStatus("recovered")
      setPersistenceError(
        "Saved guide settings were damaged. They were preserved for recovery and reset safely."
      )
    } else if (result.status === "unavailable") {
      setLoadStatus("unavailable")
      setPersistenceError(
        "Guide settings are available for this session but cannot be read from browser storage."
      )
    } else {
      setLoadStatus("ready")
    }
    loadedRef.current = true
    return () => {
      loadedRef.current = false
      repositoryRef.current = null
    }
  }, [installRecord])

  useEffect(() => {
    if (!loadedRef.current) return
    const pruned = pruneEditorWorkspaceRecord(recordRef.current, [
      { id: documentId, pageIds },
    ])
    if (!sameRecord(pruned, recordRef.current)) installRecord(pruned)

    const pageIdSet = new Set(pageIds)
    const currentHistory = historyRef.current
    const nextHistory: GuideHistory = {
      ...currentHistory,
      past: currentHistory.past.filter(
        (entry) =>
          entry.documentId === documentId && pageIdSet.has(entry.pageId)
      ),
      future: currentHistory.future.filter(
        (entry) =>
          entry.documentId === documentId && pageIdSet.has(entry.pageId)
      ),
    }
    if (
      nextHistory.past.length !== currentHistory.past.length ||
      nextHistory.future.length !== currentHistory.future.length
    ) {
      installHistory(nextHistory)
    }
    if (previousDocumentIdRef.current !== documentId) {
      previousDocumentIdRef.current = documentId
      setSelectedGuideId(null)
      setHoveredGuideId(null)
    }
  }, [documentId, installHistory, installRecord, pageIds])

  useEffect(() => {
    if (!loadedRef.current) return
    const result = repositoryRef.current?.save(record)
    if (result && !result.ok) {
      setLoadStatus("unavailable")
      setPersistenceError(
        "Guide changes are active for this session but could not be saved in this browser."
      )
    }
  }, [record])

  useEffect(() => {
    setSelectedGuideId(null)
    setHoveredGuideId(null)
  }, [activePageId])

  const activeGuides = getPageGuides(record, documentId, activePageId)

  const commitGuides = useCallback(
    (after: readonly PageGuide[], label: string): GuideHistoryEntry | null => {
      const before = getPageGuides(recordRef.current, documentId, activePageId)
      const nextHistory = commitGuideHistory(historyRef.current, {
        documentId,
        pageId: activePageId,
        label,
        committedAt: Date.now(),
        before,
        after,
      })
      if (nextHistory === historyRef.current) return null
      const entry = nextHistory.past.at(-1) ?? null
      installHistory(nextHistory)
      installRecord(
        setPageGuides(recordRef.current, documentId, activePageId, after)
      )
      return entry
    },
    [activePageId, documentId, installHistory, installRecord]
  )

  const addGuide = useCallback(
    (guide: { axis: PageGuide["axis"]; position: number }) => {
      const current = getPageGuides(recordRef.current, documentId, activePageId)
      if (current.length >= PAGE_GUIDE_LIMIT) {
        setMutationError(
          `This page already has the maximum of ${PAGE_GUIDE_LIMIT} guides.`
        )
        return null
      }
      const id = nextGuideId()
      const after = addPageGuide(current, { id, ...guide }, pageSize)
      const entry = commitGuides(after, "Add guide")
      if (entry) {
        setMutationError(null)
        setSelectedGuideId(id)
      }
      return entry
    },
    [activePageId, commitGuides, documentId, pageSize]
  )

  const moveGuide = useCallback(
    (guideId: string, position: number) => {
      const current = getPageGuides(recordRef.current, documentId, activePageId)
      const entry = commitGuides(
        movePageGuide(current, guideId, position, pageSize),
        "Move guide"
      )
      if (entry) {
        setMutationError(null)
        setSelectedGuideId(guideId)
      }
      return entry
    },
    [activePageId, commitGuides, documentId, pageSize]
  )

  const duplicateGuide = useCallback(
    (guideId: string, position: number) => {
      const current = getPageGuides(recordRef.current, documentId, activePageId)
      if (current.length >= PAGE_GUIDE_LIMIT) {
        setMutationError(
          `This page already has the maximum of ${PAGE_GUIDE_LIMIT} guides.`
        )
        return null
      }
      const duplicateId = nextGuideId()
      const entry = commitGuides(
        duplicatePageGuide(current, guideId, duplicateId, position, pageSize),
        "Duplicate guide"
      )
      if (entry) {
        setMutationError(null)
        setSelectedGuideId(duplicateId)
      }
      return entry
    },
    [activePageId, commitGuides, documentId, pageSize]
  )

  const removeGuide = useCallback(
    (guideId: string) => {
      const current = getPageGuides(recordRef.current, documentId, activePageId)
      const entry = commitGuides(
        removePageGuide(current, guideId),
        "Remove guide"
      )
      if (entry) {
        setMutationError(null)
        setSelectedGuideId((selected) =>
          selected === guideId ? null : selected
        )
        setHoveredGuideId((hovered) => (hovered === guideId ? null : hovered))
      }
      return entry
    },
    [activePageId, commitGuides, documentId]
  )

  const setPreferences = useCallback(
    (preferences: EditorWorkspacePreferences) => {
      installRecord(
        setEditorWorkspacePreferences(recordRef.current, preferences)
      )
      if (!preferences.guidesVisible) {
        setSelectedGuideId(null)
        setHoveredGuideId(null)
      }
    },
    [installRecord]
  )

  const undoGuide = useCallback(() => {
    const settlement = undoGuideHistory(historyRef.current)
    if (!settlement.entry || !settlement.guides) return null
    installHistory(settlement.history)
    installRecord(
      setPageGuides(
        recordRef.current,
        settlement.entry.documentId,
        settlement.entry.pageId,
        settlement.guides
      )
    )
    setSelectedGuideId(null)
    setHoveredGuideId(null)
    return settlement.entry
  }, [installHistory, installRecord])

  const redoGuide = useCallback(() => {
    const settlement = redoGuideHistory(historyRef.current)
    if (!settlement.entry || !settlement.guides) return null
    installHistory(settlement.history)
    installRecord(
      setPageGuides(
        recordRef.current,
        settlement.entry.documentId,
        settlement.entry.pageId,
        settlement.guides
      )
    )
    setSelectedGuideId(null)
    setHoveredGuideId(null)
    return settlement.entry
  }, [installHistory, installRecord])

  const clearRedo = useCallback(() => {
    if (!historyRef.current.future.length) return false
    installHistory({ ...historyRef.current, future: [] })
    return true
  }, [installHistory])

  return {
    activeGuides,
    preferences: record.preferences,
    selectedGuideId,
    hoveredGuideId,
    loadStatus,
    persistenceError,
    mutationError,
    guideUndoEntry: history.past.at(-1) ?? null,
    guideRedoEntry: history.future[0] ?? null,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    setSelectedGuideId,
    setHoveredGuideId,
    setPreferences,
    addGuide,
    moveGuide,
    duplicateGuide,
    removeGuide,
    undoGuide,
    redoGuide,
    clearRedo,
  }
}
