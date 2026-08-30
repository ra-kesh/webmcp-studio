import {
  assertValidDocument,
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
} from "@webmcp/document"

export function componentDocumentFixture(): Document {
  const document = structuredClone(northstarSeed)
  const sourceNodeIds = ["cover-panel", "cover-eyebrow"]
  const component: ComponentDefinition = {
    id: "component-hero",
    name: "Proposal hero",
    description: "Reusable title and panel treatment",
    sourceGroupId: "group-component-hero",
    defaultVariantId: "variant-default",
    variants: [
      { id: "variant-default", name: "Default", overrides: {} },
      {
        id: "variant-compact",
        name: "Compact",
        overrides: {
          "cover-eyebrow": { fontSize: 24, height: 48 },
        },
      },
    ],
  }
  const instance: ComponentInstance = {
    id: "instance-hero",
    name: "Proposal hero instance",
    componentId: component.id,
    variantId: component.defaultVariantId,
    rootGroupId: "group-instance-hero",
    transform: { x: 80, y: 120, scale: 0.5, rotation: 0 },
    nodeMappings: sourceNodeIds.map((sourceNodeId) => ({
      sourceNodeId,
      instanceNodeId: `instance-${sourceNodeId}`,
    })),
    groupMappings: [
      {
        sourceGroupId: component.sourceGroupId,
        instanceGroupId: "group-instance-hero",
      },
      {
        sourceGroupId: "group-component-hero-details",
        instanceGroupId: "group-instance-hero-details",
      },
    ],
    overrides: {
      "cover-eyebrow": { text: "Private instance value" },
    },
  }

  document.groups.push(
    {
      id: component.sourceGroupId,
      pageId: "cover",
      name: component.name,
      nodeIds: ["cover-panel"],
    },
    {
      id: "group-component-hero-details",
      pageId: "cover",
      name: "Hero details",
      nodeIds: ["cover-eyebrow"],
      parentGroupId: component.sourceGroupId,
    },
    {
      id: instance.rootGroupId,
      pageId: "story",
      name: instance.name,
      nodeIds: ["instance-cover-panel"],
    },
    {
      id: "group-instance-hero-details",
      pageId: "story",
      name: "Hero details",
      nodeIds: ["instance-cover-eyebrow"],
      parentGroupId: instance.rootGroupId,
    }
  )
  document.components = [component]
  document.componentInstances = [instance]
  const resolved = resolveComponentInstanceNodes(document, instance)
  document.nodes.push(...resolved)
  document.pages
    .find((page) => page.id === "story")
    ?.nodeIds.push(...resolved.map((node) => node.id))
  return assertValidDocument(document)
}

export function componentSourceDocumentFixture(): Document {
  const document = componentDocumentFixture()
  const instance = document.componentInstances[0]!
  const instanceNodeIds = new Set(
    instance.nodeMappings.map((mapping) => mapping.instanceNodeId)
  )
  const instanceGroupIds = new Set(
    instance.groupMappings.map((mapping) => mapping.instanceGroupId)
  )
  document.nodes = document.nodes.filter(
    (node) => !instanceNodeIds.has(node.id)
  )
  document.pages = document.pages.map((page) => ({
    ...page,
    nodeIds: page.nodeIds.filter((nodeId) => !instanceNodeIds.has(nodeId)),
  }))
  document.groups = document.groups.filter(
    (group) => !instanceGroupIds.has(group.id)
  )
  document.componentInstances = []
  return assertValidDocument(document)
}
