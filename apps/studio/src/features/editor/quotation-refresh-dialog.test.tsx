// @vitest-environment jsdom

import { useState } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  builtInDesignTemplateRepository,
  northstarQuotationPayload,
} from "@webmcp/document"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuotationRefreshDialog } from "./quotation-refresh-dialog"
import type { PendingQuotationRefresh } from "./quotation-refresh-journal"

const hash = (digit: string) => `sha256-${digit.repeat(64)}`

const pendingRefresh = (): PendingQuotationRefresh => {
  const document = builtInDesignTemplateRepository.materialize(
    "quotation-editorial-olive",
    2,
    { identity: "canonical", quotation: northstarQuotationPayload }
  )
  const incomingSource = structuredClone(northstarQuotationPayload)
  incomingSource.source.revision = 4
  incomingSource.quote.quoteVersion = 4
  return {
    id: "dialog-refresh",
    preparedAt: "2026-08-30T04:00:00.000Z",
    documentId: document.id,
    baseDocumentRevision: document.revision,
    baseHistorySnapshotId: "history-dialog",
    baseDraftSnapshotId: "draft-dialog",
    baseContentSnapshotId: hash("1"),
    candidateContentSnapshotId: hash("2"),
    base: {
      quotationId: "quotation-dialog",
      sourceRevision: 3,
      quoteVersion: 3,
      contractVersion: 1,
      sourceSnapshotId: hash("3"),
    },
    incoming: {
      quotationId: "quotation-dialog",
      sourceRevision: 4,
      quoteVersion: 4,
      contractVersion: 1,
      sourceSnapshotId: hash("4"),
    },
    incomingSource,
    candidateDocument: { ...document, revision: document.revision + 1 },
    composerVersion: 2,
    template: { id: "quotation-editorial-olive", version: 2 },
    appearanceTemplateId: "editorial-olive",
    proposalId: hash("5"),
    impact: {
      changedSourcePaths: ["document.events[welcome].location"],
      changedCategories: ["Events"],
      generatedPageCount: 6,
      previousGeneratedPageCount: 5,
      generatedLayerCount: 90,
      addedSourceLayers: 0,
      removedSourceLayers: 0,
      updatedSourceLayers: 1,
      preservedStudioLayers: 1,
      preservedCustomLayerCount: 0,
      businessChanges: [
        { category: "Events", added: 0, removed: 0, updated: 1 },
      ],
      conflicts: [
        {
          kind: "changed_by_both",
          semanticKey: "event.welcome.schedule",
          layerName: "Welcome dinner schedule",
          properties: ["text"],
        },
      ],
    },
    collisionChoices: {},
  }
}

describe("QuotationRefreshDialog", () => {
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
  })

  it("requires an explicit accessible collision choice before durable acceptance", async () => {
    const choose = vi.fn(async (_semanticKey: string, _choice: string) => true)
    const accept = vi.fn(async () => true)
    const reject = vi.fn(async () => true)

    function Fixture() {
      const [pending, setPending] = useState(pendingRefresh())
      return (
        <QuotationRefreshDialog
          open
          pending={pending}
          error="The latest choice could not be saved."
          onOpenChange={() => undefined}
          onChooseConflict={async (semanticKey, choice) => {
            const result = await choose(semanticKey, choice)
            if (result) {
              setPending((current) => ({
                ...current,
                collisionChoices: {
                  ...current.collisionChoices,
                  [semanticKey]: choice,
                },
              }))
            }
            return result
          }}
          onAccept={accept}
          onReject={reject}
        />
      )
    }

    await act(async () => root.render(<Fixture />))
    expect(document.body.textContent).toContain("Revision 3")
    expect(
      document.body.querySelector('[aria-label="Revision 3 to 4"]')
    ).not.toBeNull()
    expect(document.body.textContent).not.toContain("event.welcome.schedule")
    expect(document.body.textContent).toContain("Events · 1 updated")
    expect(document.body.textContent).toContain("5 → 6")
    expect(
      document.body.querySelector('[role="alert"]')?.textContent
    ).toContain("could not be saved")
    const acceptButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Accept update")
    )
    expect(acceptButton?.disabled).toBe(true)
    const keepStudio = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Keep Studio")
    )
    await act(async () => keepStudio?.click())
    expect(choose).toHaveBeenCalledWith(
      "event.welcome.schedule",
      "preserve_studio"
    )
    expect(acceptButton?.disabled).toBe(false)

    await act(async () => acceptButton?.click())
    expect(accept).toHaveBeenCalledTimes(1)
  })
})
