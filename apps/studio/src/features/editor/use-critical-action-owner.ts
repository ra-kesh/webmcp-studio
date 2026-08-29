import { useCallback, useEffect, useRef, useState } from "react"

export type CriticalActionLifecycle<TAction extends string> =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "running"
      action: TAction
      operationId: string
      cancelable: boolean
    }>
  | Readonly<{
      status: "cancelling"
      action: TAction
      operationId: string
      reason: "cancelled" | "timed_out"
    }>
  | Readonly<{
      status: "failed" | "timed_out" | "cancelled"
      action: TAction
      operationId: string
      message: string
      retryable: boolean
    }>

export type CriticalActionContext = Readonly<{
  signal: AbortSignal
  operationId: string
  enterNonCancelablePhase: () => void
}>

export type CriticalActionDispatchOptions = Readonly<{
  cancelable?: boolean
  retryable?: boolean
  timeoutMs?: number
  timeoutMessage?: string
  cancelMessage?: string
}>

type CriticalActionOperation = (
  context: CriticalActionContext
) => void | Promise<unknown>

type ActiveExecution<TAction extends string> = {
  action: TAction
  operationId: string
  controller: AbortController
  cancelable: boolean
  retryable: boolean
  cancelMessage: string
  timer: ReturnType<typeof setTimeout> | null
  abortRequest: {
    status: "timed_out" | "cancelled"
    message: string
  } | null
}

type RetryExecution<TAction extends string> = {
  action: TAction
  operation: CriticalActionOperation
  options: CriticalActionDispatchOptions
}

const failureMessage = (caught: unknown) =>
  caught instanceof Error
    ? caught.message
    : "Studio could not finish that action."

/**
 * Owns one critical asynchronous shell action before its first await. Export
 * callers can request cancellation at a deadline. Ownership remains held while
 * the operation acknowledges that abort, so a retry can never overlap work
 * that is still settling. Every completion is keyed by operation identity.
 */
