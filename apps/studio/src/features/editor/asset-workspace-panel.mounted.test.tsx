// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { LibraryMediaScope } from "../../content/library/library-media-browser"
import { AssetWorkspacePanel } from "./asset-workspace-panel"

vi.mock("../../content/library/library-media-browser", () => ({
  LibraryMediaBrowser: ({
    visible,
    scope,
    actionsEnabled,
    onScopeChange,
  }: {
    visible: boolean
    scope: LibraryMediaScope
    actionsEnabled: boolean
    onScopeChange: (scope: LibraryMediaScope) => void
  }) =>
    visible ? (
      <section aria-label="Shared media browser">
        <span data-testid="media-scope">{scope.kind}</span>
        <span data-testid="media-actions">
          {actionsEnabled ? "enabled" : "disabled"}
        </span>
        <button
          type="button"
          onClick={() => onScopeChange({ kind: "library" })}
        >
          Browse Studio library
        </button>
      </section>
    ) : null,
}))

vi.mock("./component-assets-panel", () => ({
  ComponentAssetsPanel: ({
    onInsert,
  }: {
    onInsert: (componentId: string) => void
  }) => (
    <section aria-label="Components">
      <button type="button" onClick={() => onInsert("component-card")}>
        Insert component
      </button>
    </section>
  ),
}))

function panel({
  view,
  scope,
  onScopeChange,
  onInsert,
}: {
  view: "media" | "components"
  scope: LibraryMediaScope
  onScopeChange: (scope: LibraryMediaScope) => void
  onInsert: (componentId: string) => void
}) {
  return (
    <AssetWorkspacePanel
      document={renderConformanceDocument}
      activeView={view}
      mediaBrowserVisible
      mediaScope={scope}
      mediaActionsEnabled
      canCreateComponentFromSelection={false}
      reviewPending={false}
      onActiveViewChange={() => undefined}
      onMediaScopeChange={onScopeChange}
      onMediaSelect={() => undefined}
      onCreateComponentFromSelection={() => undefined}
      onInsertComponent={onInsert}
      onFocusComponentSource={() => undefined}
    />
  )
}

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.includes(name)
  )

describe("AssetWorkspacePanel", () => {
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

  it("keeps media scope without exposing the deferred Components workspace", async () => {
    const onInsert = vi.fn()
    let scope: LibraryMediaScope = { kind: "recent" }
    const onScopeChange = vi.fn((next: LibraryMediaScope) => {
      scope = next
    })
    const renderView = async (view: "media" | "components") => {
      await act(async () =>
        root.render(panel({ view, scope, onScopeChange, onInsert }))
      )
    }

    await renderView("media")

    expect(document.body.textContent).toContain("recent")
    await act(async () => buttonNamed("Browse Studio library")?.click())
    await renderView("media")
    expect(document.body.textContent).toContain("library")

    await renderView("components")
    expect(document.body.textContent).toContain("library")
    expect(document.body.textContent).toContain("enabled")
    expect(buttonNamed("Insert component")).toBeUndefined()
    expect(onInsert).not.toHaveBeenCalled()
  })
})
