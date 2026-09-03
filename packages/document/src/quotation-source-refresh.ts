import { composeTracedQuotationDocument } from "./quotation-composer"
import type {
  QuotationCompositionTrace,
  QuotationTemplateId,
} from "./quotation-composer"
import {
  quotationRenderPayloadV1Schema,
  type QuotationRenderPayloadV1,
} from "./quotation-contract"
import { applyQuotationTemplate } from "./quotation-template-application"
import type {
  Document,
  FieldBinding,
  GroupDefinition,
  Page,
  SceneNode,
} from "./schema"
import { assertValidDocument } from "./validation"

export type QuotationRefreshConflict = Readonly<{
  kind: "changed_by_both" | "edited_then_removed"
  semanticKey: string
  layerName: string
  properties: readonly string[]
}>

export type QuotationRefreshImpact = Readonly<{
  changedSourcePaths: readonly string[]
  changedCategories: readonly string[]
  generatedPageCount: number
  previousGeneratedPageCount: number
  generatedLayerCount: number
  addedSourceLayers: number
  removedSourceLayers: number
  updatedSourceLayers: number
  preservedStudioLayers: number
  preservedCustomLayerCount: number
  businessChanges: readonly Readonly<{
    category: string
    added: number
    removed: number
    updated: number
  }>[]
  conflicts: readonly QuotationRefreshConflict[]
}>

export type QuotationRefreshConflictPolicy = "preserve_studio" | "use_source"

export type PreparedQuotationRefresh = Readonly<{
  document: Document
  impact: QuotationRefreshImpact
}>

export class QuotationRefreshAnchorConflictError extends Error {
  readonly semanticKeys: readonly string[]

  constructor(message: string, semanticKeys: readonly string[]) {
    super(message)
    this.name = "QuotationRefreshAnchorConflictError"
    this.semanticKeys = semanticKeys
  }
}

const MAX_REPORTED_SOURCE_PATHS = 200

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function keyedArray(value: readonly unknown[]) {
  if (
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as { key?: unknown }).key === "string"
    )
  ) {
    return new Map(
      value.map((item) => [
        (item as { key: string }).key,
        item as Record<string, unknown>,
      ])
    )
  }
  return null
}

function collectChangedPaths(
  left: unknown,
  right: unknown,
  path: string,
  output: string[]
) {
  if (output.length >= MAX_REPORTED_SOURCE_PATHS || equal(left, right)) return
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftByKey = keyedArray(left)
    const rightByKey = keyedArray(right)
    if (leftByKey && rightByKey) {
      for (const key of new Set([...leftByKey.keys(), ...rightByKey.keys()])) {
        collectChangedPaths(
          leftByKey.get(key),
          rightByKey.get(key),
          `${path}[${key}]`,
          output
        )
      }
      return
    }
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      collectChangedPaths(
        left[index],
        right[index],
        `${path}[${index}]`,
        output
      )
    }
    return
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    for (const key of new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ])) {
      collectChangedPaths(
        leftRecord[key],
        rightRecord[key],
        path ? `${path}.${key}` : key,
        output
      )
    }
    return
  }
  output.push(path || "quotation")
}

function sourceChangeCategory(path: string) {
  if (path.startsWith("branding.")) return "Branding"
  if (path.startsWith("quote.")) return "Quotation"
  if (path.startsWith("document.participants")) return "People"
  if (path.startsWith("document.events")) return "Events"
  if (path.startsWith("document.packages")) return "Packages"
  if (path.startsWith("document.deliveryTimelines")) return "Delivery schedule"
  if (path.startsWith("document.paymentMilestones")) return "Payment schedule"
  if (path.startsWith("document.fixedTerms")) return "Terms"
  if (path.startsWith("document.")) return "Document details"
  return "Source metadata"
}

