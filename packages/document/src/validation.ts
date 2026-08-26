import type { Document } from "./schema"

export type ValidationIssue = {
  id: string
  severity: "error" | "warning"
  code:
    | "missing_reference"
    | "text_overflow"
    | "empty_required_field"
    | "invalid_group"
  message: string
  pageId?: string
  nodeId?: string
}

export function validateDocument(document: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const pages = new Map(document.pages.map((page) => [page.id, page]))
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const fields = new Map(document.fields.map((field) => [field.id, field]))
  const groups = new Map(document.groups.map((group) => [group.id, group]))

  for (const output of document.outputs) {
    for (const pageId of output.pageIds) {
      if (!pages.has(pageId)) {
        issues.push({
          id: `output:${output.id}:page:${pageId}`,
          severity: "error",
          code: "missing_reference",
          message: `${output.name} points to a missing page`,
          pageId,
        })
      }
    }
  }

  for (const page of document.pages) {
    for (const nodeId of page.nodeIds) {
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
      if (
        node.type === "text" &&
        node.text.length * node.fontSize * 0.52 > node.width
      ) {
        issues.push({
          id: `node:${node.id}:overflow`,
          severity: "warning",
          code: "text_overflow",
          message: `${node.name} may overflow its text box`,
          pageId: page.id,
          nodeId: node.id,
        })
      }
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
    for (const nodeId of group.nodeIds) {
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
  }

  for (const binding of document.bindings) {
    if (!fields.has(binding.fieldId) || !nodes.has(binding.nodeId)) {
      issues.push({
        id: `binding:${binding.id}:reference`,
        severity: "error",
        code: "missing_reference",
        message: `Binding ${binding.id} has a missing field or node`,
        nodeId: binding.nodeId,
      })
    }
  }

  return issues
}
