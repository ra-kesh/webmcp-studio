import { useCallback, useRef, useState } from "react"
import type { StudioStartIntent } from "./studio-start-model"

export type DraftReplacementAction = Readonly<{
  intent: StudioStartIntent
  nextActionLabel: string
  run: () => boolean | Promise<boolean>
}>

export type DraftReplacementRequestResult = boolean | "queued"

export function useDraftReplacement({
  hasCurrentDraft,
  workspaceActive,
  flushCurrentDraft,
  settleWorkspaceEdits,
  onOpened,
  onQueued,
  onSeparateTransitionChange,
}: {
  hasCurrentDraft: boolean
  workspaceActive: boolean
  flushCurrentDraft: () => boolean | Promise<boolean>
  settleWorkspaceEdits?: () => boolean
  onOpened: () => void | Promise<void>
  onQueued?: () => void
  onSeparateTransitionChange?: (active: boolean) => void
}) {
  const [pending, setPending] = useState<DraftReplacementAction | null>(null)
  const [pendingIntent, setPendingIntent] = useState<StudioStartIntent | null>(
    null
  )
  const [replacing, setReplacing] = useState(false)
  const pendingRef = useRef<DraftReplacementAction | null>(null)
  const runningRef = useRef(false)

  const execute = useCallback(
    async (action: DraftReplacementAction) => {
      if (runningRef.current) return false
      runningRef.current = true
      setReplacing(true)
      setPendingIntent(action.intent)
      try {
        const succeeded = await action.run()
        if (succeeded) await onOpened()
        return succeeded
      } finally {
        setPendingIntent(null)
        setReplacing(false)
        runningRef.current = false
      }
    },
    [onOpened]
  )

  const request = useCallback(
    async (
      intent: StudioStartIntent,
      nextActionLabel: string,
      run: () => boolean | Promise<boolean>
    ): Promise<DraftReplacementRequestResult> => {
      const action = { intent, nextActionLabel, run }
      if (!hasCurrentDraft) return execute(action)
      if (pendingRef.current || runningRef.current) return "queued"
      pendingRef.current = action
      setPending(action)
      onQueued?.()
      return "queued"
    },
    [execute, hasCurrentDraft, onQueued]
  )

  const createSeparate = useCallback(
    async (
      intent: StudioStartIntent,
      run: () => boolean | Promise<boolean>
    ): Promise<DraftReplacementRequestResult> => {
      if (pendingRef.current || runningRef.current) return "queued"
      runningRef.current = true
      setReplacing(true)
      setPendingIntent(intent)
      let transitionLocked = false
      try {
        if (workspaceActive && settleWorkspaceEdits && !settleWorkspaceEdits())
          return false
        if (workspaceActive) {
          onSeparateTransitionChange?.(true)
          transitionLocked = true
          try {
            if (!(await flushCurrentDraft())) return false
          } catch {
            return false
          }
        }
        const succeeded = await run()
        if (succeeded) await onOpened()
        return succeeded
      } finally {
        if (transitionLocked) onSeparateTransitionChange?.(false)
        setPendingIntent(null)
        setReplacing(false)
        runningRef.current = false
      }
    },
    [
      flushCurrentDraft,
      onOpened,
      onSeparateTransitionChange,
      settleWorkspaceEdits,
      workspaceActive,
    ]
  )

  const confirm = useCallback(async () => {
    const action = pendingRef.current
    if (!action || runningRef.current) return false
    runningRef.current = true
    setReplacing(true)
    setPendingIntent(action.intent)
    try {
      if (workspaceActive && settleWorkspaceEdits && !settleWorkspaceEdits())
        return false
      if (workspaceActive) {
        try {
          if (!(await flushCurrentDraft())) return false
        } catch {
          return false
        }
      }
      const succeeded = await action.run()
      if (!succeeded) return false
      pendingRef.current = null
      setPending(null)
      await onOpened()
      return true
    } finally {
      setPendingIntent(null)
      setReplacing(false)
      runningRef.current = false
    }
  }, [flushCurrentDraft, onOpened, settleWorkspaceEdits, workspaceActive])

  const cancel = useCallback(() => {
    if (runningRef.current) return
    pendingRef.current = null
    setPending(null)
  }, [])

  return {
    pending,
    pendingIntent,
    replacing,
    open: execute,
    request,
    createSeparate,
    confirm,
    cancel,
  }
}
