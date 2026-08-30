import { z } from "zod"
import {
  changeSetSchema,
  decideAllChangeOperations,
  decideChangeOperation,
} from "@webmcp/document"
import type {
  ChangeOperation,
  ChangeSet,
  Document,
  DocumentCommand,
} from "@webmcp/document"

export const MAX_REVIEW_RESOLVED_ENTRIES = 50
export const MAX_REVIEW_AFFECTED_TARGETS = 100

const nullableShortText = z.string().trim().min(1).max(1_000).nullable()

export const reviewProposalProvenanceSchema = z
  .object({
    source: z.enum(["studio", "webmcp"]),
    actorLabel: z.string().trim().min(1).max(120),
    toolName: z.string().trim().min(1).max(120).nullable(),
    reason: nullableShortText,
    requestId: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()

export type ReviewProposalProvenance = z.infer<
  typeof reviewProposalProvenanceSchema
>

export const reviewAffectedTargetSchema = z
  .object({
    kind: z.enum([
      "page",
      "node",
      "group",
      "field",
      "output",
      "component",
      "component_instance",
    ]),
    id: z.string().min(1),
    label: z.string().trim().min(1).max(240),
    pageId: z.string().min(1).nullable(),
  })
  .strict()

export type ReviewAffectedTarget = z.infer<typeof reviewAffectedTargetSchema>

const pendingReviewEntrySchema = z
  .object({
    changeSet: changeSetSchema,
    provenance: reviewProposalProvenanceSchema,
    affected: z
      .array(reviewAffectedTargetSchema)
      .max(MAX_REVIEW_AFFECTED_TARGETS),
  })
  .strict()

export type PendingReviewEntry = z.infer<typeof pendingReviewEntrySchema>

const reviewResolutionSchema = z
  .object({
    status: z.enum(["applied", "discarded"]),
    resolvedAt: z.string().datetime(),
    resultRevision: z.number().int().nonnegative(),
    resultSnapshotId: z.string().min(1),
    acceptedOperationIds: z.array(z.string().min(1)),
    rejectedOperationIds: z.array(z.string().min(1)),
  })
  .strict()

export type ReviewResolution = z.infer<typeof reviewResolutionSchema>

const resolvedReviewEntrySchema = pendingReviewEntrySchema
  .extend({ resolution: reviewResolutionSchema })
  .strict()

export type ResolvedReviewEntry = z.infer<typeof resolvedReviewEntrySchema>

export const reviewJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    pending: pendingReviewEntrySchema.nullable(),
    resolved: z
      .array(resolvedReviewEntrySchema)
      .max(MAX_REVIEW_RESOLVED_ENTRIES),
  })
  .strict()

export type ReviewJournal = z.infer<typeof reviewJournalSchema>

export type ReviewResolutionInput = Readonly<{
  resolvedAt: string
  resultRevision: number
  resultSnapshotId: string
}>

export const createEmptyReviewJournal = (): ReviewJournal => ({
  schemaVersion: 1,
  pending: null,
  resolved: [],
})

export function reviewJournalOrEmpty(value: unknown): ReviewJournal {
  return value === undefined || value === null
    ? createEmptyReviewJournal()
    : reviewJournalSchema.parse(value)
}

export function reviewJournalForStorage(
  journalInput: ReviewJournal
): ReviewJournal | undefined {
  const journal = reviewJournalSchema.parse(journalInput)
  return journal.pending || journal.resolved.length ? journal : undefined
}

const defaultProvenance = (changeSet: ChangeSet): ReviewProposalProvenance => ({
  source: changeSet.createdBy === "agent" ? "webmcp" : "studio",
  actorLabel: changeSet.createdBy === "agent" ? "WebMCP agent" : "Studio user",
  toolName: null,
  reason: null,
  requestId: null,
})

const pageForNode = (document: Document, nodeId: string) =>
  document.pages.find((page) => page.nodeIds.includes(nodeId))?.id ?? null

const labelForNode = (document: Document, nodeId: string) =>
  document.nodes.find((node) => node.id === nodeId)?.name ?? `Layer ${nodeId}`

const labelForGroup = (document: Document, groupId: string) =>
  document.groups.find((group) => group.id === groupId)?.name ??
  `Group ${groupId}`

