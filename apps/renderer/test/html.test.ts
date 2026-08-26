import { describe, expect, it } from "vitest"
import { applyCommand, northstarSeed, type SceneNode } from "@webmcp/document"
import { renderDocumentToHtml } from "../src/html"

describe("renderer HTML", () => {
  it("renders canonical nodes without a Fabric dependency", () => {
    const html = renderDocumentToHtml(northstarSeed, "cover")
    expect(html).toContain('data-node-id="cover-title"')
    expect(html).toContain("Aditi &amp; Kabir")
    expect(html).toContain("width:1240px")
  })

  it("keeps shape markup and rotation origin consistent with the editor", () => {
    const nodes: SceneNode[] = [
      {
        id: "test-ellipse",
        type: "ellipse",
        name: "Ellipse",
        x: 40,
        y: 50,
        width: 200,
        height: 160,
        rotation: 12,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#d9c9b2",
        stroke: "#1e2622",
        strokeWidth: 3,
      },
      {
        id: "test-line",
        type: "line",
        name: "Line",
        x: 60,
        y: 80,
        width: 320,
        height: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        stroke: "#1e2622",
        strokeWidth: 4,
      },
      {
        id: "test-icon",
        type: "icon",
        name: "Heart",
        x: 100,
        y: 120,
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        path: "M12 21 3 12 12 3 21 12Z",
        viewBox: "0 0 24 24",
        fill: "#8a5d38",
        strokeWidth: 0,
      },
    ]
    const document = nodes.reduce(
      (current, node, index) =>
        applyCommand(current, {
          id: `cmd-render-primitive-${index}`,
          type: "add_node",
          actor: "human",
          at: "2026-08-26T09:30:00.000Z",
          pageId: "cover",
          node,
        }),
      northstarSeed
    )

    const html = renderDocumentToHtml(document, "cover")
    expect(html).toContain('data-node-id="test-ellipse"')
    expect(html).toContain("border-radius:50%")
    expect(html).toContain('data-node-id="test-line"')
    expect(html).toContain('stroke-width="4"')
    expect(html).toContain('data-node-id="test-icon"')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain("transform-origin:top left")
  })
})
