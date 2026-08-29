import { composeQuotationDocument } from "./quotation-composer"
import type { QuotationTemplateId } from "./quotation-composer"
import type { QuotationRenderPayloadV1 } from "./quotation-contract"
import { assertValidDocument } from "./validation"
import type { Document, GroupDefinition } from "./schema"

export const QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID = "quotation.groups@2"

export type QuotationGroupOrganizationAnalysis =
  | Readonly<{ status: "not_applicable"; reason: string }>
  | Readonly<{ status: "already_current" }>
  | Readonly<{ status: "blocked"; reason: string }>
  | Readonly<{
      status: "available"
      migrationId: typeof QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID
      documentId: string
      documentRevision: number
      groups: readonly GroupDefinition[]
    }>

const sameMembers = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((id) => rightSet.has(id))
}

const hasCurrentQuotationGroups = (
  document: Document,
  expected: readonly GroupDefinition[]
) =>
  expected.every((group) => {
    const candidate = document.groups.find(({ id }) => id === group.id)
    return (
      candidate?.pageId === group.pageId &&
      candidate.parentGroupId === group.parentGroupId &&
      sameMembers(candidate.nodeIds, group.nodeIds)
    )
  })

export function analyzeQuotationGroupOrganization(
  document: Document,
  source: QuotationRenderPayloadV1 | null,
  templateId: QuotationTemplateId
): QuotationGroupOrganizationAnalysis {
  if (!source) {
    return {
      status: "not_applicable",
      reason: "This document is not linked to a quotation source.",
    }
  }

  const reference = composeQuotationDocument(source, templateId)
  if (document.groups.length > 0) {
    return hasCurrentQuotationGroups(document, reference.groups)
      ? { status: "already_current" }
      : {
          status: "blocked",
          reason:
            "This document already has custom or partial layer groups, so Studio will not replace them automatically.",
        }
  }

  const currentPages = new Map(document.pages.map((page) => [page.id, page]))
  const currentNodes = new Map(document.nodes.map((node) => [node.id, node]))
  const referenceNodes = new Map(reference.nodes.map((node) => [node.id, node]))
  const currentPageByNodeId = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )
  const referencePageByNodeId = new Map(
    reference.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )

  for (const referencePage of reference.pages) {
    if (!currentPages.has(referencePage.id)) {
      return {
        status: "blocked",
        reason: `The expected page ${referencePage.id} no longer exists.`,
      }
    }
  }

  for (const referenceNode of reference.nodes) {
    const currentNode = currentNodes.get(referenceNode.id)
    if (!currentNode || currentNode.type !== referenceNode.type) {
      return {
        status: "blocked",
        reason: `The expected layer ${referenceNode.id} no longer has its original structural identity.`,
      }
    }
    if (
      currentPageByNodeId.get(referenceNode.id) !==
      referencePageByNodeId.get(referenceNode.id)
    ) {
      return {
        status: "blocked",
        reason: `The expected layer ${referenceNode.id} is no longer on its original page.`,
      }
    }
  }

  for (const currentNode of document.nodes) {
    if (
      /^(?:rect|text|line)-\d+$/.test(currentNode.id) &&
      !referenceNodes.has(currentNode.id)
    ) {
      return {
        status: "blocked",
        reason: `The composer-owned layer ${currentNode.id} does not belong to this quotation source generation.`,
      }
    }
  }

  for (const group of reference.groups) {
    const currentPage = currentPages.get(group.pageId)
    if (!currentPage) {
      return {
        status: "blocked",
        reason: `The expected page ${group.pageId} no longer exists.`,
      }
    }
    const pageNodeIds = new Set(currentPage.nodeIds)
    for (const nodeId of group.nodeIds) {
      const currentNode = currentNodes.get(nodeId)
      const referenceNode = referenceNodes.get(nodeId)
      if (
        !currentNode ||
        !referenceNode ||
        currentNode.type !== referenceNode.type
      ) {
        return {
          status: "blocked",
          reason: `The expected layer ${nodeId} no longer has its original structural identity.`,
        }
      }
      if (!pageNodeIds.has(nodeId)) {
        return {
          status: "blocked",
          reason: `The expected layer ${nodeId} is no longer on ${group.pageId}.`,
        }
      }
    }
  }

  const groups = reference.groups.map((group) => {
    const page = currentPages.get(group.pageId)!
    const memberIds = new Set(group.nodeIds)
    return {
      ...group,
      nodeIds: page.nodeIds.filter((nodeId) => memberIds.has(nodeId)),
    }
  })

  return {
    status: "available",
    migrationId: QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID,
    documentId: document.id,
    documentRevision: document.revision,
    groups,
  }
}

export function applyQuotationGroupOrganization(
  document: Document,
  analysis: Extract<
    QuotationGroupOrganizationAnalysis,
    { status: "available" }
  >,
  now = new Date().toISOString()
): Document {
  if (
    document.id !== analysis.documentId ||
    document.revision !== analysis.documentRevision
  ) {
    throw new Error(
      "The document changed after the upgrade was prepared. Analyze it again."
    )
  }
  if (document.groups.length > 0) {
    throw new Error(
      "Layer organization changed after the upgrade was prepared. Analyze it again."
    )
  }
  return assertValidDocument({
    ...document,
    revision: document.revision + 1,
    updatedAt: now,
    groups: analysis.groups.map((group) => ({
      ...group,
      nodeIds: [...group.nodeIds],
    })),
  })
}