const labelForPage = (document: Document, pageId: string) =>
  document.pages.find((page) => page.id === pageId)?.name ?? `Page ${pageId}`

const labelForOutput = (document: Document, outputId: string) =>
  document.outputs.find((output) => output.id === outputId)?.name ??
  `Output ${outputId}`

const labelForField = (document: Document, fieldId: string) =>
  document.fields.find((field) => field.id === fieldId)?.label ??
  `Field ${fieldId}`

const labelForComponent = (document: Document, componentId: string) =>
  document.components.find((component) => component.id === componentId)?.name ??
  `Component ${componentId}`

const labelForComponentInstance = (document: Document, instanceId: string) =>
  document.componentInstances.find((instance) => instance.id === instanceId)
    ?.name ?? `Component instance ${instanceId}`

type TargetCollector = (target: ReviewAffectedTarget) => void

function collectNode(
  document: Document,
  nodeId: string,
  collect: TargetCollector,
  pageId = pageForNode(document, nodeId),
  label = labelForNode(document, nodeId)
) {
  collect({ kind: "node", id: nodeId, label, pageId })
}

function collectField(
  document: Document,
  fieldId: string,
  collect: TargetCollector,
  label = labelForField(document, fieldId)
) {
  collect({ kind: "field", id: fieldId, label, pageId: null })
  for (const binding of document.bindings) {
    if (binding.fieldId === fieldId)
      collectNode(document, binding.nodeId, collect)
  }
}

function collectComponentInstance(
  document: Document,
  instanceId: string,
  collect: TargetCollector,
  label = labelForComponentInstance(document, instanceId),
  pageId?: string | null
) {
  const instance = document.componentInstances.find(
    (candidate) => candidate.id === instanceId
  )
  const root = instance
    ? document.groups.find((group) => group.id === instance.rootGroupId)
    : undefined
  collect({
    kind: "component_instance",
    id: instanceId,
    label,
    pageId: pageId ?? root?.pageId ?? null,
  })
}

function collectComponent(
  document: Document,
  componentId: string,
  collect: TargetCollector,
  options: { label?: string; includeInstances?: boolean } = {}
) {
  const component = document.components.find(
    (candidate) => candidate.id === componentId
  )
  const source = component
    ? document.groups.find((group) => group.id === component.sourceGroupId)
    : undefined
  collect({
    kind: "component",
    id: componentId,
    label: options.label ?? labelForComponent(document, componentId),
    pageId: source?.pageId ?? null,
  })
  if (options.includeInstances === false) return
  for (const instance of document.componentInstances) {
    if (instance.componentId === componentId) {
      collectComponentInstance(document, instance.id, collect)
    }
  }
}

