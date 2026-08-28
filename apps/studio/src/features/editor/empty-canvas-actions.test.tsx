// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmptyCanvasActions } from "./empty-canvas-actions"

describe("EmptyCanvasActions", () => {
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

  it("exposes and dispatches all four existing creation paths", async () => {
    const actions = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    await act(async () => {
      root.render(
        <EmptyCanvasActions
          onAddText={actions[0]}
          onAddImage={actions[1]}
          onChooseTemplate={actions[2]}
          onAddPage={actions[3]}
        />
      )
    })
    const region = host.querySelector('[aria-label="Empty page actions"]')
    expect(region?.getAttribute("data-editor-overlay-control")).toBe("true")
    const buttons = region?.querySelectorAll<HTMLButtonElement>("button")
    expect(buttons).toHaveLength(4)
    expect(region?.querySelector("div.mt-4")?.className).toContain(
      "grid-cols-1"
    )
    expect(
      [...(buttons ?? [])].every((button) =>
        button.className.includes("min-h-11")
      )
    ).toBe(true)
    for (const button of buttons ?? []) {
      await act(async () => button.click())
    }
    for (const action of actions) expect(action).toHaveBeenCalledOnce()
  })

  it("truthfully disables every mutation while editing is unavailable", async () => {
    await act(async () => {
      root.render(
        <EmptyCanvasActions
          disabled
          onAddText={vi.fn()}
          onAddImage={vi.fn()}
          onChooseTemplate={vi.fn()}
          onAddPage={vi.fn()}
        />
      )
    })
    const buttons = host.querySelectorAll<HTMLButtonElement>("button")
    expect(buttons).toHaveLength(4)
    expect([...buttons].every((button) => button.disabled)).toBe(true)
    expect(host.textContent).toContain(
      "Resolve the current review or recovery state"
    )
  })

  it("keeps double-clicks on the action card out of viewport zoom", async () => {
    const onViewportDoubleClick = vi.fn()
    await act(async () => {
      root.render(
        <div onDoubleClick={onViewportDoubleClick}>
          <EmptyCanvasActions
            onAddText={vi.fn()}
            onAddImage={vi.fn()}
            onChooseTemplate={vi.fn()}
            onAddPage={vi.fn()}
          />
        </div>
      )
    })
    const region = host.querySelector<HTMLElement>(
      '[aria-label="Empty page actions"]'
    )
    await act(async () => {
      region?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true })
      )
    })
    expect(onViewportDoubleClick).not.toHaveBeenCalled()
  })
})
