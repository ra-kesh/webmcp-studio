import { applyCommand } from "./commands"
import { createTemplateVersion } from "./publishing"
import { northstarSeed } from "./seed"
import type { Document, DocumentCommand, TemplateVersion } from "./schema"
import { assertValidDocument } from "./validation"

type CommandInput = DocumentCommand extends infer Candidate
  ? Candidate extends DocumentCommand
    ? Omit<Candidate, "id" | "actor" | "at">
    : never
  : never

export type ComponentPublicationJourney = {
  source: Document
  componentCreated: Document
  instanceCreated: Document
  overridden: Document
  variantSwitched: Document
  sourceUpdated: Document
  overrideReset: Document
  detached: Document
  published: TemplateVersion
}

const command = (value: CommandInput, index: number): DocumentCommand =>
  ({
    id: `component-journey-${index}`,
    actor: "human",
    at: `2026-08-30T18:${String(index).padStart(2, "0")}:00.000Z`,
    ...value,
  }) as DocumentCommand

function createSourceDocument(): Document {
  const document = structuredClone(northstarSeed)
  document.groups.push(
    {
      id: "journey-component-source",
      pageId: "cover",
      name: "Proposal hero",
      nodeIds: ["cover-panel"],
      role: "organize",
    },
    {
      id: "journey-component-source-details",
      pageId: "cover",
      name: "Proposal hero details",
      nodeIds: ["cover-eyebrow"],
      parentGroupId: "journey-component-source",
      role: "organize",
    }
  )
  return assertValidDocument(document)
}

export function buildComponentPublicationJourney(): ComponentPublicationJourney {
  const source = createSourceDocument()
  const componentCreated = applyCommand(
    source,
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

  const instanceCreated = applyCommand(
    componentCreated,
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

  const overridden = applyCommand(
    instanceCreated,
    command(
      {
        type: "update_node",
        nodeId: "journey-instance-eyebrow",
        patch: { color: "#dc2626" },
      },
      3
    )
  )

  const variantSwitched = applyCommand(
    overridden,
    command(
      {
        type: "switch_component_variant",
        instanceId: "journey-instance",
        variantId: "journey-component-compact",
      },
      4
    )
  )

  const sourceUpdated = applyCommand(
    variantSwitched,
    command(
      {
        type: "update_node",
        nodeId: "cover-eyebrow",
        patch: { text: "Updated reusable proposal" },
      },
      5
    )
  )

  const overrideReset = applyCommand(
    sourceUpdated,
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

  const detached = applyCommand(
    overrideReset,
    command(
      {
        type: "detach_component_instance",
        instanceId: "journey-instance",
      },
      7
    )
  )

  const published = createTemplateVersion(assertValidDocument(detached), {
    id: "component-journey-version",
    templateId: "component-journey-template",
    version: 1,
    sourceSnapshotId: `sha256-${"c".repeat(64)}`,
    publishedAt: "2026-08-30T19:00:00.000Z",
  })

  return {
    source,
    componentCreated,
    instanceCreated,
    overridden,
    variantSwitched,
    sourceUpdated,
    overrideReset,
    detached,
    published,
  }
}
