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

  const directMembership = new Map<string, string>()
  for (const group of document.groups) {
    const page = pages.get(group.pageId)
    if (!page) {
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
