// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PositionTransformControls } from "./position-transform-controls"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe("PositionTransformControls", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("exposes all three OpenPencil position actions", async () => {
    const onTransform = vi.fn()
    await act(async () => {
      root.render(
        <PositionTransformControls
          flipX
          flipY={false}
          onTransform={onTransform}
        />
      )
    })

    const buttons = Array.from(host.querySelectorAll("button"))
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Flip horizontally",
      "Flip vertically",
      "Rotate 90° clockwise",
    ])
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true")
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false")

    for (const button of buttons) {
      await act(async () => button.click())
    }
    expect(onTransform.mock.calls.map(([action]) => action)).toEqual([
      "flip-horizontal",
      "flip-vertical",
      "rotate-90",
    ])
  })

  it("disables every transform while the layer is immutable", async () => {
    await act(async () => {
      root.render(<PositionTransformControls disabled onTransform={vi.fn()} />)
    })
    expect(
      Array.from(host.querySelectorAll("button")).every(
        (button) => button.disabled
      )
    ).toBe(true)
  })
})