function collectCommandTargets(
  document: Document,
  command: DocumentCommand,
  collect: TargetCollector
) {
  switch (command.type) {
    case "create_component":
      collectComponent(document, command.component.id, collect, {
        label: command.component.name,
        includeInstances: false,
      })
      return
    case "update_component":
    case "delete_component":
    case "create_component_variant":
    case "update_component_variant":
    case "delete_component_variant":
      collectComponent(document, command.componentId, collect)
      return
    case "create_component_instance":
      collectComponent(document, command.instance.componentId, collect, {
        includeInstances: false,
      })
      collectComponentInstance(
        document,
        command.instance.id,
        collect,
        command.instance.name,
        command.pageId
      )
      return
    case "switch_component_variant":
    case "update_component_instance_metadata":
    case "reset_all_component_overrides":
    case "detach_component_instance": {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === command.instanceId
      )
      if (instance) {
        collectComponent(document, instance.componentId, collect, {
          includeInstances: false,
        })
      }
      collectComponentInstance(document, command.instanceId, collect)
      return
    }
    case "update_component_instance":
    case "reset_component_override": {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === command.instanceId
      )
      if (instance) {
        collectComponent(document, instance.componentId, collect, {
          includeInstances: false,
        })
        const mapping = instance.nodeMappings.find(
          (candidate) => candidate.sourceNodeId === command.sourceNodeId
        )
        if (mapping) collectNode(document, mapping.instanceNodeId, collect)
      }
      collectComponentInstance(document, command.instanceId, collect)
      return
    }
    case "synchronize_component_instances":
      for (const component of document.components) {
        collectComponent(document, component.id, collect, {
          includeInstances: false,
        })
      }
      return
    case "set_field":
    case "update_field":
    case "remove_field":
      collectField(document, command.fieldId, collect)
      return
    case "add_field":
      collectField(document, command.field.id, collect, command.field.label)
      return
    case "bind_field":
      collectField(document, command.binding.fieldId, collect)
      collectNode(document, command.binding.nodeId, collect)
      return
    case "unbind_field": {
      const binding = document.bindings.find(
        (candidate) => candidate.id === command.bindingId
      )
      if (binding) {
        collectField(document, binding.fieldId, collect)
        collectNode(document, binding.nodeId, collect)
      }
      return
    }
    case "add_node":
      collectNode(
        document,
        command.node.id,
        collect,
        command.pageId,
        command.node.name
      )
      return
    case "update_node":
    case "set_image_placement":
    case "set_image_frame_mask":
    case "replace_image_source":
    case "remove_node":
      collectNode(document, command.nodeId, collect)
      return
    case "reorder_node":
    case "reparent_node":
      collectNode(document, command.nodeId, collect, command.pageId)
      if (command.type === "reparent_node" && command.targetGroupId) {
        collect({
          kind: "group",
          id: command.targetGroupId,
          label: labelForGroup(document, command.targetGroupId),
          pageId: command.pageId,
        })
      }
      return
    case "reorder_nodes":
      for (const nodeId of command.nodeIds) {
        collectNode(document, nodeId, collect, command.pageId)
      }
      return
    case "duplicate_nodes":
      for (const node of command.nodes) {
        collectNode(document, node.id, collect, command.pageId, node.name)
      }
      for (const group of command.groups) {
        collect({
          kind: "group",
          id: group.id,
          label: group.name,
          pageId: command.pageId,
        })
      }
      return
    case "group_nodes":
      collect({
        kind: "group",
        id: command.groupId,
        label: command.name,
        pageId: command.pageId,
      })
      for (const nodeId of command.nodeIds) {
        collectNode(document, nodeId, collect, command.pageId)
      }
      return
    case "reparent_group":
      collect({
        kind: "group",
        id: command.groupId,
        label: labelForGroup(document, command.groupId),
        pageId: command.pageId,
      })
      if (command.targetGroupId) {
        collect({
          kind: "group",
          id: command.targetGroupId,
          label: labelForGroup(document, command.targetGroupId),
          pageId: command.pageId,
        })
      }
      return
    case "update_group":
    case "ungroup_nodes": {
      const group = document.groups.find(
        (candidate) => candidate.id === command.groupId
      )
      collect({
        kind: "group",
        id: command.groupId,
        label:
          command.type === "update_group"
            ? command.name
            : (group?.name ?? `Group ${command.groupId}`),
        pageId: group?.pageId ?? null,
      })
      return
    }
    case "add_page":
    case "duplicate_page":
      collect({
        kind: "page",
        id: command.page.id,
        label: command.page.name,
        pageId: command.page.id,
      })
      collect({
        kind: "output",
        id: command.outputId,
        label: labelForOutput(document, command.outputId),
        pageId: command.page.id,
      })
      return
    case "update_page":
    case "remove_page":
      collect({
        kind: "page",
        id: command.pageId,
        label:
          command.type === "update_page" && command.patch.name
            ? command.patch.name
            : labelForPage(document, command.pageId),
        pageId: command.pageId,
      })
      return
    case "reorder_page":
      collect({
        kind: "page",
        id: command.pageId,
        label: labelForPage(document, command.pageId),
        pageId: command.pageId,
      })
      collect({
        kind: "output",
        id: command.outputId,
        label: labelForOutput(document, command.outputId),
        pageId: command.pageId,
      })
      return
    case "add_output":
    case "add_output_variant":
      collect({
        kind: "output",
        id: command.output.id,
        label: command.output.name,
        pageId: command.page.id,
      })
      collect({
        kind: "page",
        id: command.page.id,
        label: command.page.name,
        pageId: command.page.id,
      })
      return
    case "update_output":
    case "remove_output":
      collect({
        kind: "output",
        id: command.outputId,
        label:
          command.type === "update_output"
            ? command.name
            : labelForOutput(document, command.outputId),
        pageId: null,
      })
  }
}

