// @vitest-environment jsdom

import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { useCriticalActionOwner } from "./use-critical-action-owner"

type Action = "home" | "export-json" | "export-png" | "export-pdf"
type Owner = ReturnType<typeof useCriticalActionOwner<Action>>

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function Harness({ capture }: { capture: (owner: Owner) => void }) {
  const owner = useCriticalActionOwner<Action>()
  useLayoutEffect(() => {
    capture(owner)
  })
  return null
}

describe("useCriticalActionOwner", () => {
  let host: HTMLDivElement
  let root: Root
  let current: Owner | null

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    current = null
    await act(async () => {
      root.render(<Harness capture={(owner) => (current = owner)} />)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("claims synchronously before render and rejects concurrent actions", async () => {
    let first = false
    let duplicate = true
    let other = true
    await act(async () => {
      first = current!.claim("home")
      duplicate = current!.claim("home")
      other = current!.claim("export-json")
    })

    expect(first).toBe(true)
    expect(duplicate).toBe(false)
    expect(other).toBe(false)
    expect(current?.activeAction).toBe("home")
  })

  it("only the owner releases the lock and the next action can claim it", async () => {
    await act(async () => {
      expect(current!.claim("home")).toBe(true)
      expect(current!.release("export-json")).toBe(false)
      expect(current!.claim("export-json")).toBe(false)
      expect(current!.release("home")).toBe(true)
      expect(current!.claim("export-json")).toBe(true)
    })

    expect(current?.activeAction).toBe("export-json")
  })

  it("keeps the eventual failure visible until another action is accepted", async () => {
    await act(async () => {
      expect(current!.claim("home")).toBe(true)
      current!.setError("Home could not save the document.")
      expect(current!.release("home")).toBe(true)
    })
    expect(current?.error).toBe("Home could not save the document.")

    await act(async () => {
      expect(current!.claim("export-json")).toBe(true)
    })
    expect(current?.error).toBeNull()
  })

  it.each<Action>(["home", "export-json", "export-png", "export-pdf"])(
    "accepts the first %s dispatch synchronously and rejects a same-tick duplicate",
    async (action) => {
      const completion = deferred<void>()
      const duplicateOperation = vi.fn()
      let accepted = false
      let duplicateAccepted = true

      await act(async () => {
        accepted = current!.dispatch(action, () => completion.promise)
        duplicateAccepted = current!.dispatch(action, duplicateOperation)
      })

      expect(accepted).toBe(true)
      expect(duplicateAccepted).toBe(false)
      expect(duplicateOperation).not.toHaveBeenCalled()
      expect(current?.activeAction).toBe(action)

      await act(async () => completion.resolve())
      await vi.waitFor(() => expect(current?.activeAction).toBeNull())
    }
  )

  it("releases a failed deferred dispatch but keeps its error visible", async () => {
    const completion = deferred<void>()
    const failure = new Error("PDF export failed after the save completed.")

    await act(async () => {
      expect(current!.dispatch("export-pdf", () => completion.promise)).toBe(
        true
      )
    })
    expect(current?.activeAction).toBe("export-pdf")

    await act(async () => completion.reject(failure))
    await vi.waitFor(() => expect(current?.activeAction).toBeNull())
    expect(current?.error).toBe(failure.message)

    await act(async () => Promise.resolve())
    expect(current?.error).toBe(failure.message)

    const next = deferred<void>()
    await act(async () => {
      expect(current!.dispatch("export-json", () => next.promise)).toBe(true)
    })
    expect(current?.error).toBeNull()
    await act(async () => next.resolve())
    await vi.waitFor(() => expect(current?.activeAction).toBeNull())
  })

  it("times out an action, keeps ownership while it stops, then exposes retry", async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      await act(async () => {
        expect(
          current!.dispatch(
            "export-png",
            (context) => {
              signals.push(context.signal)
              return new Promise((_resolve, reject) => {
                context.signal.addEventListener(
                  "abort",
                  () => reject(context.signal.reason),
                  { once: true }
                )
              })
            },
            {
              cancelable: true,
              timeoutMs: 1_000,
              timeoutMessage: "PNG export timed out.",
            }
          )
        ).toBe(true)
      })

      act(() => vi.advanceTimersByTime(1_000))

      expect(signals[0]?.aborted).toBe(true)
      expect(signals[0]?.reason).toMatchObject({ name: "TimeoutError" })
      expect(current?.activeAction).toBe("export-png")
      expect(current?.lifecycle).toMatchObject({
        status: "cancelling",
        action: "export-png",
        reason: "timed_out",
      })
      expect(current!.retry()).toBe(false)

      await act(async () => Promise.resolve())
      await vi.waitFor(() => expect(current?.activeAction).toBeNull())
      expect(current?.lifecycle).toMatchObject({
        status: "timed_out",
        action: "export-png",
        message: "PNG export timed out.",
        retryable: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("prevents retry overlap until cancelled work acknowledges the abort", async () => {
    const completions = [deferred<void>(), deferred<void>()]
    const signals: AbortSignal[] = []
    let invocation = 0
    const operation = ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal)
      return completions[invocation++].promise
    }

    await act(async () => {
      expect(
        current!.dispatch("export-pdf", operation, {
          cancelable: true,
          timeoutMs: 10_000,
        })
      ).toBe(true)
    })
    await act(async () => {
      expect(current!.cancel()).toBe(true)
    })
    expect(signals[0]?.aborted).toBe(true)
    expect(current?.lifecycle).toMatchObject({
      status: "cancelling",
      action: "export-pdf",
      reason: "cancelled",
    })
    expect(current?.activeAction).toBe("export-pdf")
    expect(current!.cancel()).toBe(false)
    expect(current!.retry()).toBe(false)

    await act(async () => completions[0].reject(signals[0]?.reason))
    await vi.waitFor(() => expect(current?.activeAction).toBeNull())
    expect(current?.lifecycle).toMatchObject({
      status: "cancelled",
      action: "export-pdf",
      retryable: true,
    })

    await act(async () => expect(current!.retry()).toBe(true))
    expect(current?.activeAction).toBe("export-pdf")
    expect(signals[1]?.aborted).toBe(false)
    await act(async () => completions[1].resolve())
    await vi.waitFor(() => expect(current?.activeAction).toBeNull())
    expect(current?.lifecycle).toEqual({ status: "idle" })
  })
})
