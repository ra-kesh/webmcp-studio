import { documentSchema } from "./schema"
import type { Document } from "./schema"
import {
  fieldCanBindToProperty,
  fieldDefinitionValidationMessage,
  fieldValueSatisfiesDefinition,
} from "./fields"
import {
  curatedAssetIdentityFromSource,
  managedImageAssetIdentity,
} from "./media"
import { projectTextLayout } from "./text-layout"
import { normalizeRichTextContent } from "./rich-text"
import { assertVariableBindingCompatible } from "./variables"
import { componentIntegrityIssues } from "./components"
import {
  assertCompositeAdmission,
  isAdmittedMaskSource,
  initialMaskPaintAdmission,
  PagePaintPlanError,
  projectMaskCompositeGeometry,
  projectPagePaintPlan,
  supportedMaskPaintPixelRatio,
} from "./page-paint-plan"

export type ValidationIssue = {
  id: string
  severity: "error" | "warning"
  code:
    | "missing_reference"
    | "text_overflow"
    | "empty_required_field"
    | "invalid_group"
    | "off_canvas"
    | "missing_asset"
    | "invalid_binding"
    | "invalid_field_value"
    | "duplicate_id"
    | "invalid_output"
    | "invalid_page"
    | "orphan_page"
    | "orphan_node"
    | "invalid_asset"
    | "unsupported_font"
    | "render_limit_exceeded"
    | "unsafe_render_value"
    | "unmanaged_asset"
    | "missing_alt_text"
    | "invalid_rich_text"
    | "invalid_style"
    | "invalid_component"
    | "invalid_layout"
  message: string
  pageId?: string
  nodeId?: string
}

export class DocumentValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "Document validation failed")
    this.name = "DocumentValidationError"
    this.issues = issues
  }
}

export function assertValidDocument(input: unknown): Document {
  return assertValidCanonicalDocument(documentSchema.parse(input))
}

/**
 * Validates semantic invariants without reparsing an already-canonical
 * document. Internal transaction engines use this boundary so unchanged pages
 * and nodes retain their object identity for incremental renderers.
 *
 * Unknown input must continue through `assertValidDocument` first.
 */
export function assertValidCanonicalDocument(document: Document): Document {
  const blocking = validateDocument(document).filter(
    (issue) => issue.severity === "error"
  )
  if (blocking.length) throw new DocumentValidationError(blocking)
  return document
}

