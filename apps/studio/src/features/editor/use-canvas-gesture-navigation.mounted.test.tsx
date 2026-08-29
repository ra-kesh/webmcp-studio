// @vitest-environment jsdom

import { act, useCallback, useRef, useState } from "react"
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
import type { CanvasCamera } from "@webmcp/editor/viewport"
import { useCanvasGestureNavigation } from "./use-canvas-gesture-navigation"

function Harness({
  showWorkspace,
  applyCamera,
}: {
  showWorkspace: boolean
  applyCamera: (camera: CanvasCamera) => void
}) {
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null)
  const cameraRef = useRef<CanvasCamera>({ x: 0, y: 0, zoom: 1 })
  const onManualNavigation = useCallback(() => undefined, [])

  useCanvasGestureNavigation({
    workspace,
    cameraRef,
    applyCamera,
    onManualNavigation,
  })

  return showWorkspace ? (
    <div aria-label="Canvas viewport" ref={setWorkspace}>
      <canvas aria-label="Fabric canvas" />
    </div>
  ) : null
}

describe("useCanvasGestureNavigation mounted lifecycle", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

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

  it("owns modifier-wheel after the workspace mounts behind an earlier start surface", async () => {
    const applyCamera = vi.fn()
    await act(async () => {
      root.render(<Harness showWorkspace={false} applyCamera={applyCamera} />)
    })
    await act(async () => {
      root.render(<Harness showWorkspace applyCamera={applyCamera} />)
    })

    const canvas = host.querySelector("canvas")
    if (!canvas) throw new Error("Canvas did not mount")
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
      ctrlKey: true,
      deltaY: -1,
    })

    canvas.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
