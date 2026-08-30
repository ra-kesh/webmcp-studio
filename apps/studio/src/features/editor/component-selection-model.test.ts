import { describe, expect, it } from "vitest"
import {
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
} from "@webmcp/document"
import { projectComponentSelection } from "./component-selection-model"

function componentDocument(): Document {
  const document = structuredClone(northstarSeed)
  document.groups.push({
    id: "component-source",
    pageId: "cover",
    name: "Cover hero",
    nodeIds: ["cover-panel", "cover-title"],
  })
  const component: ComponentDefinition = {
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
  }
  const instance: ComponentInstance = {
    id: "component-cover-hero-instance",
    name: "Cover hero 1",
    componentId: component.id,
    variantId: component.defaultVariantId,
    rootGroupId: "component-cover-hero-instance-root",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    nodeMappings: ["cover-panel", "cover-title"].map((sourceNodeId) => ({
      sourceNodeId,
      instanceNodeId: `instance-${sourceNodeId}`,
    })),
    groupMappings: [
      {
        sourceGroupId: component.sourceGroupId,
        instanceGroupId: "component-cover-hero-instance-root",
      },
    ],
    overrides: {
      "cover-title": { text: "Instance title", fill: "#ee4422" },
    },
    removedProperties: {
      "cover-title": ["typographyStyleId"],
    },
  }
  document.components = [component]
  document.componentInstances = [instance]
  document.groups.push({
    id: instance.rootGroupId,
    pageId: "story",
    name: instance.name,
    nodeIds: instance.nodeMappings.map((mapping) => mapping.instanceNodeId),
  })
  const instanceNodes = resolveComponentInstanceNodes(document, instance)
  document.nodes.push(...instanceNodes)
  document.pages
    .find((page) => page.id === "story")
    ?.nodeIds.push(...instanceNodes.map((node) => node.id))
  return document
}

describe("component Inspector selection", () => {
  it("projects source identity and linked instance usage", () => {
    const document = componentDocument()
    const selectedNodes = document.nodes.filter((node) =>
      ["cover-panel", "cover-title"].includes(node.id)
    )

    expect(
      projectComponentSelection(document, selectedNodes, "component-source")
    ).toMatchObject({
      kind: "source",
      instanceCount: 1,
      selectedSourceNodeId: null,
      component: { id: "component-cover-hero" },
    })
  })

  it("projects an instance root and its aggregate overrides", () => {
    const document = componentDocument()
    const selectedNodes = document.nodes.filter((node) =>
      node.id.startsWith("instance-")
    )

    expect(
      projectComponentSelection(
        document,
        selectedNodes,
        "component-cover-hero-instance-root"
      )
    ).toMatchObject({
      kind: "instance",
      instance: { id: "component-cover-hero-instance" },
      selectedSourceNodeId: null,
      totalOverrideProperties: ["fill", "text", "typographyStyleId"],
    })
  })

  it("projects exact override properties for an instance child", () => {
    const document = componentDocument()
    const selectedNode = document.nodes.find(
      (node) => node.id === "instance-cover-title"
    )!

    expect(
      projectComponentSelection(document, [selectedNode], null)
    ).toMatchObject({
      kind: "instance",
      selectedSourceNodeId: "cover-title",
      selectedOverrideProperties: ["fill", "text", "typographyStyleId"],
    })
  })
})
