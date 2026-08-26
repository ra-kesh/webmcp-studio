import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import { renderDocumentToHtml } from "../src/html"

describe("renderer HTML", () => {
  it("renders canonical nodes without a Fabric dependency", () => {
    const html = renderDocumentToHtml(northstarSeed, "cover")
    expect(html).toContain('data-node-id="cover-title"')
    expect(html).toContain("Aditi &amp; Kabir")
    expect(html).toContain("width:1240px")
  })
})
