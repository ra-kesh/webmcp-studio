import { describe, expect, it } from "vitest"
import {
  assertValidDocument,
  componentGraphCycles,
  componentIntegrityIssues,
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
  type SceneNode,
} from "../src"

function componentFixture(): Document {
  const document = structuredClone(northstarSeed)
  const sourceNodeIds = ["cover-panel", "cover-eyebrow"]
  const sourceNodes = document.nodes.filter((node) =>
    sourceNodeIds.includes(node.id)
  )
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
    overrides: {},
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
  expect(resolved).toHaveLength(sourceNodes.length)
  document.nodes.push(...resolved)
  document.pages
    .find((page) => page.id === "story")
    ?.nodeIds.push(...resolved.map((node) => node.id))
  return assertValidDocument(document)
}

describe("canonical document components", () => {
  it("resolves variant patches before instance overrides", () => {
    const document = componentFixture()
    const instance = document.componentInstances[0]!
    instance.variantId = "variant-compact"
    instance.overrides = {
      "cover-eyebrow": { color: "#ef4444", fontSize: 28 },
    }

    const resolved = resolveComponentInstanceNodes(document, instance)
    const title = resolved.find(
      (node): node is Extract<SceneNode, { type: "text" }> =>
        node.id === "instance-cover-eyebrow" && node.type === "text"
    )

    expect(title).toMatchObject({
      color: "#ef4444",
      fontSize: 28,
    })
    expect(title?.width).toBeGreaterThan(0)
    expect(title?.x).toBeGreaterThanOrEqual(instance.transform.x)
  })

  it("reports the exact stale materialized property", () => {
    const document = componentFixture()
    const title = document.nodes.find(
      (node) => node.id === "instance-cover-eyebrow"
    )
    if (!title || title.type !== "text")
      throw new Error("Missing title fixture")
    title.color = "#000000"

    expect(componentIntegrityIssues(document)).toContainEqual(
      expect.objectContaining({
        code: "component_instance_stale",
        instanceId: "instance-hero",
        nodeId: title.id,
        property: "color",
      })
    )
  })

  it("rejects variant targets outside the source subtree", () => {
    const document = componentFixture()
    document.components[0]!.variants[0]!.overrides = {
      "story-title": { opacity: 0.5 },
    }

    expect(() => assertValidDocument(document)).toThrow(
      "targets a layer outside Proposal hero"
    )
  })

  it("rejects an instance group hierarchy unrelated to its source mapping", () => {
    const document = componentFixture()
    const nestedInstanceGroup = document.groups.find(
      (group) => group.id === "group-instance-hero-details"
    )
    if (!nestedInstanceGroup) throw new Error("Missing nested instance group")
    delete nestedInstanceGroup.parentGroupId

    expect(() => assertValidDocument(document)).toThrow(
      "contains an invalid group hierarchy mapping"
    )
  })

  it("detects direct and transitive component cycles iteratively", () => {
    const document = structuredClone(northstarSeed)
    document.groups = [
      { id: "group-a", pageId: "cover", name: "A", nodeIds: [] },
      { id: "group-b", pageId: "story", name: "B", nodeIds: [] },
      {
        id: "instance-b-root",
        pageId: "cover",
        name: "B inside A",
        nodeIds: [],
        parentGroupId: "group-a",
      },
      {
        id: "instance-a-root",
        pageId: "story",
        name: "A inside B",
        nodeIds: [],
        parentGroupId: "group-b",
      },
    ]
    document.components = [
      {
        id: "component-a",
        name: "A",
        description: "",
        sourceGroupId: "group-a",
        defaultVariantId: "default-a",
        variants: [{ id: "default-a", name: "Default", overrides: {} }],
      },
      {
        id: "component-b",
        name: "B",
        description: "",
        sourceGroupId: "group-b",
        defaultVariantId: "default-b",
        variants: [{ id: "default-b", name: "Default", overrides: {} }],
      },
    ]
    document.componentInstances = [
      {
        id: "instance-b",
        name: "B inside A",
        componentId: "component-b",
        variantId: "default-b",
        rootGroupId: "instance-b-root",
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        nodeMappings: [],
        groupMappings: [
          { sourceGroupId: "group-b", instanceGroupId: "instance-b-root" },
        ],
        overrides: {},
      },
      {
        id: "instance-a",
        name: "A inside B",
        componentId: "component-a",
        variantId: "default-a",
        rootGroupId: "instance-a-root",
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        nodeMappings: [],
        groupMappings: [
          { sourceGroupId: "group-a", instanceGroupId: "instance-a-root" },
        ],
        overrides: {},
      },
    ]

    expect(componentGraphCycles(document)).toEqual([
      ["component-a", "component-b", "component-a"],
    ])
  })

  it("resolves 1,000 one-layer instances within a bounded model pass", () => {
    const document = componentFixture()
    const source = document.componentInstances[0]!
    const instances = Array.from({ length: 1_000 }, (_, index) => ({
      ...structuredClone(source),
      id: `instance-scale-${index}`,
      rootGroupId: `instance-scale-group-${index}`,
      transform: { x: index, y: index, scale: 1, rotation: 0 },
      nodeMappings: source.nodeMappings.map((mapping) => ({
        sourceNodeId: mapping.sourceNodeId,
        instanceNodeId: `${mapping.instanceNodeId}-${index}`,
      })),
      groupMappings: [
        {
          sourceGroupId: "group-component-hero",
          instanceGroupId: `instance-scale-group-${index}`,
        },
      ],
    }))

    const startedAt = performance.now()
    const resolvedCount = instances.reduce(
      (count, instance) =>
        count + resolveComponentInstanceNodes(document, instance).length,
      0
    )
    const duration = performance.now() - startedAt

    expect(resolvedCount).toBe(2_000)
    expect(duration).toBeLessThan(1_000)
  })
})