export function deriveReviewAffectedTargets(
  document: Document,
  changeSetInput: ChangeSet
): ReviewAffectedTarget[] {
  const changeSet = changeSetSchema.parse(changeSetInput)
  const targets = new Map<string, ReviewAffectedTarget>()
  const collect: TargetCollector = (target) => {
    const key = `${target.kind}:${target.id}`
    if (!targets.has(key)) targets.set(key, target)
  }
  for (const operation of changeSet.operations) {
    collectCommandTargets(document, operation.command, collect)
  }
  if (targets.size > MAX_REVIEW_AFFECTED_TARGETS) {
    throw new Error(
      `A review can affect at most ${MAX_REVIEW_AFFECTED_TARGETS} targets.`
    )
  }
  return [...targets.values()]
}

export function createReviewProposal(
  journalInput: ReviewJournal,
  document: Document,
  changeSetInput: ChangeSet,
  provenanceInput?: ReviewProposalProvenance
): ReviewJournal {
  const journal = reviewJournalSchema.parse(journalInput)
  if (journal.pending) throw new Error("Resolve the pending review first.")
  const changeSet = changeSetSchema.parse(changeSetInput)
  const provenance = reviewProposalProvenanceSchema.parse(
    provenanceInput ?? defaultProvenance(changeSet)
  )
  return reviewJournalSchema.parse({
    ...journal,
    pending: {
      changeSet,
      provenance,
      affected: deriveReviewAffectedTargets(document, changeSet),
    },
  })
}

export function updateReviewOperationDecision(
  journalInput: ReviewJournal,
  operationId: string,
  status: ChangeOperation["status"]
): ReviewJournal {
  const journal = reviewJournalSchema.parse(journalInput)
  if (!journal.pending) return journal
  return reviewJournalSchema.parse({
    ...journal,
    pending: {
      ...journal.pending,
      changeSet: decideChangeOperation(
        journal.pending.changeSet,
        operationId,
        status
      ),
    },
  })
}

export function updateAllReviewOperationDecisions(
  journalInput: ReviewJournal,
  status: "accepted" | "rejected"
): ReviewJournal {
  const journal = reviewJournalSchema.parse(journalInput)
  if (!journal.pending) return journal
  return reviewJournalSchema.parse({
    ...journal,
    pending: {
      ...journal.pending,
      changeSet: decideAllChangeOperations(journal.pending.changeSet, status),
    },
  })
}

function resolveReview(
  journalInput: ReviewJournal,
  resolutionInput: ReviewResolutionInput,
  status: ReviewResolution["status"]
): ReviewJournal {
  const journal = reviewJournalSchema.parse(journalInput)
  if (!journal.pending)
    throw new Error("There is no pending review to resolve.")
  const changeSet =
    status === "discarded"
      ? decideAllChangeOperations(journal.pending.changeSet, "rejected")
      : journal.pending.changeSet
  const acceptedOperationIds = changeSet.operations
    .filter((operation) => operation.status === "accepted")
    .map((operation) => operation.id)
  if (status === "applied" && acceptedOperationIds.length === 0) {
    throw new Error("Apply at least one accepted review operation.")
  }
  const rejectedOperationIds = changeSet.operations
    .filter((operation) => operation.status !== "accepted")
    .map((operation) => operation.id)
  const resolution = reviewResolutionSchema.parse({
    ...resolutionInput,
    status,
    acceptedOperationIds,
    rejectedOperationIds,
  })
  const resolved: ResolvedReviewEntry = {
    ...journal.pending,
    changeSet,
    resolution,
  }
  return reviewJournalSchema.parse({
    schemaVersion: 1,
    pending: null,
    resolved: [resolved, ...journal.resolved].slice(
      0,
      MAX_REVIEW_RESOLVED_ENTRIES
    ),
  })
}

export const resolveAppliedReview = (
  journal: ReviewJournal,
  input: ReviewResolutionInput
) => resolveReview(journal, input, "applied")

export const resolveDiscardedReview = (
  journal: ReviewJournal,
  input: ReviewResolutionInput
) => resolveReview(journal, input, "discarded")
