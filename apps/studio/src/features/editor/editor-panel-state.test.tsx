import { renderToStaticMarkup } from "react-dom/server"
import { AlertTriangle } from "lucide-react"
import { describe, expect, it } from "vitest"

import { EditorPanelState } from "@webmcp/ui/components/editor-chrome"

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
