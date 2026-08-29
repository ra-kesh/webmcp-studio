// @vitest-environment jsdom

import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDraftReplacement } from "./use-draft-replacement"

type Coordinator = ReturnType<typeof useDraftReplacement>

function MountedCoordinator({
  capture,
  flushCurrentDraft,
  settleWorkspaceEdits,
  onOpened,
  onSeparateTransitionChange,
  hasCurrentDraft = true,
  workspaceActive = true,
}: {
  capture: (value: Coordinator) => void
  flushCurrentDraft: () => boolean | Promise<boolean>
  settleWorkspaceEdits?: () => boolean
  onOpened: () => void | Promise<void>
  onSeparateTransitionChange?: (active: boolean) => void
  hasCurrentDraft?: boolean
  workspaceActive?: boolean
}) {
  const value = useDraftReplacement({
    hasCurrentDraft,
    workspaceActive,
    settleWorkspaceEdits,
    flushCurrentDraft,
    onOpened,
    onSeparateTransitionChange,
  })
  useLayoutEffect(() => capture(value))
  return null
}

describe("draft replacement coordinator", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it("retains confirmation and blocks replacement when the critical flush fails", async () => {
    let flushSucceeds = false
    const run = vi.fn(() => true)
    const onOpened = vi.fn()
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => flushSucceeds}
          onOpened={onOpened}
        />
      )
    })

    let requested: boolean | "queued" = false
    await act(async () => {
      requested =
        (await captured.current?.request(
          { kind: "blank" },
          "Creating a blank document",
          run
        )) ?? false
    })
    expect(requested).toBe("queued")
    expect(captured.current?.pending).not.toBeNull()

    await act(async () => {
      expect(await captured.current?.confirm()).toBe(false)
    })
    expect(run).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
    expect(captured.current?.pending).not.toBeNull()

    flushSucceeds = true
    await act(async () => {
      expect(await captured.current?.confirm()).toBe(true)
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(captured.current?.pending).toBeNull()
  })

  it("runs a Home creation immediately without opening replacement state", async () => {
    const run = vi.fn(() => true)
    const flushCurrentDraft = vi.fn(() => true)
    const onOpened = vi.fn()
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={flushCurrentDraft}
          hasCurrentDraft={false}
          onOpened={onOpened}
          workspaceActive={false}
        />
      )
    })

    let result: boolean | "queued" = false
    await act(async () => {
      result =
        (await captured.current?.request(
          { kind: "blank" },
          "Create a separate document",
          run
        )) ?? false
    })

    expect(result).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(flushCurrentDraft).not.toHaveBeenCalled()
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(captured.current?.pending).toBeNull()
  })

  it("locks the first request and first confirmation synchronously", async () => {
    let resolveRun: ((value: boolean) => void) | undefined
    const firstRun = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRun = resolve
        })
    )
    const secondRun = vi.fn(() => true)
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => true}
          onOpened={() => undefined}
        />
      )
    })

    await act(async () => {
      await captured.current?.request(
        { kind: "blank" },
        "First action",
        firstRun
      )
      await captured.current?.request(
        { kind: "sample" },
        "Second action",
        secondRun
      )
    })
    expect(captured.current?.pending?.nextActionLabel).toBe("First action")

    let firstConfirmation: Promise<boolean> | undefined
    let secondConfirmation: boolean | undefined
    await act(async () => {
      firstConfirmation = captured.current?.confirm()
      secondConfirmation = await captured.current?.confirm()
    })
    expect(secondConfirmation).toBe(false)
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(secondRun).not.toHaveBeenCalled()

    await act(async () => {
      resolveRun?.(true)
      expect(await firstConfirmation).toBe(true)
    })
    expect(captured.current?.pending).toBeNull()
  })

  it("settles live editor state before the critical flush and replacement", async () => {
    const events: string[] = []
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => {
            events.push("flush")
            return true
          }}
          onOpened={() => {
            events.push("opened")
          }}
          settleWorkspaceEdits={() => {
            events.push("settle")
            return true
          }}
        />
      )
    })
    await act(async () => {
      await captured.current?.request({ kind: "sample" }, "Open sample", () => {
        events.push("replace")
        return true
      })
      await captured.current?.confirm()
    })

    expect(events).toEqual(["settle", "flush", "replace", "opened"])
  })

  it("settles and flushes before creating a separate document without replacement state", async () => {
    const events: string[] = []
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => {
            events.push("flush")
            return true
          }}
          onOpened={() => {
            events.push("opened")
          }}
          onSeparateTransitionChange={(active) =>
            events.push(active ? "lock" : "unlock")
          }
          settleWorkspaceEdits={() => {
            events.push("settle")
            return true
          }}
        />
      )
    })

    let result: boolean | "queued" = false
    await act(async () => {
      result =
        (await captured.current?.createSeparate(
          { kind: "template", templateId: "editorial", version: 1 },
          () => {
            events.push("create")
            return true
          }
        )) ?? false
    })

    expect(result).toBe(true)
    expect(events).toEqual([
      "settle",
      "lock",
      "flush",
      "create",
      "opened",
      "unlock",
    ])
    expect(captured.current?.pending).toBeNull()
  })

  it("keeps a deferred separate creation locked and restores interaction after failure", async () => {
    let resolveFlush: ((value: boolean) => void) | undefined
    const transitionStates: boolean[] = []
    const run = vi.fn(() => true)
    const onOpened = vi.fn()
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() =>
            new Promise<boolean>((resolve) => {
              resolveFlush = resolve
            })
          }
          onOpened={onOpened}
          onSeparateTransitionChange={(active) => transitionStates.push(active)}
          settleWorkspaceEdits={() => true}
        />
      )
    })

    let creation: Promise<boolean | "queued"> | undefined
    await act(async () => {
      creation = captured.current?.createSeparate({ kind: "blank" }, run)
      await Promise.resolve()
    })
    expect(transitionStates).toEqual([true])
    expect(captured.current?.replacing).toBe(true)
    expect(captured.current?.pending).toBeNull()
    expect(run).not.toHaveBeenCalled()

    await act(async () => {
      resolveFlush?.(false)
      expect(await creation).toBe(false)
    })
    expect(transitionStates).toEqual([true, false])
    expect(captured.current?.replacing).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
  })

  it("keeps a successful separate creation locked through deferred route handoff", async () => {
    let resolveOpened: (() => void) | undefined
    const transitionStates: boolean[] = []
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => true}
          onOpened={() =>
            new Promise<void>((resolve) => {
              resolveOpened = resolve
            })
          }
          onSeparateTransitionChange={(active) => transitionStates.push(active)}
          settleWorkspaceEdits={() => true}
        />
      )
    })

    let creation: Promise<boolean | "queued"> | undefined
    await act(async () => {
      creation = captured.current?.createSeparate({ kind: "blank" }, () => true)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(transitionStates).toEqual([true])
    expect(captured.current?.replacing).toBe(true)

    await act(async () => {
      resolveOpened?.()
      expect(await creation).toBe(true)
    })
    expect(transitionStates).toEqual([true, false])
    expect(captured.current?.replacing).toBe(false)
  })

  it("does not start replacement until a deferred critical flush succeeds", async () => {
    let resolveFlush: ((value: boolean) => void) | undefined
    const events: string[] = []
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() =>
            new Promise<boolean>((resolve) => {
              events.push("flush-started")
              resolveFlush = resolve
            })
          }
          onOpened={() => {
            events.push("opened")
          }}
          settleWorkspaceEdits={() => {
            events.push("settled")
            return true
          }}
        />
      )
    })
    await act(async () => {
      await captured.current?.request({ kind: "blank" }, "Create", () => {
        events.push("replaced")
        return true
      })
    })

    let confirmation: Promise<boolean> | undefined
    await act(async () => {
      confirmation = captured.current?.confirm()
      await Promise.resolve()
    })
    expect(events).toEqual(["settled", "flush-started"])
    expect(captured.current?.pending).not.toBeNull()
    expect(captured.current?.replacing).toBe(true)

    await act(async () => {
      resolveFlush?.(true)
      expect(await confirmation).toBe(true)
    })
    expect(events).toEqual(["settled", "flush-started", "replaced", "opened"])
  })

  it("retains confirmation when the critical flush rejects", async () => {
    const run = vi.fn(() => true)
    const onOpened = vi.fn()
    const captured: { current: Coordinator | null } = { current: null }
    await act(async () => {
      root.render(
        <MountedCoordinator
          capture={(value) => {
            captured.current = value
          }}
          flushCurrentDraft={() => Promise.reject(new Error("flush failed"))}
          onOpened={onOpened}
        />
      )
    })
    await act(async () => {
      await captured.current?.request({ kind: "sample" }, "Restore", run)
    })

    await act(async () => {
      expect(await captured.current?.confirm()).toBe(false)
    })
    expect(run).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
    expect(captured.current?.pending).not.toBeNull()
    expect(captured.current?.replacing).toBe(false)
  })
})
