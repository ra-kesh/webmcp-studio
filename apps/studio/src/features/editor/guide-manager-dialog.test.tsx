// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  GuideManagerDialog,
  validateGuidePosition,
} from "./guide-manager-dialog"

describe("guide position validation", () => {
  it("accepts finite in-page coordinates and rejects empty or out-of-page values", () => {
    expect(
      validateGuidePosition("42.25", "x", { width: 100, height: 80 })
    ).toEqual({
      value: 42.25,
      error: null,
    })
    expect(
      validateGuidePosition("", "x", { width: 100, height: 80 }).error
    ).toBe("Enter a coordinate.")
    expect(
      validateGuidePosition("81", "y", { width: 100, height: 80 }).error
    ).toBe("Enter a coordinate from 0 to 80.")
  })
})

describe("GuideManagerDialog", () => {
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

  it("provides labelled exact-coordinate controls and named remove actions", async () => {
    await act(async () => {
      root.render(
        <GuideManagerDialog
          open
          guides={[
            { id: "guide-x", axis: "x", position: 120 },
            { id: "guide-y", axis: "y", position: 240 },
          ]}
          pageName="Cover"
          pageSize={{ width: 1240, height: 1754 }}
          onAddGuide={vi.fn()}
          onMoveGuide={vi.fn()}
          onOpenChange={vi.fn()}
          onRemoveGuide={vi.fn()}
        />
      )
    })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain("Manage guides")
    expect(dialog?.textContent).toContain("Guides stay in the editor")
    expect(dialog?.querySelector('input[aria-invalid="false"]')).not.toBeNull()
    expect(
      dialog?.querySelector('button[aria-label="Remove vertical guide at 120"]')
    ).not.toBeNull()
    expect(
      dialog?.querySelector(
        'button[aria-label="Remove horizontal guide at 240"]'
      )
    ).not.toBeNull()
    expect(
      dialog?.querySelector('[role="status"][aria-live="polite"]')
    ).not.toBeNull()
  })

  it("validates additions inline and submits a canonical guide mutation", async () => {
    const onAddGuide = vi.fn()
    await act(async () => {
      root.render(
        <GuideManagerDialog
          open
          guides={[]}
          pageName="Cover"
          pageSize={{ width: 1240, height: 1754 }}
          onAddGuide={onAddGuide}
          onMoveGuide={vi.fn()}
          onOpenChange={vi.fn()}
          onRemoveGuide={vi.fn()}
        />
      )
    })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    if (!dialog) throw new Error("Expected the guide manager dialog")
    const input = dialog.querySelector<HTMLInputElement>(
      'input[type="number"][max="1240"]'
    )
    const addButton = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add guide")
    )
    expect(input).not.toBeNull()
    expect(addButton).not.toBeUndefined()

    await act(async () => addButton?.click())
    expect(dialog.textContent).toContain("Enter a coordinate.")

    await act(async () => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setter?.call(input, "84.5")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => addButton?.click())
    expect(onAddGuide).toHaveBeenCalledWith({ axis: "x", position: 84.5 })
  })

  it("restores focus to the explicit opener when it closes", async () => {
    const opener = document.createElement("button")
    document.body.appendChild(opener)
    opener.focus()
    const returnFocusRef = { current: opener }
    const renderDialog = (open: boolean) => (
      <GuideManagerDialog
        open={open}
        guides={[]}
        pageName="Cover"
        pageSize={{ width: 1240, height: 1754 }}
        returnFocusRef={returnFocusRef}
        onAddGuide={vi.fn()}
        onMoveGuide={vi.fn()}
        onOpenChange={vi.fn()}
        onRemoveGuide={vi.fn()}
      />
    )

    await act(async () => root.render(renderDialog(true)))
    await act(async () => root.render(renderDialog(false)))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