function summarizeKeyedBusinessChanges(
  currentSource: QuotationRenderPayloadV1,
  incomingSource: QuotationRenderPayloadV1
) {
  const sections = [
    [
      "People",
      currentSource.document.participants,
      incomingSource.document.participants,
    ],
    ["Events", currentSource.document.events, incomingSource.document.events],
    [
      "Packages",
      currentSource.document.packages,
      incomingSource.document.packages,
    ],
    [
      "Delivery schedule",
      currentSource.document.deliveryTimelines,
      incomingSource.document.deliveryTimelines,
    ],
    [
      "Payment schedule",
      currentSource.document.paymentMilestones,
      incomingSource.document.paymentMilestones,
    ],
    [
      "Terms",
      currentSource.document.fixedTerms,
      incomingSource.document.fixedTerms,
    ],
  ] as const
  return sections.flatMap(([category, currentItems, incomingItems]) => {
    const current = new Map(
      currentItems.map((item) => [item.key, item] as const)
    )
    const incoming = new Map(
      incomingItems.map((item) => [item.key, item] as const)
    )
    let added = 0
    let removed = 0
    let updated = 0
    for (const key of new Set([...current.keys(), ...incoming.keys()])) {
      if (!current.has(key)) added += 1
      else if (!incoming.has(key)) removed += 1
      else if (!equal(current.get(key), incoming.get(key))) updated += 1
    }
    return added || removed || updated
      ? [{ category, added, removed, updated }]
      : []
  })
}

function recordFor(value: object) {
  return value as unknown as Record<string, unknown>
}

function changedProperties(left: object, right: object) {
  const leftRecord = recordFor(left)
  const rightRecord = recordFor(right)
  return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]
    .filter((key) => key !== "id" && !equal(leftRecord[key], rightRecord[key]))
    .sort()
}

function mergeGeneratedNode(
  semanticKey: string,
  oldNode: SceneNode,
  currentNode: SceneNode,
  nextNode: SceneNode,
  policy: QuotationRefreshConflictPolicy
) {
  if (oldNode.type !== currentNode.type || oldNode.type !== nextNode.type) {
    return {
      node: policy === "use_source" ? nextNode : currentNode,
      sourceChanged: true,
      manualChanged: true,
      conflict: {
        kind: "changed_by_both" as const,
        semanticKey,
        layerName: currentNode.name,
        properties: ["type"],
      },
    }
  }
  const oldRecord = recordFor(oldNode)
  const currentRecord = recordFor(currentNode)
  const nextRecord = recordFor(nextNode)
  const result: Record<string, unknown> = { ...nextRecord, id: currentNode.id }
  const properties = [
    ...new Set([
      ...Object.keys(oldRecord),
      ...Object.keys(currentRecord),
      ...Object.keys(nextRecord),
    ]),
  ].filter((key) => key !== "id")
  const conflicts: string[] = []
  let sourceChanged = false
  let manualChanged = false
  for (const property of properties) {
    const sourceDidChange = !equal(oldRecord[property], nextRecord[property])
    const studioDidChange = !equal(oldRecord[property], currentRecord[property])
    sourceChanged ||= sourceDidChange
    manualChanged ||= studioDidChange
    if (sourceDidChange && studioDidChange) {
      if (!equal(currentRecord[property], nextRecord[property])) {
        conflicts.push(property)
      }
      result[property] =
        policy === "use_source" ? nextRecord[property] : currentRecord[property]
    } else if (studioDidChange) {
      result[property] = currentRecord[property]
    }
  }
  return {
    node: result as SceneNode,
    sourceChanged,
    manualChanged,
    conflict: conflicts.length
      ? {
          kind: "changed_by_both" as const,
          semanticKey,
          layerName: currentNode.name,
          properties: conflicts,
        }
      : null,
  }
}

function semanticKeyById(trace: QuotationCompositionTrace) {
  return new Map(
    Object.entries(trace.nodeIdsBySemanticKey).map(([key, id]) => [id, key])
  )
}

function groupSemanticKeyById(trace: QuotationCompositionTrace) {
  return new Map(
    Object.entries(trace.groupIdsBySemanticKey).map(([key, id]) => [id, key])
  )
}

function generatedPageSignature(
  page: Page,
  nodeSemanticKeyById: ReadonlyMap<string, string>
) {
  return page.nodeIds.flatMap((nodeId) => {
    const semanticKey = nodeSemanticKeyById.get(nodeId)
    return semanticKey ? [semanticKey] : []
  })
}

function groupStructure(
  group: GroupDefinition,
  nodeSemanticKeyById: ReadonlyMap<string, string>,
  groupSemanticKeyById: ReadonlyMap<string, string>
) {
  return {
    nodeKeys: group.nodeIds.map(
      (nodeId) => nodeSemanticKeyById.get(nodeId) ?? `custom:${nodeId}`
    ),
    parentKey: group.parentGroupId
      ? (groupSemanticKeyById.get(group.parentGroupId) ??
        `custom:${group.parentGroupId}`)
      : null,
  }
}

