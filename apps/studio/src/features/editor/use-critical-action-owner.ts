import { useCallback, useRef, useState } from "react"

/**
 * Owns one critical asynchronous shell action before its first await. The
 * product-command runtime reports synchronous dispatch acceptance; completion
 * and failure remain observable through this state.
 */
export function useCriticalActionOwner<TAction extends string>() {
  const [activeAction, setActiveAction] = useState<TAction | null>(null)
  const activeActionRef = useRef<TAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const claim = useCallback((action: TAction) => {
    if (activeActionRef.current !== null) return false
    activeActionRef.current = action
    setActiveAction(action)
    setError(null)
    return true
  }, [])

  const release = useCallback((action: TAction) => {
    if (activeActionRef.current !== action) return false
    activeActionRef.current = null
    setActiveAction(null)
    return true
  }, [])

  const dispatch = useCallback(
    (action: TAction, operation: () => void | Promise<unknown>) => {
      if (activeActionRef.current !== null) return false
      activeActionRef.current = action
      setActiveAction(action)
      setError(null)
      let completion: void | Promise<unknown>
      try {
        completion = operation()
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Studio could not finish that action."
        )
        activeActionRef.current = null
        setActiveAction(null)
        return true
      }
      void Promise.resolve(completion)
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Studio could not finish that action."
          )
        })
        .finally(() => {
          if (activeActionRef.current !== action) return
          activeActionRef.current = null
          setActiveAction(null)
        })
      return true
    },
    []
  )

  return {
    activeAction,
    error,
    setError,
    claim,
    release,
    dispatch,
  } as const
}
