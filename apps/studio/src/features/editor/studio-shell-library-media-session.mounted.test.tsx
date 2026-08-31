// @vitest-environment jsdom

import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { projectCuratedMediaDetail } from "@webmcp/document"
import { studioMediaManifest } from "../../content/library/media/manifest"
import { useLibraryMediaPickerSession } from "../studio-shell"
import type { ExactLibraryMediaActionPerformer } from "../studio-shell"

type Session = ReturnType<typeof useLibraryMediaPickerSession>

const detail = () =>
  projectCuratedMediaDetail(studioMediaManifest[0], {
    curatedRank: 0,
    preferences: { favorite: false, lastUsedAt: null, collectionIds: [] },
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function Harness({
  documentId,
  perform,
  recordUsed,
  requestFrame,
  capture,
}: {
  documentId: string
  perform: ExactLibraryMediaActionPerformer
  recordUsed?: Parameters<typeof useLibraryMediaPickerSession>[0]["recordUsed"]
  requestFrame?: (callback: FrameRequestCallback) => number
  capture: (session: Session) => void
}) {
  const session = useLibraryMediaPickerSession({
    documentId,
    performLibraryMediaAction: perform,
    recordUsed,
    requestFrame:
      requestFrame ??
      ((callback) => {
        callback(0)
        return 1
      }),
  })
  useLayoutEffect(() => capture(session), [capture, session])
  return null
}

describe("Studio shell exact media picker session", () => {
  let host: HTMLDivElement
  let root: Root
  let latest: Session
  const capture = (session: Session) => {
    latest = session
  }

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  const mount = async (
    perform: ExactLibraryMediaActionPerformer,
    documentId = "document-one",
    recordUsed?: Parameters<
      typeof useLibraryMediaPickerSession
    >[0]["recordUsed"],
    requestFrame?: (callback: FrameRequestCallback) => number
  ) => {
    await act(async () => {
      root.render(
        <Harness
          capture={capture}
          documentId={documentId}
          perform={perform}
          recordUsed={recordUsed}
          requestFrame={requestFrame}
        />
      )
    })
  }

  it("routes one captured target and strict detail through one executor", async () => {
    const selected = detail()
    const gate = deferred<"committed">()
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async () => gate.promise
    )
    const recordUsed = vi.fn(async () => true)
    await mount(perform, "document-one", recordUsed)

    await act(async () => {
      latest.openAction({
        target: { type: "insert", pageId: "page-captured" },
        initialCollection: "library",
      })
    })
    let completion!: Promise<"committed" | "no_op" | "rejected">
    act(() => {
      completion = latest.executeExactSelection(selected)
    })

    expect(perform).toHaveBeenCalledTimes(1)
    const [request, options] = perform.mock.calls[0]
    expect(request.target).toEqual({
      type: "insert",
      pageId: "page-captured",
    })
    expect(request.detail).toEqual(selected)
    expect(request.detail).not.toBe(selected)
    expect(options?.recordUsed).toBe(recordUsed)
    expect(latest.state).toMatchObject({
      kind: "action",
      selectedDetail: selected,
      pendingIdentity: `media:curated:${selected.summary.id}@${selected.summary.version}`,
    })

    await act(async () => {
      gate.resolve("committed")
      await completion
    })
    expect(latest.state).toBeNull()
  })

  it("owns the shared browser scope for the lifetime of an action session", async () => {
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async () => "rejected"
    )
    await mount(perform)

    await act(async () => {
      latest.openAction({
        target: { type: "insert", pageId: "page-one" },
        initialCollection: "library",
      })
    })
    expect(latest.state).toMatchObject({
      kind: "action",
      scope: { kind: "library" },
    })

    await act(async () => {
      latest.setScope({
        kind: "collection",
        collectionId: "collection-brand",
        label: "Brand kit",
      })
    })
    expect(latest.state).toMatchObject({
      kind: "action",
      scope: {
        kind: "collection",
        collectionId: "collection-brand",
        label: "Brand kit",
      },
    })

    await act(async () => latest.close(false))
    expect(latest.state).toBeNull()
  })

  it("aborts an old target and fences its stale completion from the new session", async () => {
    const first = deferred<"committed">()
    const signals: AbortSignal[] = []
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async (_request, options) => {
        signals.push(options!.signal!)
        return first.promise
      }
    )
    await mount(perform)

    await act(async () => {
      latest.openAction({ target: { type: "insert", pageId: "page-one" } })
    })
    let stale!: Promise<"committed" | "no_op" | "rejected">
    act(() => {
      stale = latest.executeExactSelection(detail())
    })
    await act(async () => {
      latest.openAction({
        target: {
          type: "replace",
          pageId: "page-two",
          nodeId: "image-two",
        },
      })
    })
    expect(signals[0].aborted).toBe(true)

    await act(async () => {
      first.resolve("committed")
      await stale
    })
    expect(latest.state).toMatchObject({
      kind: "action",
      target: {
        type: "replace",
        pageId: "page-two",
        nodeId: "image-two",
      },
    })
  })

  it("preserves the external opener through nested picker modes and fences stale focus", async () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async () => "rejected"
    )
    const originalOpener = document.createElement("button")
    const staleOpener = document.createElement("button")
    const currentOpener = document.createElement("button")
    const dialogControl = document.createElement("button")
    document.body.appendChild(originalOpener)
    document.body.appendChild(staleOpener)
    document.body.appendChild(currentOpener)
    document.body.appendChild(dialogControl)
    const originalFocus = vi.spyOn(originalOpener, "focus")
    const staleFocus = vi.spyOn(staleOpener, "focus")
    const currentFocus = vi.spyOn(currentOpener, "focus")
    await mount(perform, "document-one", undefined, requestFrame)

    await act(async () => {
      latest.openAction({
        target: { type: "insert", pageId: "page-one" },
        focusReturnTarget: originalOpener,
      })
      dialogControl.focus()
      latest.openRecovery({ localAssetId: "local-image-one" })
      latest.close(true)
    })
    expect(frames).toHaveLength(1)
    act(() => frames.shift()!(0))
    expect(originalFocus).toHaveBeenCalledTimes(1)

    await act(async () => {
      latest.openAction({
        target: { type: "insert", pageId: "page-one" },
        focusReturnTarget: staleOpener,
      })
      latest.close(true)
      latest.openAction({
        target: { type: "insert", pageId: "page-one" },
        focusReturnTarget: currentOpener,
      })
      dialogControl.focus()
      latest.openRecovery({ localAssetId: "local-image-two" })
      latest.close(true)
    })
    expect(frames).toHaveLength(2)
    act(() => {
      frames.shift()!(0)
      frames.shift()!(0)
    })
    expect(staleFocus).not.toHaveBeenCalled()
    expect(currentFocus).toHaveBeenCalledTimes(1)

    originalOpener.remove()
    staleOpener.remove()
    currentOpener.remove()
    dialogControl.remove()
  })

  it("aborts on close, restores the captured focus once, and aborts on document switch", async () => {
    const gate = deferred<"rejected">()
    const signalRef: { current: AbortSignal | null } = { current: null }
    const currentSignal = () => {
      if (!signalRef.current) throw new Error("Expected an action signal.")
      return signalRef.current
    }
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async (_request, options) => {
        signalRef.current = options?.signal ?? null
        return gate.promise
      }
    )
    const trigger = document.createElement("button")
    document.body.appendChild(trigger)
    const focus = vi.spyOn(trigger, "focus")
    await mount(perform)

    await act(async () => {
      latest.openAction({
        target: { type: "insert", pageId: "page-one" },
        focusReturnTarget: trigger,
      })
    })
    act(() => {
      void latest.executeExactSelection(detail())
    })
    await act(async () => latest.close(true))
    expect(currentSignal().aborted).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)

    await act(async () => {
      latest.openAction({ target: { type: "insert", pageId: "page-one" } })
    })
    act(() => {
      void latest.executeExactSelection(detail())
    })
    await act(async () => {
      root.render(
        <Harness
          capture={capture}
          documentId="document-two"
          perform={perform}
        />
      )
    })
    expect(currentSignal().aborted).toBe(true)
    expect(latest.state).toBeNull()

    await act(async () => {
      latest.openAction({ target: { type: "insert", pageId: "page-two" } })
    })
    act(() => {
      void latest.executeExactSelection(detail())
    })
    await act(async () => root.render(<div />))
    expect(currentSignal().aborted).toBe(true)
    trigger.remove()
    gate.resolve("rejected")
  })

  it("keeps post-commit retry ownership after close without repeating the edit", async () => {
    const retry = vi.fn(async () => true)
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(
      async (_request, options) => {
        options?.onUsageWarning?.({
          key: "record_used",
          message: "The edit is safe; Recent needs retry.",
          retry,
        })
        return "committed"
      }
    )
    await mount(perform)
    await act(async () => {
      latest.openAction({ target: { type: "insert", pageId: "page-one" } })
    })
    await act(async () => {
      await latest.executeExactSelection(detail())
    })

    expect(latest.state).toBeNull()
    expect(latest.usageNotices).toHaveLength(1)
    const notice = latest.usageNotices[0]
    expect(notice.id).toBe(`${notice.correlationId}:record_used`)
    await act(async () => {
      await latest.retryUsageNotice(notice.id)
    })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(perform).toHaveBeenCalledTimes(1)
    expect(latest.usageNotices).toHaveLength(0)
  })

  it("preserves the assign-field target through the strict action seam", async () => {
    const perform = vi.fn<ExactLibraryMediaActionPerformer>(async () => "no_op")
    await mount(perform)
    await act(async () => {
      latest.openAction({
        target: { type: "assign_field", fieldId: "field-hero-image" },
        targetName: "Hero image",
      })
      await latest.executeExactSelection(detail())
    })

    expect(perform).toHaveBeenCalledTimes(1)
    expect(perform.mock.calls[0][0].target).toEqual({
      type: "assign_field",
      fieldId: "field-hero-image",
    })
    expect(latest.state).toBeNull()
  })
})
