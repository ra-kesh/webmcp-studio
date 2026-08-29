// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentConflictModel } from "./document-conflict-model"
import { DocumentConflictDialog } from "./document-conflict-dialog"

const conflictModel = (): Extract<
  DocumentConflictModel,
  { status: "conflict" }
> => ({
  status: "conflict",
  documentId: "document-a",
  documentName: "Northstar proposal",
  identity: {
    conflictId: "conflict-a",
    candidateDraftSnapshotId: `sha256-${"a".repeat(64)}`,
  },
  detectedAt: "2026-08-29T05:00:00.000Z",
  expectedRecordVersion: 2,
  observedRecordVersion: 3,
  reason: "stale_write",
  reasonLabel: "A newer saved version exists",
  durableHeadState: "changed",
  heading: "Recover changes to Northstar proposal",
  detail:
    "Your preserved version remains available until you choose how to recover it.",
  durableHeadCopy: "The saved document changed after editing began.",
  actions: ["download", "reload", "save_copy"],
  operation: { status: "idle" },
})

const click = async (label: string) => {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.trim() === label
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${label}`)
  }
  await act(async () => button.click())
}

describe("DocumentConflictDialog", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
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
    model: DocumentConflictModel = conflictModel(),
    overrides: Partial<{
      onDownload: () => void
      onReload: () => void
      onSaveCopy: () => void
      onReturnHome: () => void
    }> = {}
  ) => {
    const callbacks = {
      onDownload: vi.fn(),
      onReload: vi.fn(),
      onSaveCopy: vi.fn(),
      onReturnHome: vi.fn(),
      ...overrides,
    }
    await act(async () => {
      root.render(<DocumentConflictDialog model={model} {...callbacks} />)
    })
    return callbacks
  }

  it("keeps exact preserving actions visible and confirms destructive reload", async () => {
    const callbacks = await mount()

    expect(document.activeElement?.textContent).toBe(
      "Recover changes to Northstar proposal"
    )

    expect(document.body.textContent).toContain(
      "Recover changes to Northstar proposal"
    )
    expect(document.body.textContent).toContain("Download my version")
    expect(document.body.textContent).toContain("Save my changes as a copy")
    expect(document.body.textContent).toContain("Reload saved version")

    await click("Download my version")
    await click("Save my changes as a copy")
    await click("Reload saved version")
    expect(callbacks.onDownload).toHaveBeenCalledTimes(1)
    expect(callbacks.onSaveCopy).toHaveBeenCalledTimes(1)
    expect(callbacks.onReload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Replace the open version?")

    await click("Load saved version")
    expect(callbacks.onReload).toHaveBeenCalledTimes(1)
  })

  it("collapses to a persistent recovery banner instead of disappearing", async () => {
    await mount()
    await click("Close")

    expect(document.body.textContent).toContain(
      "Recovery is still required before you leave."
    )
    await click("Review")
    expect(document.body.textContent).toContain("Download my version")
  })

  it("announces operation failures without losing the recovery actions", async () => {
    await mount({
      ...conflictModel(),
      operation: {
        status: "failed",
        action: "save_copy",
        identity: conflictModel().identity,
        message: "The copy could not be saved.",
        retryable: true,
      },
    })

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "The copy could not be saved."
    )
    expect(document.body.textContent).toContain("Download my version")
    expect(document.body.textContent).toContain("Save my changes as a copy")
  })

  it("keeps the exact saved copy recoverable after route navigation fails", async () => {
    const callbacks = await mount({
      ...conflictModel(),
      operation: {
        status: "failed",
        action: "save_copy",
        identity: conflictModel().identity,
        message: "The copy is saved. Open it to continue editing.",
        retryable: true,
        createdDocumentId: "document-copy",
      },
    })

    expect(document.body.textContent).toContain("Open saved copy")
    await click("Open saved copy")
    expect(callbacks.onSaveCopy).toHaveBeenCalledTimes(1)
  })

  it("provides an explicit return path for quarantined storage", async () => {
    const callbacks = await mount({
      status: "recovery_required",
      documentId: "document-a",
      documentName: "Northstar proposal",
      heading: "Recovery needed for Northstar proposal",
      detail: "The saved document was quarantined and cannot be reopened.",
      failureKind: "corrupt_record",
      operation: { status: "idle" },
    })

    await click("Return to documents")
    expect(callbacks.onReturnHome).toHaveBeenCalledTimes(1)
  })
})
