import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assertValidDocument,
  createTemplateVersion,
  northstarSeed,
  type Document,
  type DocumentCommand,
} from "../src"

type CommandInput = DocumentCommand extends infer Candidate
  ? Candidate extends DocumentCommand
    ? Omit<Candidate, "id" | "actor" | "at">
    : never
  : never

const command = (value: CommandInput, index: number): DocumentCommand =>
  ({
    id: `component-journey-${index}`,
    actor: "human",
    at: `2026-08-30T18:${String(index).padStart(2, "0")}:00.000Z`,
    ...value,
  }) as DocumentCommand

function sourceDocument(): Document {
  const document = structuredClone(northstarSeed)
  document.groups.push(
    {
      id: "journey-component-source",
      pageId: "cover",
      name: "Proposal hero",
      nodeIds: ["cover-panel"],
    },
    {
      id: "journey-component-source-details",
      pageId: "cover",
      name: "Proposal hero details",
      nodeIds: ["cover-eyebrow"],
      parentGroupId: "journey-component-source",
    }
  )
  return assertValidDocument(document)
}

describe("component create-to-publication journey", () => {
  it("keeps canonical instance semantics through override, variant, propagation, reset, detach, and publication", () => {
    let document = applyCommand(
      sourceDocument(),
      command(
        {
          type: "create_component",
          component: {
            id: "journey-component",
            name: "Proposal hero",
            description: "Reusable proposal identity",
            sourceGroupId: "journey-component-source",
            defaultVariantId: "journey-component-default",
            variants: [
              {
                id: "journey-component-default",
                name: "Default",
                overrides: {},
              },
              {
                id: "journey-component-compact",
                name: "Compact",
                overrides: {
                  "cover-eyebrow": { fontSize: 24, height: 48 },
                },
              },
            ],
          },
        },
        1
      )
    )

    document = applyCommand(
      document,
      command(
        {
          type: "create_component_instance",
          pageId: "story",
          instance: {
            id: "journey-instance",
            name: "Proposal hero 1",
            componentId: "journey-component",
            variantId: "journey-component-default",
            rootGroupId: "journey-instance-root",
            transform: { x: 80, y: 120, scale: 0.5, rotation: 0 },
            nodeMappings: [
              {
                sourceNodeId: "cover-panel",
                instanceNodeId: "journey-instance-panel",
              },
              {
                sourceNodeId: "cover-eyebrow",
                instanceNodeId: "journey-instance-eyebrow",
              },
            ],
            groupMappings: [
              {
                sourceGroupId: "journey-component-source",
                instanceGroupId: "journey-instance-root",
              },
              {
                sourceGroupId: "journey-component-source-details",
                instanceGroupId: "journey-instance-details",
              },
            ],
            overrides: {},
          },
        },
        2
      )
    )
    expect(document.componentInstances).toHaveLength(1)

    document = applyCommand(
      document,
      command(
        {
          type: "update_node",
          nodeId: "journey-instance-eyebrow",
          patch: { color: "#dc2626" },
        },
        3
      )
    )
    expect(
      document.componentInstances[0]?.overrides["cover-eyebrow"]
    ).toMatchObject({ color: "#dc2626" })

    document = applyCommand(
      document,
      command(
        {
          type: "switch_component_variant",
          instanceId: "journey-instance",
          variantId: "journey-component-compact",
        },
        4
      )
    )
    expect(
      document.nodes.find((node) => node.id === "journey-instance-eyebrow")
    ).toMatchObject({ color: "#dc2626", fontSize: 12, height: 24 })

    document = applyCommand(
      document,
      command(
        {
          type: "update_node",
          nodeId: "cover-eyebrow",
          patch: { text: "Updated reusable proposal" },
        },
        5
      )
    )
    expect(
      document.nodes.find((node) => node.id === "journey-instance-eyebrow")
    ).toMatchObject({
      text: "Updated reusable proposal",
      color: "#dc2626",
    })

    document = applyCommand(
      document,
      command(
        {
          type: "reset_component_override",
          instanceId: "journey-instance",
          sourceNodeId: "cover-eyebrow",
          properties: ["color"],
        },
        6
      )
    )
    expect(
      Object.keys(
        document.componentInstances[0]?.overrides["cover-eyebrow"] ?? {}
      )
    ).not.toContain("color")

    document = applyCommand(
      document,
      command(
        {
          type: "detach_component_instance",
          instanceId: "journey-instance",
        },
        7
      )
    )
    expect(document.componentInstances).toHaveLength(0)
    expect(
      document.nodes.find((node) => node.id === "journey-instance-eyebrow")
    ).toMatchObject({
      text: "Updated reusable proposal",
      fontSize: 12,
      height: 24,
    })

    const published = createTemplateVersion(assertValidDocument(document), {
      id: "component-journey-version",
      templateId: "component-journey-template",
      version: 1,
      sourceSnapshotId: `sha256-${"c".repeat(64)}`,
      publishedAt: "2026-08-30T19:00:00.000Z",
    })
    expect(published.document.componentInstances).toHaveLength(0)
    expect(published.document.components).toHaveLength(1)
    expect(
      published.document.nodes.find(
        (node) => node.id === "journey-instance-eyebrow"
      )
    ).toMatchObject({ text: "Updated reusable proposal" })
  })
})
