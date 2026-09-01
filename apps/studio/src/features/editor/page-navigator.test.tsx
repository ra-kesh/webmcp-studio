import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { PageNavigator } from "./page-navigator"

describe("PageNavigator", () => {
  it("renders a compact canonical-order navigator without page editors", () => {
    const document = quotationStarter.document
    const markup = renderToStaticMarkup(
      <PageNavigator
        document={document}
        activePageId={document.pages[2].id}
        onSelectPage={vi.fn()}
        onAddPage={vi.fn()}
      />
    )

    expect(markup).toContain('data-page-navigator="true"')
    expect(markup.match(/role="option"/g)).toHaveLength(document.pages.length)
    expect(markup).toContain('aria-selected="true"')
    expect(markup).not.toContain("canvas")
    expect(markup).not.toContain("More actions")
  })
})
