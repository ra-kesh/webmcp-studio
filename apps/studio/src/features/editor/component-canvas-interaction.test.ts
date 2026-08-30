import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assertValidDocument,
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
} from "@webmcp/document"
import {
  projectCanvasComponentSelection,
  projectComponentInstanceCanvasTransform,
} from "./component-canvas-interaction"

function componentDocument(): Document {
  const document = structuredClone(northstarSeed)
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
    ],
  }
  const instance: ComponentInstance = {
    id: "component-cover-hero-instance",
    name: "Cover hero 1",
    componentId: component.id,
    variantId: component.defaultVariantId,
    rootGroupId: "component-cover-hero-instance-root",
    transform: { x: 80, y: 120, scale: 0.5, rotation: 0 },
    nodeMappings: ["cover-panel", "cover-eyebrow"].map((sourceNodeId) => ({
      sourceNodeId,
      instanceNodeId: `instance-${sourceNodeId}`,
    })),
    groupMappings: [
      {
        sourceGroupId: component.sourceGroupId,
        instanceGroupId: "component-cover-hero-instance-root",
      },
    ],
    overrides: {},
  }
  document.groups.push(
    {
      id: component.sourceGroupId,
      pageId: "cover",
      name: component.name,
      nodeIds: ["cover-panel", "cover-eyebrow"],
    },
    {
      id: instance.rootGroupId,
      pageId: "story",
      name: instance.name,
      nodeIds: instance.nodeMappings.map((mapping) => mapping.instanceNodeId),
    }
  )
  document.components = [component]
  document.componentInstances = [instance]
  const instanceNodes = resolveComponentInstanceNodes(document, instance)
  document.nodes.push(...instanceNodes)
  document.pages
    .find((page) => page.id === "story")
    ?.nodeIds.push(...instanceNodes.map((node) => node.id))
  return assertValidDocument(document)
}

describe("component canvas interaction", () => {
  it("keeps ordinary canvas clicks on the component root", () => {
    const document = componentDocument()
    const childSelection = {
      pageId: "story",
      nodeIds: ["instance-cover-eyebrow"],
    }
    const rootSelection = projectCanvasComponentSelection(
      document,
      childSelection
    )

    expect(rootSelection?.nodeIds).toEqual([
      "instance-cover-panel",
      "instance-cover-eyebrow",
    ])
    expect(projectCanvasComponentSelection(document, childSelection)).toEqual(
      rootSelection
    )
  })

  it("projects one uniform canvas transform back to instance metadata", () => {
    const document = componentDocument()
    const targetTransform = { x: 240, y: 320, scale: 0.75, rotation: 12 }
    const transformed = applyCommand(document, {
      id: "canvas-instance-transform",
      at: "2026-08-30T17:00:00.000Z",
      actor: "human",
      type: "update_component_instance_metadata",
      instanceId: "component-cover-hero-instance",
      patch: { transform: targetTransform },
    })
    const changes = document.componentInstances[0]!.nodeMappings.map(
      ({ instanceNodeId }) => {
        const node = transformed.nodes.find(
          (candidate) => candidate.id === instanceNodeId
        )!
        return {
          nodeId: instanceNodeId,
          patch: {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            rotation: node.rotation,
          },
        }
      }
    )

    expect(projectComponentInstanceCanvasTransform(document, changes)).toEqual({
      instanceId: "component-cover-hero-instance",
      transform: expect.objectContaining({
        x: expect.closeTo(targetTransform.x, 5),
        y: expect.closeTo(targetTransform.y, 5),
        scale: expect.closeTo(targetTransform.scale, 5),
        rotation: expect.closeTo(targetTransform.rotation, 5),
      }),
    })
  })

  it("does not misclassify an independent child resize as a root transform", () => {
    const document = componentDocument()
    const changes = document.componentInstances[0]!.nodeMappings.map(
      ({ instanceNodeId }, index) => {
        const node = document.nodes.find(
          (candidate) => candidate.id === instanceNodeId
        )!
        return {
          nodeId: instanceNodeId,
          patch: {
            x: node.x,
            y: node.y,
            width: node.width * (index ? 1.1 : 1.25),
            height: node.height,
            rotation: node.rotation,
          },
        }
      }
    )

    expect(
      projectComponentInstanceCanvasTransform(document, changes)
    ).toBeNull()
  })

  it("does not swallow a whole-instance non-geometry edit", () => {
    const document = componentDocument()
    const changes = document.componentInstances[0]!.nodeMappings.map(
      ({ instanceNodeId }) => ({
        nodeId: instanceNodeId,
        patch: { locked: false },
      })
    )

    expect(
      projectComponentInstanceCanvasTransform(document, changes)
    ).toBeNull()
  })
})
