// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocalAssetPromotionControl } from "./asset-library-components"
import type { LocalAssetPromotionViewState } from "./use-document-editor"

const promotion = (
  phase: LocalAssetPromotionViewState["phase"],
  retryable = false
): LocalAssetPromotionViewState => ({
  operationId: "operation-1",
  localAssetId: "local-1",
  sourceDocumentId: "document-1",
  expectedReferenceKeys: ["node/photo/src"],
  managedAssetId: "asset-1234567890",
  relinkCommitId: "commit-1",
  phase,
  loaded: null,
  total: null,
  message: null,
  retryable,
  undoable: null,
})

describe("local asset promotion action focus", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.replaceChildren()
  })

  const render = (current?: LocalAssetPromotionViewState) => {
    act(() => {
      root.render(
        <LocalAssetPromotionControl
          mutationDisabled={false}
          promotion={current}
          referenceCount={1}
          onCancelPromotion={vi.fn()}
          onPromote={vi.fn()}
        />
      )
    })
  }

  it("preserves the action DOM node and focus from Start through Cancel and Retry", () => {
    render()
    const action = host.querySelector("button")!
    action.focus()

    render(promotion("preparing"))
    expect(host.querySelector("button")).toBe(action)
    expect(document.activeElement).toBe(action)
    expect(action.textContent).toContain("Cancel")

    render(promotion("cancelling"))
    expect(host.querySelector("button")).toBe(action)
    expect(document.activeElement).toBe(action)
    expect(action.textContent).toContain("Stopping")

    render(promotion("failed", true))
    expect(host.querySelector("button")).toBe(action)
    expect(document.activeElement).toBe(action)
    expect(action.textContent).toContain("Retry")
  })

  it("does not steal focus back when the user moved elsewhere", () => {
    render(promotion("preparing"))
    const action = host.querySelector("button")!
    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    action.focus()
    elsewhere.focus()

    render(promotion("failed", true))

    expect(document.activeElement).toBe(elsewhere)
  })
})
