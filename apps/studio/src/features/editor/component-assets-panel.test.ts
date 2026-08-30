import { describe, expect, it } from "vitest"
import { northstarSeed, type Document } from "@webmcp/document"
import { componentAssetItems } from "./component-assets-panel"

function componentDocument(): Document {
  const document = structuredClone(northstarSeed)
  document.groups.push({
    id: "component-source",
    pageId: "cover",
    name: "Cover hero",
    nodeIds: ["cover-panel", "cover-title"],
  })
  document.components.push({
    id: "component-cover-hero",
    name: "Cover hero",
    description: "Reusable cover treatment",
    sourceGroupId: "component-source",
    defaultVariantId: "component-cover-hero-default",
    variants: [
      {
        id: "component-cover-hero-default",
        name: "Default",
        overrides: {},
      },
      {
        id: "component-cover-hero-compact",
        name: "Compact",
        overrides: { "cover-title": { fontSize: 42 } },
      },
    ],
  })
  document.componentInstances.push({
    id: "component-cover-hero-instance",
    name: "Cover hero 1",
    componentId: "component-cover-hero",
    variantId: "component-cover-hero-default",
    rootGroupId: "component-cover-hero-instance-root",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    nodeMappings: [],
    groupMappings: [
      {
        sourceGroupId: "component-source",
        instanceGroupId: "component-cover-hero-instance-root",
      },
    ],
    overrides: {},
  })
  return document
}

describe("component Assets projection", () => {
  it("groups source identity, usage, variants, and a fitted live preview", () => {
    const [asset] = componentAssetItems(componentDocument())

    expect(asset).toMatchObject({
      pageId: "cover",
      pageName: "Cover",
      instanceCount: 1,
      component: {
        id: "component-cover-hero",
        name: "Cover hero",
      },
    })
    expect(asset?.component.variants).toHaveLength(2)
    expect(asset?.previewDocument?.nodes.map((node) => node.id)).toEqual([
      "cover-panel",
      "cover-title",
    ])
    expect(asset?.previewDocument?.pages[0]).toMatchObject({
      id: "component-preview-component-cover-hero",
      nodeIds: ["cover-panel", "cover-title"],
    })
    expect(asset?.previewScale).toBeGreaterThan(0)
  })
})