export function useCriticalActionOwner<TAction extends string>() {
  const [activeAction, setActiveAction] = useState<TAction | null>(null)
  const activeActionRef = useRef<TAction | null>(null)
  const [error, setErrorState] = useState<string | null>(null)
  const [lifecycle, setLifecycle] = useState<CriticalActionLifecycle<TAction>>({
    status: "idle",
  })
  const activeExecutionRef = useRef<ActiveExecution<TAction> | null>(null)
  const retryExecutionRef = useRef<RetryExecution<TAction> | null>(null)

  const setError = useCallback((message: string | null) => {
    setErrorState(message)
  }, [])

  const claim = useCallback((action: TAction) => {
    if (activeActionRef.current !== null) return false
    retryExecutionRef.current = null
    activeActionRef.current = action
    setActiveAction(action)
    setErrorState(null)
    setLifecycle({
      status: "running",
      action,
      operationId: crypto.randomUUID(),
      cancelable: false,
    })
    return true
  }, [])

  const release = useCallback((action: TAction) => {
    if (activeActionRef.current !== action) return false
    activeActionRef.current = null
    setActiveAction(null)
    setLifecycle({ status: "idle" })
    return true
  }, [])

  const dispatchRef = useRef<
    | ((
        action: TAction,
        operation: CriticalActionOperation,
        options?: CriticalActionDispatchOptions
      ) => boolean)
    | null
  >(null)

  const dispatch = useCallback(
    (
      action: TAction,
      operation: CriticalActionOperation,
      options: CriticalActionDispatchOptions = {}
    ) => {
      if (activeActionRef.current !== null) return false
      if (
        options.timeoutMs !== undefined &&
        (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
      ) {
        throw new RangeError("Critical action timeout must be positive")
      }

      const operationId = crypto.randomUUID()
      const controller = new AbortController()
      const cancelable = options.cancelable ?? false
      const retryable = options.retryable ?? true
      const execution: ActiveExecution<TAction> = {
        action,
        operationId,
        controller,
        cancelable,
        retryable,
        cancelMessage:
          options.cancelMessage ??
          "The action was cancelled before it could finish.",
        timer: null,
        abortRequest: null,
      }
      activeExecutionRef.current = execution
      retryExecutionRef.current = { action, operation, options }
      activeActionRef.current = action
      setActiveAction(action)
      setErrorState(null)
      setLifecycle({ status: "running", action, operationId, cancelable })

      const finishTerminal = (
        status: "failed" | "timed_out" | "cancelled",
        message: string
      ) => {
        if (activeExecutionRef.current?.operationId !== operationId) return
        if (execution.timer !== null) clearTimeout(execution.timer)
        execution.timer = null
        activeExecutionRef.current = null
        activeActionRef.current = null
        setActiveAction(null)
        setErrorState(message)
        setLifecycle({
          status,
          action,
          operationId,
          message,
          retryable,
        })
      }

      if (options.timeoutMs !== undefined) {
        execution.timer = setTimeout(() => {
          const message =
            options.timeoutMessage ??
            "The action took too long. Nothing was downloaded."
          execution.timer = null
          execution.abortRequest = { status: "timed_out", message }
          controller.abort(new DOMException(message, "TimeoutError"))
          setLifecycle({
            status: "cancelling",
            action,
            operationId,
            reason: "timed_out",
          })
        }, options.timeoutMs)
      }

      let completion: void | Promise<unknown>
      try {
        completion = operation({
          signal: controller.signal,
          operationId,
          enterNonCancelablePhase: () => {
            if (
              activeExecutionRef.current?.operationId !== operationId ||
              execution.abortRequest
            ) {
              return
            }
            if (execution.timer !== null) clearTimeout(execution.timer)
            execution.timer = null
            execution.cancelable = false
            setLifecycle({
              status: "running",
              action,
              operationId,
              cancelable: false,
            })
          },
        })
      } catch (caught) {
        finishTerminal("failed", failureMessage(caught))
        return true
      }
      void Promise.resolve(completion)
        .then(() => {
          if (activeExecutionRef.current?.operationId !== operationId) return
          if (execution.abortRequest) {
            finishTerminal(
              execution.abortRequest.status,
              execution.abortRequest.message
            )
            return
          }
          if (execution.timer !== null) clearTimeout(execution.timer)
          execution.timer = null
          activeExecutionRef.current = null
          activeActionRef.current = null
          retryExecutionRef.current = null
          setActiveAction(null)
          setLifecycle({ status: "idle" })
        })
        .catch((caught: unknown) => {
          if (activeExecutionRef.current?.operationId !== operationId) return
          if (execution.abortRequest) {
            finishTerminal(
              execution.abortRequest.status,
              execution.abortRequest.message
            )
            return
          }
          finishTerminal("failed", failureMessage(caught))
        })
      return true
    },
    []
  )
  dispatchRef.current = dispatch

  const cancel = useCallback(() => {
    const execution = activeExecutionRef.current
    if (!execution?.cancelable || execution.abortRequest) return false
    if (execution.timer !== null) clearTimeout(execution.timer)
    execution.timer = null
    const message = execution.cancelMessage
    execution.abortRequest = { status: "cancelled", message }
    execution.controller.abort(new DOMException(message, "AbortError"))
    setLifecycle({
      status: "cancelling",
      action: execution.action,
      operationId: execution.operationId,
      reason: "cancelled",
    })
    return true
  }, [])

  const retry = useCallback(() => {
    const retryExecution = retryExecutionRef.current
    if (!retryExecution || activeActionRef.current !== null) return false
    return (
      dispatchRef.current?.(
        retryExecution.action,
        retryExecution.operation,
        retryExecution.options
      ) ?? false
    )
  }, [])

  const dismissTerminal = useCallback(() => {
    if (activeActionRef.current !== null) return false
    retryExecutionRef.current = null
    setErrorState(null)
    setLifecycle({ status: "idle" })
    return true
  }, [])

  useEffect(
    () => () => {
      const execution = activeExecutionRef.current
      if (!execution) return
      if (execution.timer !== null) clearTimeout(execution.timer)
      execution.controller.abort(
        new DOMException("The Studio action was closed.", "AbortError")
      )
      activeExecutionRef.current = null
      activeActionRef.current = null
    },
    []
  )

  return {
    activeAction,
    error,
    lifecycle,
    setError,
    claim,
    release,
    dispatch,
    cancel,
    retry,
    dismissTerminal,
  } as const
}
