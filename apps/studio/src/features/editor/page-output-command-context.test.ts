import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import {
  createOutputProductCommandTarget,
  createPageProductCommandTarget,
  dispatchKeyboardContextMenu,
} from "./page-output-command-context"

const context = {
  documentId: renderConformanceDocument.id,
  snapshotId: "snapshot-1",
} as ProductCommandRuntimeContext

describe("page and output product command targets", () => {
  it("captures stable page and output identity", () => {
    const page = renderConformanceDocument.pages[0]
    const output = renderConformanceDocument.outputs[0]

    expect(createPageProductCommandTarget(context, page)).toMatchObject({
      kind: "page",
      pageId: page.id,
      displayName: page.name,
    })
    expect(createOutputProductCommandTarget(context, output)).toMatchObject({
      kind: "output",
      outputId: output.id,
      displayName: output.name,
    })
  })

  it.each([
    { key: "F10", shiftKey: true },
    { key: "ContextMenu", shiftKey: false },
  ])("opens the native context-menu path for $key", ({ key, shiftKey }) => {
    vi.stubGlobal(
      "MouseEvent",
      class TestMouseEvent {
        constructor(
          readonly type: string,
          readonly init: MouseEventInit
        ) {}
      }
    )
    const dispatchEvent = vi.fn((_event: Event) => true)
    const element = {
      dispatchEvent,
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 100,
        height: 40,
      }),
    } as unknown as HTMLElement
    const event = {
      key,
      shiftKey,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchKeyboardContextMenu(event, element)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0].type).toBe("contextmenu")
    vi.unstubAllGlobals()
  })
})
