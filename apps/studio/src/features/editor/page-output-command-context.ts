import type { Document } from "@webmcp/document"
import type {
  ProductCommandRuntimeContext,
  ProductCommandTarget,
} from "@webmcp/editor/product-commands"

export function createPageProductCommandTarget(
  context: ProductCommandRuntimeContext,
  page: Document["pages"][number]
): Extract<ProductCommandTarget, { kind: "page" }> {
  return {
    kind: "page",
    documentId: context.documentId,
    snapshotId: context.snapshotId,
    displayName: page.name,
    pageId: page.id,
  }
}

export function createOutputProductCommandTarget(
  context: ProductCommandRuntimeContext,
  output: Document["outputs"][number]
): Extract<ProductCommandTarget, { kind: "output" }> {
  return {
    kind: "output",
    documentId: context.documentId,
    snapshotId: context.snapshotId,
    displayName: output.name,
    outputId: output.id,
  }
}

export function dispatchKeyboardContextMenu(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "preventDefault" | "stopPropagation"
  >,
  element: HTMLElement
) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) {
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  const bounds = element.getBoundingClientRect()
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: bounds.left + Math.min(32, bounds.width / 2),
      clientY: bounds.top + bounds.height / 2,
    })
  )
  return true
}
