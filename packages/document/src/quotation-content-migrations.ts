import {
  composeQuotationDocument,
  composeTracedQuotationDocumentV4,
} from "./quotation-composer"
import type { QuotationTemplateId } from "./quotation-composer"
import type { QuotationRenderPayloadV1 } from "./quotation-contract"
import { assertValidDocument } from "./validation"
import type { Document, GroupDefinition } from "./schema"

export const QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID = "quotation.groups@2"
export const QUOTATION_TEXT_EDITABILITY_MIGRATION_ID =
  "quotation.text-editability@4"
export const QUOTATION_TEXT_EDITABILITY_SOURCE_COMPOSER_VERSION = 3
export const QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION = 4
export const QUOTATION_TEXT_EDITABILITY_TARGET_TEMPLATE_VERSION = 4

export type QuotationTextEditabilityImpact = Readonly<{
  generatedTextLayerCount: number
  unlockTextLayerCount: number
  alreadyEditableTextLayerCount: number
  preservedStructuralLayerCount: number
  preservedCustomLayerCount: number
}>

type QuotationTextEditabilityTarget = Readonly<{
  nodeId: string
  pageId: string
}>

export type QuotationTextEditabilityAnalysis =
  | Readonly<{ status: "not_applicable"; reason: string }>
  | Readonly<{
      status: "already_current"
      impact: QuotationTextEditabilityImpact
    }>
  | Readonly<{ status: "blocked"; reason: string }>
  | Readonly<{
      status: "available"
      migrationId: typeof QUOTATION_TEXT_EDITABILITY_MIGRATION_ID
      fromComposerVersion: typeof QUOTATION_TEXT_EDITABILITY_SOURCE_COMPOSER_VERSION
      toComposerVersion: typeof QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION
      documentId: string
      documentRevision: number
      targets: readonly QuotationTextEditabilityTarget[]
      impact: QuotationTextEditabilityImpact
    }>

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

const composerOwnedNodeId = /^(?:rect|text|line)-\d+$/

function pageIdByNodeId(document: Document) {
  return new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )
}

function quotationTextEditabilityImpact(
  document: Document,
  reference: Document
): QuotationTextEditabilityImpact {
  const referenceNodeIds = new Set(reference.nodes.map((node) => node.id))
  const referenceTextNodeIds = new Set(
    reference.nodes.flatMap((node) => (node.type === "text" ? [node.id] : []))
  )
  const currentGeneratedText = document.nodes.filter(
    (node) => referenceTextNodeIds.has(node.id) && node.type === "text"
  )
  return {
    generatedTextLayerCount: currentGeneratedText.length,
    unlockTextLayerCount: currentGeneratedText.filter((node) => node.locked)
      .length,
    alreadyEditableTextLayerCount: currentGeneratedText.filter(
      (node) => !node.locked
    ).length,
    preservedStructuralLayerCount: document.nodes.filter(
      (node) => referenceNodeIds.has(node.id) && node.type !== "text"
    ).length,
    preservedCustomLayerCount: document.nodes.filter(
      (node) => !referenceNodeIds.has(node.id)
    ).length,
  }
}

export function analyzeQuotationTextEditability(
  document: Document,
  source: QuotationRenderPayloadV1 | null,
  templateId: QuotationTemplateId,
  composerVersion: number | null
): QuotationTextEditabilityAnalysis {
  if (!source || composerVersion === null) {
    return {
      status: "not_applicable",
      reason:
        "This document does not have a known quotation composition to upgrade.",
    }
  }

  const composition = composeTracedQuotationDocumentV4(source, templateId)
  const reference = composition.document
  const impact = quotationTextEditabilityImpact(document, reference)
  if (composerVersion === QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION) {
    return { status: "already_current", impact }
  }
  if (composerVersion !== QUOTATION_TEXT_EDITABILITY_SOURCE_COMPOSER_VERSION) {
    return {
      status: "blocked",
      reason: `Quotation composer ${composerVersion} cannot use the composer ${QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION} text-editability migration.`,
    }
  }

  const currentPageByNodeId = pageIdByNodeId(document)
  const referencePageByNodeId = pageIdByNodeId(reference)
  const currentNodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const referenceNodeById = new Map(
    reference.nodes.map((node) => [node.id, node])
  )

  for (const referencePage of reference.pages) {
    if (!document.pages.some((page) => page.id === referencePage.id)) {
      return {
        status: "blocked",
        reason: `The expected page ${referencePage.id} no longer exists.`,
      }
    }
  }
  for (const currentNode of document.nodes) {
    const referenceNode = referenceNodeById.get(currentNode.id)
    if (!referenceNode) {
      if (composerOwnedNodeId.test(currentNode.id)) {
        return {
          status: "blocked",
          reason: `The composer-owned layer ${currentNode.id} does not belong to this quotation source generation.`,
        }
      }
      continue
    }
    if (currentNode.type !== referenceNode.type) {
      return {
        status: "blocked",
        reason: `The expected layer ${currentNode.id} no longer has its original structural identity.`,
      }
    }
    if (
      currentPageByNodeId.get(currentNode.id) !==
      referencePageByNodeId.get(currentNode.id)
    ) {
      return {
        status: "blocked",
        reason: `The expected layer ${currentNode.id} is no longer on its original page.`,
      }
    }
  }

  const targets = reference.nodes.flatMap((referenceNode) => {
    if (referenceNode.type !== "text") return []
    const currentNode = currentNodeById.get(referenceNode.id)
    if (!currentNode || currentNode.type !== "text" || !currentNode.locked) {
      return []
    }
    const pageId = referencePageByNodeId.get(referenceNode.id)
    return pageId ? [{ nodeId: referenceNode.id, pageId }] : []
  })

  return {
    status: "available",
    migrationId: QUOTATION_TEXT_EDITABILITY_MIGRATION_ID,
    fromComposerVersion: QUOTATION_TEXT_EDITABILITY_SOURCE_COMPOSER_VERSION,
    toComposerVersion: QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION,
    documentId: document.id,
    documentRevision: document.revision,
    targets,
    impact,
  }
}

export function applyQuotationTextEditability(
  document: Document,
  analysis: Extract<QuotationTextEditabilityAnalysis, { status: "available" }>,
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

  const currentPageByNodeId = pageIdByNodeId(document)
  const targetIds = new Set(analysis.targets.map((target) => target.nodeId))
  for (const target of analysis.targets) {
    const node = document.nodes.find(
      (candidate) => candidate.id === target.nodeId
    )
    if (
      !node ||
      node.type !== "text" ||
      !node.locked ||
      currentPageByNodeId.get(target.nodeId) !== target.pageId
    ) {
      throw new Error(
        `The quotation text layer ${target.nodeId} changed after the upgrade was prepared. Analyze it again.`
      )
    }
  }

  return assertValidDocument({
    ...document,
    revision: document.revision + 1,
    updatedAt: now,
    nodes: document.nodes.map((node) =>
      targetIds.has(node.id) ? { ...node, locked: false } : node
    ),
  })
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