export function validateDocument(document: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const pages = new Map(document.pages.map((page) => [page.id, page]))
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const fields = new Map(document.fields.map((field) => [field.id, field]))
  const groups = new Map(document.groups.map((group) => [group.id, group]))
  const outputIds = new Set(document.outputs.map((output) => output.id))
  const pageNodeIds = new Map(
    document.pages.map((page) => [page.id, new Set(page.nodeIds)])
  )
  const pageNodeIndexes = new Map(
    document.pages.map((page) => [
      page.id,
      new Map(page.nodeIds.map((nodeId, index) => [nodeId, index])),
    ])
  )
  const childGroupsByParent = new Map<string, Document["groups"]>()
  for (const group of document.groups) {
    if (!group.parentGroupId) continue
    const children = childGroupsByParent.get(group.parentGroupId)
    if (children) children.push(group)
    else childGroupsByParent.set(group.parentGroupId, [group])
  }
  const descendantNodeIdsByGroup = new Map<string, string[]>()
  const resolvingGroupIds = new Set<string>()
  const descendantNodeIds = (groupId: string): string[] => {
    const cached = descendantNodeIdsByGroup.get(groupId)
    if (cached) return cached
    if (resolvingGroupIds.has(groupId)) return []
    const group = groups.get(groupId)
    if (!group) return []
    resolvingGroupIds.add(groupId)
    const nodeIds = [
      ...group.nodeIds,
      ...(childGroupsByParent.get(groupId) ?? []).flatMap((child) =>
        descendantNodeIds(child.id)
      ),
    ]
    resolvingGroupIds.delete(groupId)
    descendantNodeIdsByGroup.set(groupId, nodeIds)
    return nodeIds
  }
  const maskedLeafContentCount = (
    groupId: string,
    resolving = new Set<string>()
  ): number => {
    if (resolving.has(groupId)) {
      return initialMaskPaintAdmission.maxMaskedDescendants + 1
    }
    const group = groups.get(groupId)
    if (!group || group.role !== "mask") return 0
    const nextResolving = new Set(resolving).add(groupId)
    const sources = new Set(group.mask.sourceNodeIds)
    return (
      group.nodeIds.filter((nodeId) => !sources.has(nodeId)).length +
      (childGroupsByParent.get(groupId) ?? []).reduce(
        (count, child) =>
          count +
          (child.role === "mask"
            ? maskedLeafContentCount(child.id, nextResolving)
            : 0),
        0
      )
    )
  }

  const reportDuplicateIds = (
    collection: string,
    values: Array<{ id: string }>
  ) => {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value.id)) {
        issues.push({
          id: `${collection}:${value.id}:duplicate-id`,
          severity: "error",
          code: "duplicate_id",
          message: `${collection} contains duplicate id ${value.id}`,
        })
      }
      seen.add(value.id)
    }
  }

  reportDuplicateIds("outputs", document.outputs)
  reportDuplicateIds("pages", document.pages)
  reportDuplicateIds("nodes", document.nodes)
  reportDuplicateIds("groups", document.groups)
  reportDuplicateIds("fields", document.fields)
  reportDuplicateIds("bindings", document.bindings)
  reportDuplicateIds("typography styles", document.typographyStyles)
  reportDuplicateIds("paint styles", document.paintStyles)
  reportDuplicateIds("variables", document.variables)
  reportDuplicateIds("variable bindings", document.variableBindings)
  reportDuplicateIds("components", document.components)
  reportDuplicateIds("component instances", document.componentInstances)

  const typographyStyles = new Set(
    document.typographyStyles.map((style) => style.id)
  )
  const paintStyles = new Set(document.paintStyles.map((style) => style.id))

  for (const [label, styles] of [
    ["typography", document.typographyStyles],
    ["paint", document.paintStyles],
  ] as const) {
    const names = new Set<string>()
    for (const style of styles) {
      const normalizedName = style.name.trim().toLocaleLowerCase()
      if (names.has(normalizedName)) {
        issues.push({
          id: `${label}-style:${style.id}:duplicate-name`,
          severity: "error",
          code: "duplicate_id",
          message: `${label} styles contains duplicate name ${style.name}`,
        })
      }
      names.add(normalizedName)
    }
  }

  const variableNames = new Set<string>()
  for (const variable of document.variables) {
    const normalizedName = variable.name.trim().toLocaleLowerCase()
    if (variableNames.has(normalizedName)) {
      issues.push({
        id: `variable:${variable.id}:duplicate-name`,
        severity: "error",
        code: "duplicate_id",
        message: `Variables contains duplicate name ${variable.name}`,
      })
    }
    variableNames.add(normalizedName)
  }

  const pageOwner = new Map<string, string>()

  for (const output of document.outputs) {
    const outputPageIds = new Set<string>()
    for (const pageId of output.pageIds) {
      if (outputPageIds.has(pageId)) {
        issues.push({
          id: `output:${output.id}:page:${pageId}:duplicate`,
          severity: "error",
          code: "invalid_output",
          message: `${output.name} contains page ${pageId} more than once`,
          pageId,
        })
      }
      outputPageIds.add(pageId)
      if (!pages.has(pageId)) {
        issues.push({
          id: `output:${output.id}:page:${pageId}`,
          severity: "error",
          code: "missing_reference",
          message: `${output.name} points to a missing page`,
          pageId,
        })
        continue
      }
      const page = pages.get(pageId)
      if (page?.outputId !== output.id) {
        issues.push({
          id: `output:${output.id}:page:${pageId}:owner`,
          severity: "error",
          code: "invalid_output",
          message: `${page?.name ?? pageId} does not belong to ${output.name}`,
          pageId,
        })
      }
      const existingOwner = pageOwner.get(pageId)
      if (existingOwner && existingOwner !== output.id) {
        issues.push({
          id: `output:${output.id}:page:${pageId}:shared`,
          severity: "error",
          code: "invalid_output",
          message: `${page?.name ?? pageId} belongs to more than one output`,
          pageId,
        })
      }
      pageOwner.set(pageId, output.id)
    }
  }

  const nodeOwner = new Map<string, string>()
  for (const page of document.pages) {
    if (!outputIds.has(page.outputId)) {
      issues.push({
        id: `page:${page.id}:output:${page.outputId}`,
        severity: "error",
        code: "missing_reference",
        message: `${page.name} points to a missing output`,
        pageId: page.id,
      })
    }
    if (!pageOwner.has(page.id)) {
      issues.push({
        id: `page:${page.id}:orphan`,
        severity: "error",
        code: "orphan_page",
        message: `${page.name} is not included in an output`,
        pageId: page.id,
      })
    }
    const pageNodeIds = new Set<string>()
    for (const nodeId of page.nodeIds) {
      if (pageNodeIds.has(nodeId)) {
        issues.push({
          id: `page:${page.id}:node:${nodeId}:duplicate`,
          severity: "error",
          code: "invalid_page",
          message: `${page.name} contains layer ${nodeId} more than once`,
          pageId: page.id,
          nodeId,
        })
      }
      pageNodeIds.add(nodeId)
      const node = nodes.get(nodeId)
      if (!node) {
        issues.push({
          id: `page:${page.id}:node:${nodeId}`,
          severity: "error",
          code: "missing_reference",
          message: `${page.name} points to a missing node`,
          pageId: page.id,
          nodeId,
        })
        continue
      }
      const existingOwner = nodeOwner.get(nodeId)
      if (existingOwner && existingOwner !== page.id) {
        issues.push({
          id: `page:${page.id}:node:${nodeId}:shared`,
          severity: "error",
          code: "invalid_page",
          message: `${node.name} belongs to more than one page`,
          pageId: page.id,
          nodeId,
        })
      }
      nodeOwner.set(nodeId, page.id)
      const textOverflow =
        node.type === "text" ? projectTextLayout(node).overflow : false
      if (node.type === "text") {
        try {
          const normalized = normalizeRichTextContent(node.text, {
            runs: node.runs,
            paragraphs: node.paragraphs,
            links: node.links,
          })
          if (
            JSON.stringify(normalized.runs) !== JSON.stringify(node.runs) ||
            JSON.stringify(normalized.paragraphs) !==
              JSON.stringify(node.paragraphs) ||
            JSON.stringify(normalized.links) !== JSON.stringify(node.links)
          ) {
            throw new Error("Rich-text ranges are not canonical")
          }
        } catch (error) {
          issues.push({
            id: `node:${node.id}:rich-text`,
            severity: "error",
            code: "invalid_rich_text",
            message: `${node.name} has invalid rich-text ranges: ${error instanceof Error ? error.message : "unknown range error"}`,
            pageId: page.id,
            nodeId: node.id,
          })
        }
        if (
          node.typographyStyleId &&
          !typographyStyles.has(node.typographyStyleId)
        ) {
          issues.push({
            id: `node:${node.id}:typography-style`,
            severity: "error",
            code: "invalid_style",
            message: `${node.name} points to missing typography style ${node.typographyStyleId}`,
            pageId: page.id,
            nodeId: node.id,
          })
        }
        for (const run of node.runs) {
          if (
            run.style.typographyStyleId &&
            !typographyStyles.has(run.style.typographyStyleId)
          ) {
            issues.push({
              id: `node:${node.id}:run:${run.start}:typography-style`,
              severity: "error",
              code: "invalid_style",
              message: `${node.name} contains a range pointing to missing typography style ${run.style.typographyStyleId}`,
              pageId: page.id,
              nodeId: node.id,
            })
          }
          if (
            run.style.paintStyleId &&
            !paintStyles.has(run.style.paintStyleId)
          ) {
            issues.push({
              id: `node:${node.id}:run:${run.start}:paint-style`,
              severity: "error",
              code: "invalid_style",
              message: `${node.name} contains a range pointing to missing paint style ${run.style.paintStyleId}`,
              pageId: page.id,
              nodeId: node.id,
            })
          }
        }
      }
      if (
        node.type !== "image" &&
        node.paintStyleId &&
        !paintStyles.has(node.paintStyleId)
      ) {
        issues.push({
          id: `node:${node.id}:paint-style`,
          severity: "error",
          code: "invalid_style",
          message: `${node.name} points to missing paint style ${node.paintStyleId}`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
      if (textOverflow) {
        issues.push({
          id: `node:${node.id}:overflow`,
          severity: "warning",
          code: "text_overflow",
          message: `${node.name} may overflow its text box`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
      if (
        node.x < 0 ||
        node.y < 0 ||
        node.x + node.width > page.width ||
        node.y + node.height > page.height
      ) {
        issues.push({
          id: `node:${node.id}:off-canvas`,
          severity: "warning",
          code: "off_canvas",
          message: `${node.name} extends beyond ${page.name}`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
      if (node.type === "image" && !node.src.trim()) {
        issues.push({
          id: `node:${node.id}:asset`,
          severity: "error",
          code: "missing_asset",
          message: `${node.name} has no image source`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
      if (node.type === "image") {
        const identity = managedImageAssetIdentity(node.assetId, node.src)
        if (identity.managed && !identity.coherent) {
          issues.push({
            id: `node:${node.id}:managed-asset-identity`,
            severity: "error",
            code: "invalid_asset",
            message: `${node.name} has mismatched managed asset identity`,
            pageId: page.id,
            nodeId: node.id,
          })
        }
      }
      if (
        node.type === "image" &&
        node.src.trim() &&
        !node.src.startsWith("asset:local/") &&
        !node.src.startsWith("asset:managed/") &&
        !curatedAssetIdentityFromSource(node.src) &&
        !node.src.startsWith("data:image/") &&
        !node.src.startsWith("https://")
      ) {
        issues.push({
          id: `node:${node.id}:asset-policy`,
          severity: "error",
          code: "invalid_asset",
          message: `${node.name} uses an unsupported image source`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
    }
  }

  for (const node of document.nodes) {
    if (!nodeOwner.has(node.id)) {
      issues.push({
        id: `node:${node.id}:orphan`,
        severity: "error",
        code: "orphan_node",
        message: `${node.name} is not included on a page`,
        nodeId: node.id,
      })
    }
  }

  const frameOwnerByChild = new Map<string, string>()
  const maskSourceNodeIds = new Set(
    document.groups.flatMap((group) =>
      group.role === "mask" ? group.mask.sourceNodeIds : []
    )
  )
  for (const frame of document.nodes) {
    if (frame.type !== "frame") continue
    const framePageId = nodeOwner.get(frame.id)
    const framePageIndexes = framePageId
      ? pageNodeIndexes.get(framePageId)
      : undefined
    const frameIndex = framePageIndexes?.get(frame.id) ?? -1
    const localChildren = new Set<string>()
    let previousIndex = -1
    for (const child of frame.children) {
      const childNode = nodes.get(child.nodeId)
      const childPageId = nodeOwner.get(child.nodeId)
      const childIndex = framePageIndexes?.get(child.nodeId) ?? -1
      const existingOwner = frameOwnerByChild.get(child.nodeId)
      if (maskSourceNodeIds.has(child.nodeId)) {
        issues.push({
          id: `frame:${frame.id}:mask-source:${child.nodeId}`,
          severity: "error",
          code: "invalid_layout",
          message: `${frame.name} cannot own mask source ${child.nodeId}; release it from the mask before adding it to a frame`,
          pageId: framePageId,
          nodeId: frame.id,
        })
      }
      if (
        !childNode ||
        child.nodeId === frame.id ||
        !framePageId ||
        childPageId !== framePageId ||
        localChildren.has(child.nodeId) ||
        (existingOwner !== undefined && existingOwner !== frame.id) ||
        childIndex <= frameIndex ||
        childIndex <= previousIndex
      ) {
        issues.push({
          id: `frame:${frame.id}:child:${child.nodeId}`,
          severity: "error",
          code: "invalid_layout",
          message: `${frame.name} has an invalid, duplicated, cross-page, or out-of-order child ${child.nodeId}`,
          pageId: framePageId,
          nodeId: frame.id,
        })
      }
      localChildren.add(child.nodeId)
      frameOwnerByChild.set(child.nodeId, frame.id)
      previousIndex = childIndex
    }
    if (frame.children.length > 0 && frame.rotation !== 0) {
      issues.push({
        id: `frame:${frame.id}:rotation`,
        severity: "error",
        code: "invalid_layout",
        message: `${frame.name} must use zero rotation while it owns child layers`,
        pageId: framePageId,
        nodeId: frame.id,
      })
    }
  }
  for (const frame of document.nodes) {
    if (frame.type !== "frame") continue
    const seen = new Set<string>([frame.id])
    let ownerId = frameOwnerByChild.get(frame.id)
    while (ownerId) {
      if (seen.has(ownerId)) {
        issues.push({
          id: `frame:${frame.id}:cycle`,
          severity: "error",
          code: "invalid_layout",
          message: `${frame.name} participates in a frame ownership cycle`,
          pageId: nodeOwner.get(frame.id),
          nodeId: frame.id,
        })
        break
      }
      seen.add(ownerId)
      ownerId = frameOwnerByChild.get(ownerId)
    }
  }

  const directMembership = new Map<string, string>()
  for (const group of document.groups) {
    const page = pages.get(group.pageId)
    if (!page) {
      if (group.role === "mask") {
        issues.push({
          id: `group:${group.id}:mask-page`,
          severity: "error",
          code: "invalid_group",
          message: `${group.name} mask must belong to an existing page`,
          pageId: group.pageId,
        })
      }
      issues.push({
        id: `group:${group.id}:page`,
        severity: "error",
        code: "missing_reference",
        message: `${group.name} points to a missing page`,
        pageId: group.pageId,
      })
      continue
    }
    if (group.parentGroupId) {
      const parent = groups.get(group.parentGroupId)
      if (!parent || parent.pageId !== group.pageId) {
        issues.push({
          id: `group:${group.id}:parent`,
          severity: "error",
          code: "missing_reference",
          message: `${group.name} points to a missing group on its page`,
          pageId: group.pageId,
        })
      }
    }
    const directNodeIds = new Set<string>()
    if (group.nodeIds.length === 0 && !childGroupsByParent.has(group.id)) {
      issues.push({
        id: `group:${group.id}:empty`,
        severity: "error",
        code: "invalid_group",
        message: `${group.name} does not contain any layers or child groups`,
        pageId: group.pageId,
      })
    }
    for (const nodeId of group.nodeIds) {
      if (directNodeIds.has(nodeId)) {
        issues.push({
          id: `group:${group.id}:duplicate:${nodeId}`,
          severity: "error",
          code: "invalid_group",
          message: `${group.name} contains the same layer more than once`,
          pageId: group.pageId,
          nodeId,
        })
        continue
      }
      directNodeIds.add(nodeId)
      if (!nodes.has(nodeId) || !pageNodeIds.get(page.id)?.has(nodeId)) {
        issues.push({
          id: `group:${group.id}:node:${nodeId}`,
          severity: "error",
          code: "missing_reference",
          message: `${group.name} contains a missing layer`,
          pageId: group.pageId,
          nodeId,
        })
      }
      const existingGroupId = directMembership.get(nodeId)
      if (existingGroupId && existingGroupId !== group.id) {
        issues.push({
          id: `group:${group.id}:duplicate:${nodeId}`,
          severity: "error",
          code: "invalid_group",
          message: `A layer cannot directly belong to two groups`,
          pageId: group.pageId,
          nodeId,
        })
      }
      directMembership.set(nodeId, group.id)
    }

    if (group.role === "mask") {
      const maskIssue = (suffix: string, message: string, nodeId?: string) =>
        issues.push({
          id: `group:${group.id}:mask:${suffix}`,
          severity: "error",
          code: "invalid_group",
          message,
          pageId: group.pageId,
          nodeId,
        })
      const sourceIds = new Set<string>()
      for (const sourceNodeId of group.mask.sourceNodeIds) {
        if (sourceIds.has(sourceNodeId)) {
          maskIssue(
            `duplicate-source:${sourceNodeId}`,
            `${group.name} mask contains the same source more than once`,
            sourceNodeId
          )
          continue
        }
        sourceIds.add(sourceNodeId)
        if (
          !nodes.has(sourceNodeId) ||
          !pageNodeIds.get(page.id)?.has(sourceNodeId)
        ) {
          maskIssue(
            `source-page:${sourceNodeId}`,
            `${group.name} mask source must exist on its page`,
            sourceNodeId
          )
        }
        if (!group.nodeIds.includes(sourceNodeId)) {
          maskIssue(
            `source-member:${sourceNodeId}`,
            `${group.name} mask source must be a direct group member`,
            sourceNodeId
          )
        }
        const source = nodes.get(sourceNodeId)
        if (!isAdmittedMaskSource(group.mask.type, source)) {
          maskIssue(
            `source-admission:${sourceNodeId}`,
            `${group.name} mask source is not admitted for ${group.mask.type}`,
            sourceNodeId
          )
        }
      }
      if (sourceIds.size > initialMaskPaintAdmission.maxSources) {
        maskIssue(
          "source-limit",
          `${group.name} mask exceeds the source admission limit`
        )
      }
      const childGroups = childGroupsByParent.get(group.id) ?? []
      const maskChildren = childGroups.filter((child) => child.role === "mask")
      const directContentCount = group.nodeIds.filter(
        (nodeId) => !sourceIds.has(nodeId)
      ).length
      if (directContentCount === 0 && maskChildren.length === 0) {
        maskIssue(
          "content",
          `${group.name} mask must contain a non-source layer`
        )
      }
      if (
        maskedLeafContentCount(group.id) >
        initialMaskPaintAdmission.maxMaskedDescendants
      ) {
        maskIssue(
          "content-limit",
          `${group.name} mask exceeds the masked-content admission limit`
        )
      }
      const parent = group.parentGroupId
        ? groups.get(group.parentGroupId)
        : undefined
      const grandparent = parent?.parentGroupId
        ? groups.get(parent.parentGroupId)
        : undefined
      if (
        (group.parentGroupId && parent?.role !== "mask") ||
        childGroups.some((child) => child.role !== "mask") ||
        grandparent
      ) {
        maskIssue(
          "nesting",
          `${group.name} mask exceeds the bounded direct mask nesting admission`
        )
      }
      const groupNodes = group.nodeIds
        .map((nodeId) => nodes.get(nodeId))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
      if (
        !group.parentGroupId &&
        childGroups.length === 0 &&
        groupNodes.length === group.nodeIds.length
      ) {
        const geometry = projectMaskCompositeGeometry(
          groupNodes,
          group.mask.sourceNodeIds
        )
        if (geometry.visibleContentNodeIds.length > 0) {
          try {
            assertCompositeAdmission(
              group.id,
              geometry.bounds,
              supportedMaskPaintPixelRatio(
                initialMaskPaintAdmission.maxPixelRatio
              )
            )
          } catch (error) {
            if (
              error instanceof PagePaintPlanError &&
              error.code === "MASK_GROUP_COMPOSITE_LIMIT"
            ) {
              maskIssue(
                "composite-limit",
                `${group.name} mask exceeds the initial composite admission limit`
              )
            } else {
              throw error
            }
          }
        }
      }
    }

    const visited = new Set<string>([group.id])
    let parentId = group.parentGroupId
    while (parentId) {
      if (visited.has(parentId)) {
        issues.push({
          id: `group:${group.id}:cycle`,
          severity: "error",
          code: "invalid_group",
          message: `${group.name} creates a circular group hierarchy`,
          pageId: group.pageId,
        })
        break
      }
      visited.add(parentId)
      parentId = groups.get(parentId)?.parentGroupId
    }

    const nodeIndexes = pageNodeIndexes.get(page.id)
    const descendantIndexes = descendantNodeIds(group.id)
      .map((nodeId) => nodeIndexes?.get(nodeId) ?? -1)
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)
    if (
      descendantIndexes.some(
        (index, position) =>
          position > 0 &&
          index !== (descendantIndexes[position - 1] ?? index) + 1
      )
    ) {
      issues.push({
        id: `group:${group.id}:stack`,
        severity: "error",
        code: "invalid_group",
        message: `${group.name} must occupy one contiguous layer stack`,
        pageId: group.pageId,
      })
    }
  }

  // Canonical admission uses the highest Gate M2 renderer ratio. A document
  // accepted here is therefore allocatable by the shared 1x and 2x paths.
  for (const page of document.pages) {
    try {
      projectPagePaintPlan(document, page.id, {
        pixelRatio: supportedMaskPaintPixelRatio(
          initialMaskPaintAdmission.maxPixelRatio
        ),
      })
    } catch (error) {
      if (
        error instanceof PagePaintPlanError &&
        (error.code === "MASK_PAGE_COMPOSITE_COUNT_LIMIT" ||
          error.code === "MASK_PAGE_COMPOSITE_AREA_LIMIT")
      ) {
        issues.push({
          id: `page:${page.id}:mask-composite-admission`,
          severity: "error",
          code: "render_limit_exceeded",
          message:
            error.code === "MASK_PAGE_COMPOSITE_COUNT_LIMIT"
              ? `Page ${page.name} exceeds the Gate M2 active mask composite count limit`
              : `Page ${page.name} exceeds the Gate M2 summed 2x mask composite area limit`,
          pageId: page.id,
        })
      } else if (error instanceof PagePaintPlanError) {
        issues.push({
          id: `page:${page.id}:mask-plan:${error.groupId ?? error.code}`,
          severity: "error",
          code: "invalid_group",
          message: error.message,
          pageId: page.id,
          nodeId: error.nodeId,
        })
      }
    }
  }

  for (const field of fields.values()) {
    const value = document.fieldValues[field.id]
    if (field.required && (value === undefined || value === "")) {
      issues.push({
        id: `field:${field.id}:required`,
        severity: "error",
        code: "empty_required_field",
        message: `${field.label} is required`,
      })
    }
    if (value !== undefined && !fieldValueSatisfiesDefinition(field, value)) {
      issues.push({
        id: `field:${field.id}:type`,
        severity: "error",
        code: "invalid_field_value",
        message: `${field.label} has the wrong value type`,
      })
    }
    if (fieldDefinitionValidationMessage(field)) {
      issues.push({
        id: `field:${field.id}:default-type`,
        severity: "error",
        code: "invalid_field_value",
        message: `${field.label} has the wrong default value type`,
      })
    }
  }

  const fieldKeys = new Set<string>()
  for (const field of document.fields) {
    if (fieldKeys.has(field.key)) {
      issues.push({
        id: `field:${field.id}:duplicate-key`,
        severity: "error",
        code: "duplicate_id",
        message: `Field key ${field.key} is used more than once`,
      })
    }
    fieldKeys.add(field.key)
  }
  for (const fieldId of Object.keys(document.fieldValues)) {
    if (!fields.has(fieldId)) {
      issues.push({
        id: `field-value:${fieldId}:orphan`,
        severity: "error",
        code: "missing_reference",
        message: `Field value ${fieldId} has no field definition`,
      })
    }
  }

  const boundProperties = new Set<string>()
  for (const binding of document.bindings) {
    const node = nodes.get(binding.nodeId)
    if (!fields.has(binding.fieldId) || !node) {
      issues.push({
        id: `binding:${binding.id}:reference`,
        severity: "error",
        code: "missing_reference",
        message: `Binding ${binding.id} has a missing field or node`,
        nodeId: binding.nodeId,
      })
      continue
    }
    const bindingTarget = `${binding.nodeId}:${binding.property}`
    if (boundProperties.has(bindingTarget)) {
      issues.push({
        id: `binding:${binding.id}:duplicate-target`,
        severity: "error",
        code: "invalid_binding",
        message: `${binding.property} on ${node.name} is bound more than once`,
        nodeId: node.id,
      })
    }
    boundProperties.add(bindingTarget)
    const field = fields.get(binding.fieldId)
    const compatible = field
      ? fieldCanBindToProperty(field, node, binding.property)
      : false
    if (!compatible) {
      issues.push({
        id: `binding:${binding.id}:property`,
        severity: "error",
        code: "invalid_binding",
        message: `${binding.property} cannot be bound to ${node.type}`,
        nodeId: node.id,
      })
    }
    const boundValue = field ? document.fieldValues[field.id] : undefined
    if (
      field?.type === "asset" &&
      (boundValue === undefined || boundValue === "")
    ) {
      issues.push({
        id: `binding:${binding.id}:empty-asset`,
        severity: "error",
        code: "missing_asset",
        message: `${field.label} needs an asset before it can be bound`,
        nodeId: node.id,
      })
    }
  }

  for (const binding of document.variableBindings) {
    try {
      assertVariableBindingCompatible(document, binding)
    } catch (error) {
      const target = binding.target
      issues.push({
        id: `variable-binding:${binding.id}:invalid`,
        severity: "error",
        code: "invalid_binding",
        message:
          error instanceof Error
            ? error.message
            : `Variable binding ${binding.id} is invalid`,
        ...(target.kind === "node" || target.kind === "text_range"
          ? { nodeId: target.nodeId }
          : {}),
      })
    }
  }

  for (const componentIssue of componentIntegrityIssues(document)) {
    const group = componentIssue.groupId
      ? groups.get(componentIssue.groupId)
      : undefined
    issues.push({
      id: `component:${componentIssue.componentId ?? "unknown"}:${componentIssue.instanceId ?? "definition"}:${componentIssue.code}:${componentIssue.nodeId ?? componentIssue.groupId ?? componentIssue.property ?? "document"}`,
      severity: "error",
      code: "invalid_component",
      message: componentIssue.message,
      ...(group ? { pageId: group.pageId } : {}),
      ...(componentIssue.nodeId ? { nodeId: componentIssue.nodeId } : {}),
    })
  }

  return issues
}
