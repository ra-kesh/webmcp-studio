// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { PageOutputPanel } from "./page-output-panel"

vi.mock("@webmcp/render-view", () => ({
  Artboard: ({ pageId }: { pageId: string }) =>
    createElement("div", { "data-artboard-page-id": pageId }),
}))

const documentFixture = renderConformanceDocument
const output = documentFixture.outputs[0]
const activePageId = output.pageIds[0]

function productContext(): ProductCommandRuntimeContext {
  const pagesById = new Map(
    documentFixture.pages.map((page) => [page.id, page])
  )
  return {
    documentId: documentFixture.id,
    snapshotId: "snapshot-1",
    activePageId,
    activeOutputId: output.id,
    pageIds: documentFixture.pages.map((page) => page.id),
    outputIds: documentFixture.outputs.map((candidate) => candidate.id),
    pdfOutputIds: documentFixture.outputs
      .filter((candidate) => candidate.exportFormats.includes("pdf"))
      .map((candidate) => candidate.id),
    nodeIds: documentFixture.nodes.map((node) => node.id),
    groupIds: documentFixture.groups.map((group) => group.id),
    selection: null,
    activeTool: "select",
    editor: {
      reviewPending: false,
      hasSelection: false,
      selectedNodeCount: 0,
      hasSelectedGroup: false,
      hasClipboard: false,
      hasUndo: false,
      hasRedo: false,
      hasZoomSelection: false,
      canCropImage: false,
      canTransformImage: false,
      imageCropActive: false,
    },
    structureByTarget: Object.fromEntries([
      ...documentFixture.pages.map((page) => {
        const owner = documentFixture.outputs.find((candidate) =>
          candidate.pageIds.includes(page.id)
        )
        return [
          page.id,
          {
            reviewPending: false,
            outputCount: documentFixture.outputs.length,
            outputPageCount: owner?.pageIds.length ?? 0,
            pageIndex: owner?.pageIds.indexOf(page.id),
          },
        ] as const
      }),
      ...documentFixture.outputs.map(
        (candidate) =>
          [
            candidate.id,
            {
              reviewPending: false,
              outputCount: documentFixture.outputs.length,
              outputPageCount: candidate.pageIds.filter((pageId) =>
                pagesById.has(pageId)
              ).length,
            },
          ] as const
      ),
    ]),
  }
}

describe("PageOutputPanel product context menus", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = globalThis.document.createElement("div")
    globalThis.document.body.appendChild(host)
    root = createRoot(host)
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("opens the targeted output menu from Shift+F10 and dispatches its captured output", async () => {
    const run = vi.fn(() => ({ status: "accepted" as const }))
    await act(async () => {
      root.render(
        <PageOutputPanel
          activePageId={activePageId}
          document={documentFixture}
          productCommandContext={productContext()}
          productCommandRuntime={{ run, shortcut: () => null }}
          reviewPending={false}
          onAddOutput={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemoveOutput={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPage={vi.fn()}
          onSelectPage={vi.fn()}
          onUpdateOutput={vi.fn()}
          onUpdatePage={vi.fn()}
        />
      )
    })

    const trigger = host.querySelector<HTMLButtonElement>(
      `button[aria-label="More actions for ${output.name}"]`
    )
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "F10",
          shiftKey: true,
        })
      )
    })

    const rename = globalThis.document.body.querySelector<HTMLElement>(
      '[role="menuitem"][data-command-id="output.update"]'
    )
    expect(rename?.textContent).toContain("Rename output")
    await act(async () => rename?.click())
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "output.update",
        target: expect.objectContaining({
          kind: "output",
          outputId: output.id,
        }),
      })
    )
  })
})
