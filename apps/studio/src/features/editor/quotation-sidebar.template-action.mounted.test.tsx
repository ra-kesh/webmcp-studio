// @vitest-environment jsdom

import { act } from "react"
import type { ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { ResolvedTemplateAction } from "../../content/library/library-template-actions"
import { QuotationSidebar } from "./quotation-sidebar"

vi.mock("../../content/library/library-template-browser", () => ({
  LibraryTemplateBrowser: ({
    onApply,
    pendingAction,
  }: {
    onApply?: (intent: {
      itemKind: "template"
      id: string
      version: number
    }) => void
    pendingAction?: { action: string } | null
  }) => (
    <section aria-label="Shared editor template browser">
      <span data-testid="pending-action">
        {pendingAction?.action ?? "idle"}
      </span>
      <button
        type="button"
        onClick={() =>
          onApply?.({
            itemKind: "template",
            id: "bold-square-announcement",
            version: 1,
          })
        }
      >
        Request exact apply
      </button>
    </section>
  ),
}))

const impact = {
  pages: { before: 6, after: 1 },
  outputs: { before: 1, after: 1 },
  nodes: { before: 40, after: 8 },
  groups: { before: 4, after: 0 },
  components: { before: 2, after: 0 },
  componentInstances: { before: 3, after: 0 },
  fields: { before: 12, after: 2 },
  bindings: { before: 12, after: 2 },
  imageAssets: { before: 3, after: 0 },
  disconnectsQuotationSource: true,
  rebuildsFromQuotationSource: false,
} as const

const intent = {
  itemKind: "template" as const,
  id: "bold-square-announcement",
  version: 1,
}

const resolved = {
  action: "apply",
  intent,
  impact,
  detail: { summary: { name: "Bold Square Announcement" } },
} as unknown as ResolvedTemplateAction

const noOp = () => undefined

function props(
  overrides: Partial<ComponentProps<typeof QuotationSidebar>> = {}
): ComponentProps<typeof QuotationSidebar> {
  return {
    document: renderConformanceDocument,
    activePageId: renderConformanceDocument.pages[0].id,
    selection: null,
    activeTemplate: null,
    hasQuotationSource: true,
    reviewPending: false,
    activePanel: "templates",
    onActivePanelChange: noOp,
    onCreateFromTemplate: () => true,
    onResolveApplyTemplate: async () => resolved,
    onConfirmApplyTemplate: async () => true,
    onCancelTemplateAction: noOp,
    onSelectionChange: noOp,
    onFocusNode: noOp,
    onHoverNode: noOp,
    onRenameNode: noOp,
    onRenameGroup: noOp,
    onUpdateLayerNodes: noOp,
    onMoveLayer: () => true,
    onDeleteLayerNodes: () => true,
    canCreateComponentFromSelection: false,
    onCreateComponentFromSelection: noOp,
    onInsertComponent: noOp,
    onFocusComponentSource: noOp,
    assetWorkspaceView: "media",
    mediaBrowserVisible: false,
    mediaScope: { kind: "recent" },
    mediaActionsEnabled: true,
    onAssetWorkspaceViewChange: noOp,
    onMediaScopeChange: noOp,
    onMediaSelect: noOp,
    productCommandContext: {} as never,
    productCommandRuntime: {} as never,
    onSelectPage: noOp,
    onAddPage: noOp,
    onDuplicatePage: noOp,
    onUpdatePage: noOp,
    onRemovePage: noOp,
    onReorderPage: noOp,
    onAddOutput: noOp,
    onUpdateOutput: noOp,
    onRemoveOutput: noOp,
    ...overrides,
  }
}

function buttonNamed(name: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.includes(name)
  )
}

describe("QuotationSidebar exact template actions", () => {
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

  it("shows exact resolved impact before confirmation and invalidates cancel", async () => {
    const onResolveApplyTemplate = vi.fn(async () => resolved)
    const onConfirmApplyTemplate = vi.fn(async () => true)
    const onCancelTemplateAction = vi.fn()
    await act(async () => {
      root.render(
        <QuotationSidebar
          {...props({
            onResolveApplyTemplate,
            onConfirmApplyTemplate,
            onCancelTemplateAction,
          })}
        />
      )
    })

    await act(async () => buttonNamed("Request exact apply")?.click())
    expect(onResolveApplyTemplate).toHaveBeenCalledWith(intent)
    expect(onConfirmApplyTemplate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      "Apply Bold Square Announcement to this design?"
    )
    expect(document.body.textContent).toContain("6 → 1")
    expect(document.body.textContent).toContain("Will disconnect")

    await act(async () => buttonNamed("Keep current design")?.click())
    expect(onCancelTemplateAction).toHaveBeenCalledTimes(1)
    expect(onConfirmApplyTemplate).not.toHaveBeenCalled()

    await act(async () => buttonNamed("Request exact apply")?.click())
    await act(async () => buttonNamed("Apply template")?.click())
    expect(onConfirmApplyTemplate).toHaveBeenCalledTimes(1)
    expect(onConfirmApplyTemplate).toHaveBeenCalledWith(resolved)
  })

  it("confirms the exact quotation text unlock impact before applying it", async () => {
    const onTextEditabilityUpgrade = vi.fn()
    await act(async () => {
      root.render(
        <QuotationSidebar
          {...props({
            textEditabilityUpgradeLayerCount: 12,
            onTextEditabilityUpgrade,
          })}
        />
      )
    })

    expect(document.body.textContent).toContain(
      "Unlock 12 generated text layers"
    )
    await act(async () => buttonNamed("Enable editing")?.click())
    expect(onTextEditabilityUpgrade).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      "Enable direct quotation editing?"
    )
    const confirmation = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ]
      .filter((button) => button.textContent.includes("Enable editing"))
      .at(-1)
    await act(async () => confirmation?.click())
    expect(onTextEditabilityUpgrade).toHaveBeenCalledOnce()
  })

  it("keeps a zero-target composer-v3 identity update explicitly actionable", async () => {
    const onTextEditabilityUpgrade = vi.fn()
    await act(async () => {
      root.render(
        <QuotationSidebar
          {...props({
            textEditabilityUpgradeLayerCount: 0,
            onTextEditabilityUpgrade,
          })}
        />
      )
    })

    expect(document.body.textContent).toContain(
      "Generated quotation text is already editable"
    )
    await act(async () => buttonNamed("Complete update")?.click())
    expect(onTextEditabilityUpgrade).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      "Complete the quotation text update?"
    )
    expect(buttonNamed("Not now")).not.toBeNull()
    expect(buttonNamed("Keep text locked")).toBeUndefined()
    const confirmation = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ]
      .filter((button) => button.textContent.includes("Complete update"))
      .at(-1)
    await act(async () => confirmation?.click())
    expect(onTextEditabilityUpgrade).toHaveBeenCalledOnce()
  })
})