function uniqueNodeId(
  preferred: string,
  semanticKey: string,
  occupied: Set<string>
) {
  if (!occupied.has(preferred)) {
    occupied.add(preferred)
    return preferred
  }
  let hash = 2_166_136_261
  for (const character of semanticKey) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  const base = `quotation-source-${(hash >>> 0).toString(36)}`
  let candidate = base
  let suffix = 2
  while (occupied.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  occupied.add(candidate)
  return candidate
}

function mergePagePresentation(
  oldPage: Page | undefined,
  currentPage: Page | undefined,
  nextPage: Page
) {
  if (!oldPage || !currentPage) return nextPage
  const result = { ...nextPage }
  for (const property of ["name", "width", "height", "background"] as const) {
    if (!equal(oldPage[property], currentPage[property])) {
      result[property] = currentPage[property] as never
    }
  }
  return result
}

export function prepareQuotationRefresh(
  options: Readonly<{
    currentDocument: Document
    currentSource: QuotationRenderPayloadV1
    incomingSource: QuotationRenderPayloadV1
    templateId: QuotationTemplateId
    compositionTemplateId?: QuotationTemplateId
    conflictPolicy?: QuotationRefreshConflictPolicy
    collisionChoices?: Readonly<Record<string, QuotationRefreshConflictPolicy>>
    now?: string
  }>
): PreparedQuotationRefresh {
  const currentSource = quotationRenderPayloadV1Schema.parse(
    options.currentSource
  )
  const incomingSource = quotationRenderPayloadV1Schema.parse(
    options.incomingSource
  )
  if (currentSource.source.quotationId !== incomingSource.source.quotationId) {
    throw new Error(
      "A quotation refresh must keep the same source quotation ID."
    )
  }
  if (incomingSource.source.revision <= currentSource.source.revision) {
    throw new Error(
      "A quotation refresh requires a newer source document revision."
    )
  }
  const policy = options.conflictPolicy ?? "preserve_studio"
  const compositionTemplateId =
    options.compositionTemplateId ?? options.templateId
  const oldComposition = composeTracedQuotationDocument(
    currentSource,
    compositionTemplateId
  )
  const nextComposition = composeTracedQuotationDocument(
    incomingSource,
    compositionTemplateId
  )
  const oldComposedDocument = applyQuotationTemplate(
    oldComposition.document,
    compositionTemplateId,
    options.templateId,
    { now: oldComposition.document.updatedAt }
  )
  const nextComposedDocument = applyQuotationTemplate(
    nextComposition.document,
    compositionTemplateId,
    options.templateId,
    { now: nextComposition.document.updatedAt }
  )
  const oldNodesById = new Map(
    oldComposedDocument.nodes.map((node) => [node.id, node])
  )
  const currentNodesById = new Map(
    options.currentDocument.nodes.map((node) => [node.id, node])
  )
  const nextNodesById = new Map(
    nextComposedDocument.nodes.map((node) => [node.id, node])
  )
  const oldNodeKeyById = semanticKeyById(oldComposition.trace)
  const nextNodeKeyById = semanticKeyById(nextComposition.trace)
  const oldPagesById = new Map(
    oldComposedDocument.pages.map((page) => [page.id, page])
  )
  const currentPagesById = new Map(
    options.currentDocument.pages.map((page) => [page.id, page])
  )
  const nextPagesById = new Map(
    nextComposedDocument.pages.map((page) => [page.id, page])
  )
  const currentPageByNodeId = new Map(
    options.currentDocument.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page] as const)
    )
  )
  const ambiguousCustomAnchors: string[] = []
  for (const currentNode of options.currentDocument.nodes) {
    if (oldNodeKeyById.has(currentNode.id)) continue
    const currentPage = currentPageByNodeId.get(currentNode.id)
    if (!currentPage || !oldPagesById.has(currentPage.id)) continue
    const oldPage = oldPagesById.get(currentPage.id)
    const nextPage = nextPagesById.get(currentPage.id)
    if (
      !oldPage ||
      !nextPage ||
      !equal(
        generatedPageSignature(oldPage, oldNodeKeyById),
        generatedPageSignature(nextPage, nextNodeKeyById)
      )
    ) {
      ambiguousCustomAnchors.push(`custom-node:${currentNode.id}`)
    }
  }
  if (ambiguousCustomAnchors.length) {
    throw new QuotationRefreshAnchorConflictError(
      "Studio cannot refresh this quotation until custom layers on repaginated source pages are moved or resolved explicitly.",
      ambiguousCustomAnchors
    )
  }
  const occupiedNodeIds = new Set(
    options.currentDocument.nodes.map((node) => node.id)
  )
  const resultNodeById = new Map<string, SceneNode>()
  const resultNodeIdBySemanticKey = new Map<string, string>()
  const restoredDeletedNodeKeys = new Set<string>()
  const conflicts: QuotationRefreshConflict[] = []
  let addedSourceLayers = 0
  let removedSourceLayers = 0
  let updatedSourceLayers = 0
  let preservedStudioLayers = 0
  let preservedCustomLayerCount = 0

  for (const [semanticKey, nextNodeId] of Object.entries(
    nextComposition.trace.nodeIdsBySemanticKey
  )) {
    const nextNode = nextNodesById.get(nextNodeId)
    if (!nextNode) continue
    const oldNodeId = oldComposition.trace.nodeIdsBySemanticKey[semanticKey]
    const oldNode = oldNodeId ? oldNodesById.get(oldNodeId) : undefined
    const currentNode = oldNodeId ? currentNodesById.get(oldNodeId) : undefined
    if (!oldNode) {
      const id = uniqueNodeId(nextNode.id, semanticKey, occupiedNodeIds)
      resultNodeById.set(id, { ...nextNode, id })
      resultNodeIdBySemanticKey.set(semanticKey, id)
      addedSourceLayers += 1
      continue
    }
    if (!currentNode) {
      const properties = changedProperties(oldNode, nextNode)
      if (!properties.length) {
        removedSourceLayers += 1
        preservedStudioLayers += 1
        continue
      }
      conflicts.push({
        kind: "changed_by_both",
        semanticKey,
        layerName: oldNode.name,
        properties,
      })
      if (
        (options.collisionChoices?.[semanticKey] ?? policy) === "use_source"
      ) {
        const id = uniqueNodeId(nextNode.id, semanticKey, occupiedNodeIds)
        resultNodeById.set(id, { ...nextNode, id })
        resultNodeIdBySemanticKey.set(semanticKey, id)
        restoredDeletedNodeKeys.add(semanticKey)
        updatedSourceLayers += 1
      } else {
        removedSourceLayers += 1
        preservedStudioLayers += 1
      }
      continue
    }
    occupiedNodeIds.add(currentNode.id)
    const merged = mergeGeneratedNode(
      semanticKey,
      oldNode,
      currentNode,
      nextNode,
      options.collisionChoices?.[semanticKey] ?? policy
    )
    resultNodeById.set(currentNode.id, { ...merged.node, id: currentNode.id })
    resultNodeIdBySemanticKey.set(semanticKey, currentNode.id)
    if (merged.sourceChanged) updatedSourceLayers += 1
    if (merged.manualChanged) preservedStudioLayers += 1
    if (merged.conflict) conflicts.push(merged.conflict)
  }

  for (const [semanticKey, oldNodeId] of Object.entries(
    oldComposition.trace.nodeIdsBySemanticKey
  )) {
    if (nextComposition.trace.nodeIdsBySemanticKey[semanticKey]) continue
    const oldNode = oldNodesById.get(oldNodeId)
    const currentNode = currentNodesById.get(oldNodeId)
    if (!oldNode || !currentNode) continue
    const properties = changedProperties(oldNode, currentNode)
    if (
      !properties.length ||
      (options.collisionChoices?.[semanticKey] ?? policy) === "use_source"
    ) {
      removedSourceLayers += 1
      continue
    }
    occupiedNodeIds.add(currentNode.id)
    resultNodeById.set(currentNode.id, currentNode)
    preservedStudioLayers += 1
    conflicts.push({
      kind: "edited_then_removed",
      semanticKey,
      layerName: currentNode.name,
      properties,
    })
  }

  const oldSourceNodeIds = new Set(oldNodeKeyById.keys())
  for (const currentNode of options.currentDocument.nodes) {
    if (oldSourceNodeIds.has(currentNode.id)) continue
    resultNodeById.set(currentNode.id, currentNode)
    occupiedNodeIds.add(currentNode.id)
    preservedStudioLayers += 1
    preservedCustomLayerCount += 1
  }

  const sourcePageIds = new Set(oldPagesById.keys())
  const generatedResultNodeIds = new Set(resultNodeIdBySemanticKey.values())
  const resultPages = nextComposedDocument.pages.map((nextPage) => {
    const page = mergePagePresentation(
      oldPagesById.get(nextPage.id),
      currentPagesById.get(nextPage.id),
      nextPage
    )
    const nodeIds = nextPage.nodeIds.flatMap((nextNodeId) => {
      const semanticKey = nextNodeKeyById.get(nextNodeId)
      const resultNodeId = semanticKey
        ? resultNodeIdBySemanticKey.get(semanticKey)
        : undefined
      return resultNodeId && resultNodeById.has(resultNodeId)
        ? [resultNodeId]
        : []
    })
    const currentPage = currentPagesById.get(nextPage.id)
    if (currentPage) {
      for (const nodeId of currentPage.nodeIds) {
        if (
          resultNodeById.has(nodeId) &&
          !nodeIds.includes(nodeId) &&
          !generatedResultNodeIds.has(nodeId)
        ) {
          nodeIds.push(nodeId)
        }
      }
    }
    return { ...page, nodeIds }
  })

  for (const currentPage of options.currentDocument.pages) {
    if (sourcePageIds.has(currentPage.id)) continue
    resultPages.push({
      ...currentPage,
      nodeIds: currentPage.nodeIds.filter((nodeId) =>
        resultNodeById.has(nodeId)
      ),
    })
  }
  const assignedNodeIds = new Set(resultPages.flatMap((page) => page.nodeIds))
  const unassignedNodes = [...resultNodeById.keys()].filter(
    (nodeId) => !assignedNodeIds.has(nodeId)
  )
  if (unassignedNodes.length) {
    throw new QuotationRefreshAnchorConflictError(
      "Studio cannot refresh this quotation because authored layers no longer have a proved page anchor.",
      unassignedNodes.map((nodeId) => `custom-node:${nodeId}`)
    )
  }

  const pageIdByNodeId = new Map(
    resultPages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id])
    )
  )
  const oldGroupsById = new Map(
    oldComposedDocument.groups.map((group) => [group.id, group])
  )
  const currentGroupsById = new Map(
    options.currentDocument.groups.map((group) => [group.id, group])
  )
  const nextGroupsById = new Map(
    nextComposedDocument.groups.map((group) => [group.id, group])
  )
  const oldGroupKeyById = groupSemanticKeyById(oldComposition.trace)
  const nextGroupKeyById = groupSemanticKeyById(nextComposition.trace)
  const resultGroupIdBySemanticKey = new Map<string, string>()
  const occupiedGroupIds = new Set(
    options.currentDocument.groups.map((group) => group.id)
  )
  for (const [semanticKey, nextGroupId] of Object.entries(
    nextComposition.trace.groupIdsBySemanticKey
  )) {
    const oldGroupId = oldComposition.trace.groupIdsBySemanticKey[semanticKey]
    const currentGroup = oldGroupId
      ? currentGroupsById.get(oldGroupId)
      : undefined
    const id =
      currentGroup?.id ??
      uniqueNodeId(nextGroupId, `group.${semanticKey}`, occupiedGroupIds)
    resultGroupIdBySemanticKey.set(semanticKey, id)
  }
  const resultGroups: GroupDefinition[] = []
  for (const [semanticKey, nextGroupId] of Object.entries(
    nextComposition.trace.groupIdsBySemanticKey
  )) {
    const nextGroup = nextGroupsById.get(nextGroupId)
    const resultGroupId = resultGroupIdBySemanticKey.get(semanticKey)
    if (!nextGroup || !resultGroupId) continue
    const oldGroupId = oldComposition.trace.groupIdsBySemanticKey[semanticKey]
    const oldGroup = oldGroupId ? oldGroupsById.get(oldGroupId) : undefined
    const currentGroup = oldGroupId
      ? currentGroupsById.get(oldGroupId)
      : undefined
    const incomingNodeIds = nextGroup.nodeIds.flatMap((nodeId) => {
      const nodeSemanticKey = nextNodeKeyById.get(nodeId)
      const resultNodeId = nodeSemanticKey
        ? resultNodeIdBySemanticKey.get(nodeSemanticKey)
        : undefined
      return resultNodeId && resultNodeById.has(resultNodeId)
        ? [resultNodeId]
        : []
    })
    const parentSemanticKey = nextGroup.parentGroupId
      ? nextGroupKeyById.get(nextGroup.parentGroupId)
      : undefined
    const incomingParentGroupId = parentSemanticKey
      ? resultGroupIdBySemanticKey.get(parentSemanticKey)
      : undefined
    let nodeIds = incomingNodeIds
    let parentGroupId = incomingParentGroupId
    let name = nextGroup.name
    const groupConflictProperties: string[] = []

    if (oldGroup) {
      const sourceStructureChanged = !equal(
        groupStructure(oldGroup, oldNodeKeyById, oldGroupKeyById),
        groupStructure(nextGroup, nextNodeKeyById, nextGroupKeyById)
      )
      if (!currentGroup) {
        if (!sourceStructureChanged) continue
        groupConflictProperties.push("structure")
        if (
          (options.collisionChoices?.[`group.${semanticKey}`] ?? policy) ===
          "preserve_studio"
        ) {
          conflicts.push({
            kind: "edited_then_removed",
            semanticKey: `group.${semanticKey}`,
            layerName: oldGroup.name,
            properties: ["structure"],
          })
          continue
        }
      } else {
        const effectiveCurrentNodeIds = [...currentGroup.nodeIds]
        for (const incomingNodeId of nextGroup.nodeIds) {
          const restoredKey = nextNodeKeyById.get(incomingNodeId)
          if (!restoredKey || !restoredDeletedNodeKeys.has(restoredKey))
            continue
          const restoredNodeId = resultNodeIdBySemanticKey.get(restoredKey)
          if (
            !restoredNodeId ||
            effectiveCurrentNodeIds.includes(restoredNodeId)
          ) {
            continue
          }
          const incomingIndex = nextGroup.nodeIds.indexOf(incomingNodeId)
          const previousResultId = nextGroup.nodeIds
            .slice(0, incomingIndex)
            .reverse()
            .map((nodeId) => nextNodeKeyById.get(nodeId))
            .map((key) =>
              key ? resultNodeIdBySemanticKey.get(key) : undefined
            )
            .find((nodeId) =>
              nodeId ? effectiveCurrentNodeIds.includes(nodeId) : false
            )
          const nextResultId = nextGroup.nodeIds
            .slice(incomingIndex + 1)
            .map((nodeId) => nextNodeKeyById.get(nodeId))
            .map((key) =>
              key ? resultNodeIdBySemanticKey.get(key) : undefined
            )
            .find((nodeId) =>
              nodeId ? effectiveCurrentNodeIds.includes(nodeId) : false
            )
          if (previousResultId) {
            effectiveCurrentNodeIds.splice(
              effectiveCurrentNodeIds.indexOf(previousResultId) + 1,
              0,
              restoredNodeId
            )
          } else if (nextResultId) {
            effectiveCurrentNodeIds.splice(
              effectiveCurrentNodeIds.indexOf(nextResultId),
              0,
              restoredNodeId
            )
          } else {
            effectiveCurrentNodeIds.push(restoredNodeId)
          }
        }
        const effectiveCurrentGroup = {
          ...currentGroup,
          nodeIds: effectiveCurrentNodeIds,
        }
        const studioStructureChanged = !equal(
          groupStructure(oldGroup, oldNodeKeyById, oldGroupKeyById),
          groupStructure(effectiveCurrentGroup, oldNodeKeyById, oldGroupKeyById)
        )
        if (sourceStructureChanged && studioStructureChanged) {
          groupConflictProperties.push("structure")
        }
        const preserveStudioStructure =
          studioStructureChanged &&
          (!sourceStructureChanged ||
            (options.collisionChoices?.[`group.${semanticKey}`] ?? policy) ===
              "preserve_studio")
        if (preserveStudioStructure) {
          if (
            effectiveCurrentGroup.nodeIds.some(
              (nodeId) => !resultNodeById.has(nodeId)
            )
          ) {
            throw new QuotationRefreshAnchorConflictError(
              "Studio cannot preserve an edited generated group after its source layers changed.",
              [`group.${semanticKey}`]
            )
          }
          nodeIds = [...effectiveCurrentGroup.nodeIds]
          parentGroupId = effectiveCurrentGroup.parentGroupId
        }

        const sourceNameChanged = oldGroup.name !== nextGroup.name
        const studioNameChanged = oldGroup.name !== currentGroup.name
        if (
          sourceNameChanged &&
          studioNameChanged &&
          currentGroup.name !== nextGroup.name
        ) {
          groupConflictProperties.push("name")
        }
        name =
          studioNameChanged &&
          (!sourceNameChanged ||
            (options.collisionChoices?.[`group.${semanticKey}`] ?? policy) ===
              "preserve_studio")
            ? currentGroup.name
            : nextGroup.name
      }
    }
    if (groupConflictProperties.length) {
      conflicts.push({
        kind: "changed_by_both",
        semanticKey: `group.${semanticKey}`,
        layerName: currentGroup?.name ?? oldGroup?.name ?? nextGroup.name,
        properties: [...new Set(groupConflictProperties)],
      })
    }
    if (!nodeIds.length) continue
    const pageId = pageIdByNodeId.get(nodeIds[0]!)
    if (
      !pageId ||
      nodeIds.some((nodeId) => pageIdByNodeId.get(nodeId) !== pageId)
    ) {
      throw new QuotationRefreshAnchorConflictError(
        "Studio cannot preserve a generated group whose layers no longer share one page.",
        [`group.${semanticKey}`]
      )
    }
    resultGroups.push({
      id: resultGroupId,
      name,
      pageId,
      nodeIds,
      role: "organize",
      ...(parentGroupId ? { parentGroupId } : {}),
    })
  }
  const customGroups: GroupDefinition[] = []
  for (const currentGroup of options.currentDocument.groups) {
    if (oldGroupKeyById.has(currentGroup.id)) continue
    const nodeIds = [...currentGroup.nodeIds]
    const pageId = nodeIds.length ? pageIdByNodeId.get(nodeIds[0]!) : undefined
    if (
      !pageId ||
      nodeIds.some((nodeId) => !resultNodeById.has(nodeId)) ||
      nodeIds.some((nodeId) => pageIdByNodeId.get(nodeId) !== pageId)
    ) {
      throw new QuotationRefreshAnchorConflictError(
        "Studio cannot refresh this quotation because an authored group lost its exact layer or page anchor.",
        [`custom-group:${currentGroup.id}`]
      )
    }
    customGroups.push({
      ...currentGroup,
      pageId,
      nodeIds,
    })
  }
  resultGroups.push(...customGroups)
  const resultGroupIds = new Set(resultGroups.map((group) => group.id))
  const invalidParentGroups = resultGroups.filter(
    (group) => group.parentGroupId && !resultGroupIds.has(group.parentGroupId)
  )
  if (invalidParentGroups.length) {
    throw new QuotationRefreshAnchorConflictError(
      "Studio cannot refresh this quotation because an authored group lost its parent anchor.",
      invalidParentGroups.map((group) => `group:${group.id}`)
    )
  }

  const newBindingIds = new Set(
    nextComposedDocument.bindings.map(({ id }) => id)
  )
  const oldBindingIds = new Set(
    oldComposedDocument.bindings.map(({ id }) => id)
  )
  const oldBindingsById = new Map(
    oldComposedDocument.bindings.map((binding) => [binding.id, binding])
  )
  const currentBindingsById = new Map(
    options.currentDocument.bindings.map((binding) => [binding.id, binding])
  )
  const generatedBindings = nextComposedDocument.bindings.flatMap((binding) => {
    const oldBinding = oldBindingsById.get(binding.id)
    const currentBinding = currentBindingsById.get(binding.id)
    if (oldBinding && !currentBinding) return []
    if (
      oldBinding &&
      currentBinding &&
      !equal(oldBinding, currentBinding) &&
      !equal(oldBinding, binding)
    ) {
      throw new QuotationRefreshAnchorConflictError(
        "Studio cannot refresh this quotation because a field binding changed in both Studio and the source composition.",
        [`binding:${binding.id}`]
      )
    }
    const selectedBinding =
      oldBinding && currentBinding && !equal(oldBinding, currentBinding)
        ? currentBinding
        : binding
    const nodeSemanticKey =
      nextNodeKeyById.get(selectedBinding.nodeId) ??
      oldNodeKeyById.get(selectedBinding.nodeId)
    const nodeId = nodeSemanticKey
      ? resultNodeIdBySemanticKey.get(nodeSemanticKey)
      : resultNodeById.has(selectedBinding.nodeId)
        ? selectedBinding.nodeId
        : undefined
    if (!nodeId) {
      throw new QuotationRefreshAnchorConflictError(
        "Studio cannot refresh this quotation because a field binding lost its layer anchor.",
        [`binding:${binding.id}`]
      )
    }
    return [{ ...selectedBinding, nodeId }]
  })
  const customBindings = options.currentDocument.bindings.filter(
    (binding) =>
      !oldBindingIds.has(binding.id) && !newBindingIds.has(binding.id)
  )
  const danglingCustomBindings = customBindings.filter(
    (binding) => !resultNodeById.has(binding.nodeId)
  )
  if (danglingCustomBindings.length) {
    throw new QuotationRefreshAnchorConflictError(
      "Studio cannot refresh this quotation because an authored field binding lost its layer anchor.",
      danglingCustomBindings.map((binding) => `binding:${binding.id}`)
    )
  }
  const bindings: FieldBinding[] = [...generatedBindings, ...customBindings]

  const sourceOutput = nextComposedDocument.outputs[0]
  if (!sourceOutput)
    throw new Error("The quotation composer produced no output.")
  const currentSourceOutput = options.currentDocument.outputs.find(
    (output) => output.id === sourceOutput.id
  )
  const oldSourceOutput = oldComposedDocument.outputs.find(
    (output) => output.id === sourceOutput.id
  )
  const sourceOutputName =
    currentSourceOutput &&
    oldSourceOutput &&
    currentSourceOutput.name !== oldSourceOutput.name
      ? currentSourceOutput.name
      : sourceOutput.name
  const sourcePageIdSet = new Set(
    resultPages
      .filter((page) => page.outputId === sourceOutput.id)
      .map((page) => page.id)
  )
  const outputs = [
    { ...sourceOutput, name: sourceOutputName, pageIds: [...sourcePageIdSet] },
    ...options.currentDocument.outputs.filter(
      (output) => output.id !== sourceOutput.id
    ),
  ]

  const oldTitleField = oldComposedDocument.fields.find(
    (field) => field.id === "field-quotation-title"
  )
  const currentTitleField = options.currentDocument.fields.find(
    (field) => field.id === "field-quotation-title"
  )
  const nextTitleField = nextComposedDocument.fields.find(
    (field) => field.id === "field-quotation-title"
  )
  const fields = options.currentDocument.fields.map((field) => {
    if (
      field.id !== "field-quotation-title" ||
      !oldTitleField ||
      !currentTitleField ||
      !nextTitleField
    ) {
      return field
    }
    return equal(currentTitleField, oldTitleField)
      ? nextTitleField
      : currentTitleField
  })
  if (
    nextTitleField &&
    !fields.some((field) => field.id === nextTitleField.id)
  ) {
    fields.push(nextTitleField)
  }
  const oldTitleValue = oldComposedDocument.fieldValues["field-quotation-title"]
  const currentTitleValue =
    options.currentDocument.fieldValues["field-quotation-title"]
  const nextTitleValue =
    nextComposedDocument.fieldValues["field-quotation-title"]
  const fieldValues = {
    ...options.currentDocument.fieldValues,
    ...(equal(currentTitleValue, oldTitleValue)
      ? { "field-quotation-title": nextTitleValue }
      : {}),
  }

  const changedSourcePaths: string[] = []
  collectChangedPaths(currentSource, incomingSource, "", changedSourcePaths)
  const document = assertValidDocument({
    ...options.currentDocument,
    name:
      options.currentDocument.name === oldComposedDocument.name
        ? nextComposedDocument.name
        : options.currentDocument.name,
    revision: options.currentDocument.revision + 1,
    updatedAt: options.now ?? new Date().toISOString(),
    outputs,
    pages: resultPages,
    nodes: [...resultNodeById.values()],
    groups: resultGroups,
    fields,
    fieldValues,
    bindings,
  })
  return {
    document,
    impact: {
      changedSourcePaths,
      changedCategories: [
        ...new Set(changedSourcePaths.map(sourceChangeCategory)),
      ],
      businessChanges: summarizeKeyedBusinessChanges(
        currentSource,
        incomingSource
      ),
      generatedPageCount: nextComposedDocument.pages.length,
      previousGeneratedPageCount: oldComposedDocument.pages.length,
      generatedLayerCount: nextComposedDocument.nodes.length,
      addedSourceLayers,
      removedSourceLayers,
      updatedSourceLayers,
      preservedStudioLayers,
      preservedCustomLayerCount,
      conflicts,
    },
  }
}
