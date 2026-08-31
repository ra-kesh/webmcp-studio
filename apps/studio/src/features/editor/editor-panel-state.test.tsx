import { renderToStaticMarkup } from "react-dom/server"
import { AlertTriangle } from "lucide-react"
import { describe, expect, it } from "vitest"

import {
  EditorPanelNotice,
  EditorPanelState,
} from "@webmcp/ui/components/editor-chrome"

describe("EditorPanelState", () => {
  it("gives editor empty and recovery states one compact hierarchy", () => {
    const markup = renderToStaticMarkup(
      <EditorPanelState
        description="The catalog service is unavailable."
        icon={<AlertTriangle />}
        role="alert"
        title="Templates could not be loaded"
        tone="error"
      >
        <button type="button">Try again</button>
      </EditorPanelState>
    )

    expect(markup).toContain('data-slot="editor-panel-state"')
    expect(markup).toContain('data-tone="error"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Templates could not be loaded")
    expect(markup).toContain("The catalog service is unavailable.")
    expect(markup).toContain("Try again")
  })
})

describe("EditorPanelNotice", () => {
  it("keeps inline status, explanation and recovery actions in one recipe", () => {
    const markup = renderToStaticMarkup(
      <EditorPanelNotice
        description="Unlock the selection before changing its layer order."
        icon={<AlertTriangle />}
        role="status"
        title="Two layers are locked"
        tone="warning"
      >
        <button type="button">Unlock layers</button>
      </EditorPanelNotice>
    )

    expect(markup).toContain('data-slot="editor-panel-notice"')
    expect(markup).toContain('data-tone="warning"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-slot="editor-panel-notice-icon"')
    expect(markup).toContain("Two layers are locked")
    expect(markup).toContain("Unlock layers")
  })
})
