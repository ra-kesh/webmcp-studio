import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assertValidDocument,
  captureSemanticFragment,
  cloneSemanticFragment,
  componentGraphCycles,
  componentIntegrityIssues,
  northstarSeed,
  resolveComponentInstanceNodes,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
  type SceneNode,
} from "../src"

const commandMeta = (id: string) => ({
  id,
  at: "2026-08-30T16:00:00.000Z",
  actor: "human" as const,
})

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

function componentSourceFixture(): Document {
  const document = componentFixture()
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

  it("creates a fully materialized instance from canonical source mappings", () => {
    const document = componentSourceFixture()
    const next = applyCommand(document, {
      ...commandMeta("create-instance"),
      type: "create_component_instance",
      pageId: "story",
      instance: {
        id: "instance-created",
        name: "Created hero",
        componentId: "component-hero",
        variantId: "variant-default",
        rootGroupId: "group-created-hero",
        transform: { x: 100, y: 200, scale: 0.5, rotation: 0 },
        nodeMappings: [
          {
            sourceNodeId: "cover-panel",
            instanceNodeId: "created-cover-panel",
          },
          {
            sourceNodeId: "cover-eyebrow",
            instanceNodeId: "created-cover-eyebrow",
          },
        ],
        groupMappings: [
          {
            sourceGroupId: "group-component-hero",
            instanceGroupId: "group-created-hero",
          },
          {
            sourceGroupId: "group-component-hero-details",
            instanceGroupId: "group-created-hero-details",
          },
        ],
        overrides: {},
      },
    })

    expect(next.componentInstances).toHaveLength(1)
    expect(
      next.nodes.find((node) => node.id === "created-cover-eyebrow")
    ).toMatchObject({ type: "text", fontSize: 9.5 })
    expect(
      next.groups.find((group) => group.id === "group-created-hero-details")
    ).toMatchObject({
      parentGroupId: "group-created-hero",
      nodeIds: ["created-cover-eyebrow"],
    })
    expect(next.revision).toBe(document.revision + 1)
  })

  it("propagates source edits while preserving, resetting and detaching overrides", () => {
    let document = componentFixture()
    document = applyCommand(document, {
      ...commandMeta("source-green"),
      type: "update_node",
      nodeId: "cover-eyebrow",
      patch: { color: "#16a34a" },
    })
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ color: "#16a34a" })

    document = applyCommand(document, {
      ...commandMeta("instance-red"),
      type: "update_node",
      nodeId: "instance-cover-eyebrow",
      patch: { color: "#dc2626" },
    })
    expect(document.componentInstances[0]?.overrides["cover-eyebrow"]).toEqual(
      expect.objectContaining({ color: "#dc2626" })
    )

    document = applyCommand(document, {
      ...commandMeta("source-blue"),
      type: "update_node",
      nodeId: "cover-eyebrow",
      patch: { color: "#2563eb" },
    })
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ color: "#dc2626" })

    document = applyCommand(document, {
      ...commandMeta("reset-color"),
      type: "reset_component_override",
      instanceId: "instance-hero",
      sourceNodeId: "cover-eyebrow",
      properties: ["color"],
    })
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ color: "#2563eb" })

    document = applyCommand(document, {
      ...commandMeta("detach-instance"),
      type: "detach_component_instance",
      instanceId: "instance-hero",
    })
    const detachedNode = document.nodes.find(
      (node) => node.id === "instance-cover-eyebrow"
    )
    if (!detachedNode || detachedNode.type !== "text") {
      throw new Error("Missing detached text layer")
    }
    const detachedColor = detachedNode.color
    document = applyCommand(document, {
      ...commandMeta("source-after-detach"),
      type: "update_node",
      nodeId: "cover-eyebrow",
      patch: { color: "#9333ea" },
    })
    expect(document.componentInstances).toHaveLength(0)
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ color: detachedColor })
  })

  it("switches variants and updates every materialized visual metric", () => {
    const document = applyCommand(componentFixture(), {
      ...commandMeta("switch-variant"),
      type: "switch_component_variant",
      instanceId: "instance-hero",
      variantId: "variant-compact",
    })
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ fontSize: 12, height: 24 })
  })

  it("creates, updates, replaces and resets component variant state", () => {
    let document = applyCommand(componentFixture(), {
      ...commandMeta("create-variant"),
      type: "create_component_variant",
      componentId: "component-hero",
      variant: {
        id: "variant-brand",
        name: "Brand",
        overrides: { "cover-eyebrow": { color: "#7c3aed" } },
      },
    })
    document = applyCommand(document, {
      ...commandMeta("update-variant"),
      type: "update_component_variant",
      componentId: "component-hero",
      variantId: "variant-brand",
      patch: {
        name: "Brand violet",
        overrides: { "cover-eyebrow": { color: "#6d28d9" } },
      },
    })
    document = applyCommand(document, {
      ...commandMeta("switch-brand"),
      type: "switch_component_variant",
      instanceId: "instance-hero",
      variantId: "variant-brand",
    })
    document = applyCommand(document, {
      ...commandMeta("override-opacity"),
      type: "update_component_instance",
      instanceId: "instance-hero",
      sourceNodeId: "cover-eyebrow",
      patch: { opacity: 0.6 },
    })
    expect(
      document.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).toMatchObject({ color: "#6d28d9", opacity: 0.6 })

    document = applyCommand(document, {
      ...commandMeta("reset-all-overrides"),
      type: "reset_all_component_overrides",
      instanceId: "instance-hero",
    })
    expect(document.componentInstances[0]?.overrides).toEqual({})

    document = applyCommand(document, {
      ...commandMeta("replace-brand"),
      type: "delete_component_variant",
      componentId: "component-hero",
      variantId: "variant-brand",
      replacementVariantId: "variant-default",
    })
    expect(document.componentInstances[0]?.variantId).toBe("variant-default")
    expect(document.components[0]?.variants).toHaveLength(2)
  })

  it("repairs explicitly stale materialized instances through one command", () => {
    const document = componentFixture()
    const stale = document.nodes.find(
      (node) => node.id === "instance-cover-eyebrow"
    )
    if (!stale || stale.type !== "text")
      throw new Error("Missing text instance")
    stale.color = "#ff0000"

    const repaired = applyCommand(document, {
      ...commandMeta("synchronize-instances"),
      type: "synchronize_component_instances",
    })
    expect(
      repaired.nodes.find((node) => node.id === "instance-cover-eyebrow")
    ).not.toMatchObject({ color: "#ff0000" })
  })

  it("requires an explicit detach policy before deleting a used component", () => {
    const document = componentFixture()
    expect(() =>
      applyCommand(document, {
        ...commandMeta("delete-rejected"),
        type: "delete_component",
        componentId: "component-hero",
        dependentPolicy: "reject",
      })
    ).toThrow("still has 1 instance")

    const detached = applyCommand(document, {
      ...commandMeta("delete-detach"),
      type: "delete_component",
      componentId: "component-hero",
      dependentPolicy: "detach",
    })
    expect(detached.components).toHaveLength(0)
    expect(detached.componentInstances).toHaveLength(0)
    expect(
      detached.nodes.some((node) => node.id === "instance-cover-eyebrow")
    ).toBe(true)
  })

  it("retains complete instance links during semantic clone and detaches partial copies", () => {
    let document = componentFixture()
    const complete = captureSemanticFragment(document, "story", [
      "instance-cover-panel",
      "instance-cover-eyebrow",
    ])
    const clone = cloneSemanticFragment(complete, {
      targetPageId: "story",
      offsetX: 24,
      offsetY: 24,
      createId: (kind, sourceId) => `${kind}-clone-${sourceId}`,
    })
    expect(clone.componentInstances).toHaveLength(1)
    document = applyCommand(document, {
      ...commandMeta("clone-instance"),
      type: "duplicate_nodes",
      pageId: "story",
      nodes: clone.nodes,
      groups: clone.groups,
      componentInstances: clone.componentInstances,
      bindings: clone.bindings,
      variableBindings: clone.variableBindings,
    })
    expect(document.componentInstances).toHaveLength(2)

    document = applyCommand(document, {
      ...commandMeta("source-clone-propagation"),
      type: "update_node",
      nodeId: "cover-eyebrow",
      patch: { color: "#0f766e" },
    })
    expect(
      document.nodes.filter(
        (node) =>
          node.type === "text" &&
          node.id !== "cover-eyebrow" &&
          node.color === "#0f766e"
      )
    ).toHaveLength(2)

    const partial = captureSemanticFragment(document, "story", [
      "instance-cover-eyebrow",
    ])
    expect(partial.componentInstances).toHaveLength(0)
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
