import { documentSchema } from "./schema"
import type { Document } from "./schema"
import {
  fieldCanBindToProperty,
  fieldDefinitionValidationMessage,
  fieldValueSatisfiesDefinition,
} from "./fields"
import { getGroupNodeIds } from "./groups"
import { managedImageAssetIdentity } from "./media"
import { projectTextLayout } from "./text-layout"

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
  const document = documentSchema.parse(input)
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
    if (!document.outputs.some((output) => output.id === page.outputId)) {
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
    if (
      group.nodeIds.length === 0 &&
      !document.groups.some((candidate) => candidate.parentGroupId === group.id)
    ) {
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
      if (!nodes.has(nodeId) || !page.nodeIds.includes(nodeId)) {
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

    const descendantNodeIds = getGroupNodeIds(document, group.id)
    const descendantIndexes = descendantNodeIds
      .map((nodeId) => page.nodeIds.indexOf(nodeId))
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

  return issues
}
