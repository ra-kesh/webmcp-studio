import { describe, expect, it } from "vitest"
import {
  createTemplateVersion,
  documentSchema,
  projectNodeForRender,
  textDesignSystemConformanceDocument,
} from "../src"

describe("text design-system publication conformance", () => {
  it("publishes the exact changed resources, bindings, and resolved render values", () => {
    const source = structuredClone(textDesignSystemConformanceDocument)
    const published = createTemplateVersion(source, {
      id: "text-design-system-conformance-v1",
      templateId: "text-design-system-conformance",
      version: 1,
      sourceSnapshotId: `sha256-${"b".repeat(64)}`,
      publishedAt: "2026-08-30T16:00:00.000Z",
    })
    const document = documentSchema.parse(
      JSON.parse(JSON.stringify(published.document))
    )

    expect(document.typographyStyles).toEqual(
      textDesignSystemConformanceDocument.typographyStyles
    )
    expect(document.paintStyles).toEqual(
      textDesignSystemConformanceDocument.paintStyles
    )
    expect(document.variables).toEqual(
      textDesignSystemConformanceDocument.variables
    )
    expect(document.variableBindings).toEqual(
      textDesignSystemConformanceDocument.variableBindings
    )

    const panel = document.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const label = document.nodes.find(
      (node) => node.id === "auto-width-label"
    )!
    const body = document.nodes.find((node) => node.id === "long-text-only")!
    const mixedText = document.nodes.find(
      (node) => node.id === "text-typography"
    )!

    expect(projectNodeForRender(panel)).toMatchObject({
      frame: { opacity: 0.63 },
      content: { fill: "#0f766e", radius: 32 },
    })
    expect(projectNodeForRender(label)).toMatchObject({
      content: { text: "UPDATED LABEL" },
    })
    expect(projectNodeForRender(body)).toMatchObject({
      content: {
        fontFamily: "Geist Variable",
        fontSize: 22,
        fontWeight: 510,
        lineHeight: 1.25,
        letterSpacing: 1.3,
        layout: {
          lines: expect.arrayContaining([
            expect.objectContaining({
              segments: expect.arrayContaining([
                expect.objectContaining({
                  style: expect.objectContaining({
                    italic: true,
                    decoration: "underline",
                  }),
                }),
              ]),
            }),
          ]),
        },
      },
    })
    expect(projectNodeForRender(mixedText)).toMatchObject({
      content: {
        layout: {
          lines: expect.arrayContaining([
            expect.objectContaining({
              segments: expect.arrayContaining([
                expect.objectContaining({
                  sourceStart: 18,
                  sourceEnd: 30,
                  style: expect.objectContaining({ color: "#0e7490" }),
                }),
              ]),
            }),
          ]),
        },
      },
    })

    source.typographyStyles.length = 0
    source.paintStyles.length = 0
    source.variables.length = 0
    source.variableBindings.length = 0
    expect(published.document.typographyStyles).toHaveLength(1)
    expect(published.document.paintStyles).toHaveLength(1)
    expect(published.document.variables).toHaveLength(5)
    expect(published.document.variableBindings).toHaveLength(5)
  })
})
