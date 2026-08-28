import type { Document, SceneNode } from "./schema"
import type { ValidationIssue } from "./validation"
import {
  isRenderSafeImageSource,
  maxInlineImageCharacters,
} from "./image-source-policy"

export { isRenderSafeImageSource } from "./image-source-policy"

export const managedRendererFonts = ["Geist Variable"] as const
export type ManagedRendererFont = (typeof managedRendererFonts)[number]

export function isManagedRendererFont(
  fontFamily: string
): fontFamily is ManagedRendererFont {
  return managedRendererFonts.some((managed) => managed === fontFamily)
}

// Backward-compatible public name for existing publishing consumers.
export const supportedRendererFonts = managedRendererFonts

export const renderPolicyLimits = Object.freeze({
  maxOutputs: 8,
  maxPages: 40,
  maxNodes: 5_000,
  maxGroups: 5_000,
  maxPageDimension: 8_192,
  maxNodeDimension: 16_384,
  maxPagePixelArea: 33_554_432,
  maxDocumentPixelArea: 100_000_000,
  maxTextCharactersPerNode: 50_000,
  maxTextCharactersPerDocument: 500_000,
  maxSvgPathCharacters: 100_000,
  maxInlineImageCharacters,
  maxInlineImageCharactersPerPage: maxInlineImageCharacters,
})

const CSS_COLOR =
  /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|hsl)a?\([0-9.,%+\-/\s]+\)|transparent)$/i

const issue = (
  code:
    | "render_limit_exceeded"
    | "unsafe_render_value"
    | "unmanaged_asset"
    | "unsupported_font",
  message: string,
  target: { pageId?: string; nodeId?: string } = {}
): ValidationIssue => ({
  id: `render-policy:${code}:${target.pageId ?? "document"}:${target.nodeId ?? "value"}:${message}`,
  severity: "error",
  code,
  message,
  ...target,
})

export const isRenderSafeCssColor = (value: string): boolean =>
  value.length <= 128 && CSS_COLOR.test(value.trim())

const nodeColors = (node: SceneNode): string[] => {
  if (node.type === "text") return [node.color]
  if (node.type === "line") return [node.stroke]
  if (node.type === "image") return []
  return [node.fill, ...(node.stroke ? [node.stroke] : [])]
}

export function validateRenderPolicy(document: Document): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const limits = renderPolicyLimits

  if (document.outputs.length > limits.maxOutputs) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `A renderable document can contain at most ${limits.maxOutputs} outputs`
      )
    )
  }
  if (document.pages.length > limits.maxPages) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `A renderable document can contain at most ${limits.maxPages} pages`
      )
    )
  }
  if (document.nodes.length > limits.maxNodes) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `A renderable document can contain at most ${limits.maxNodes} layers`
      )
    )
  }
  if (document.groups.length > limits.maxGroups) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `A renderable document can contain at most ${limits.maxGroups} groups`
      )
    )
  }

  let documentPixelArea = 0
  for (const page of document.pages) {
    const pagePixelArea = page.width * page.height
    documentPixelArea += pagePixelArea
    if (
      page.width > limits.maxPageDimension ||
      page.height > limits.maxPageDimension ||
      pagePixelArea > limits.maxPagePixelArea
    ) {
      issues.push(
        issue(
          "render_limit_exceeded",
          `${page.name} exceeds the renderer page-dimension policy`,
          { pageId: page.id }
        )
      )
    }
    if (!isRenderSafeCssColor(page.background)) {
      issues.push(
        issue(
          "unsafe_render_value",
          `${page.name} uses an unsafe page background`,
          { pageId: page.id }
        )
      )
    }
  }
  if (documentPixelArea > limits.maxDocumentPixelArea) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `The document exceeds the ${limits.maxDocumentPixelArea.toLocaleString()}-pixel render budget`
      )
    )
  }

  let textCharacters = 0
  const pageIdByNodeId = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.id] as const)
    )
  )
  const inlineImageCharactersByPage = new Map<string, number>()
  for (const node of document.nodes) {
    if (
      node.width > limits.maxNodeDimension ||
      node.height > limits.maxNodeDimension
    ) {
      issues.push(
        issue(
          "render_limit_exceeded",
          `${node.name} exceeds the renderer layer-dimension policy`,
          { nodeId: node.id }
        )
      )
    }

    for (const color of nodeColors(node)) {
      if (!isRenderSafeCssColor(color)) {
        issues.push(
          issue(
            "unsafe_render_value",
            `${node.name} uses an unsafe color value`,
            { nodeId: node.id }
          )
        )
      }
    }

    if (node.type === "text") {
      textCharacters += node.text.length
      if (node.text.length > limits.maxTextCharactersPerNode) {
        issues.push(
          issue(
            "render_limit_exceeded",
            `${node.name} contains too much text to render`,
            { nodeId: node.id }
          )
        )
      }
      if (!isManagedRendererFont(node.fontFamily)) {
        issues.push(
          issue(
            "unsupported_font",
            `${node.name} uses a font that is unavailable to the renderer`,
            { nodeId: node.id }
          )
        )
      }
    }

    if (
      node.type === "icon" &&
      node.path.length > limits.maxSvgPathCharacters
    ) {
      issues.push(
        issue(
          "render_limit_exceeded",
          `${node.name} contains an oversized vector path`,
          { nodeId: node.id }
        )
      )
    }

    if (node.type === "image" && !isRenderSafeImageSource(node.src)) {
      issues.push(
        issue(
          "unmanaged_asset",
          `${node.name} must use an inline, network-isolated managed image`,
          { nodeId: node.id }
        )
      )
    }
    if (node.type === "image" && node.src.startsWith("data:image/")) {
      const pageId = pageIdByNodeId.get(node.id)
      if (pageId) {
        inlineImageCharactersByPage.set(
          pageId,
          (inlineImageCharactersByPage.get(pageId) ?? 0) + node.src.length
        )
      }
    }
  }

  for (const [pageId, characters] of inlineImageCharactersByPage) {
    if (characters <= limits.maxInlineImageCharactersPerPage) continue
    const page = document.pages.find((candidate) => candidate.id === pageId)
    issues.push(
      issue(
        "render_limit_exceeded",
        `${page?.name ?? pageId} exceeds the inline image render budget`,
        { pageId }
      )
    )
  }

  if (textCharacters > limits.maxTextCharactersPerDocument) {
    issues.push(
      issue(
        "render_limit_exceeded",
        `The document contains too much text to render safely`
      )
    )
  }

  return issues
}

export type RenderResourcePlan = {
  outputId: string
  format: "png" | "pdf"
  pageIds: string[]
  pageCount: number
  pixelArea: number
  estimatedStorageBytes: number
}

export function createRenderResourcePlan(
  document: Document,
  selection: {
    outputId: string
    format: "png" | "pdf"
    pageId?: string
  }
): RenderResourcePlan {
  const blocking = validateRenderPolicy(document)
  if (blocking.length) {
    throw new Error(blocking[0]!.message)
  }
  const output = document.outputs.find(
    (candidate) => candidate.id === selection.outputId
  )
  if (!output) throw new Error(`Unknown output ${selection.outputId}`)
  if (!output.exportFormats.includes(selection.format)) {
    throw new Error(`${selection.format} is not enabled for ${output.name}`)
  }
  const pageIds = selection.pageId ? [selection.pageId] : output.pageIds
  const pages = pageIds.map((pageId) => {
    const page = document.pages.find(
      (candidate) => candidate.id === pageId && candidate.outputId === output.id
    )
    if (!page) throw new Error(`Unknown page ${pageId} for ${output.name}`)
    return page
  })
  const pixelArea = pages.reduce(
    (total, page) => total + page.width * page.height,
    0
  )
  const estimatedStorageBytes =
    selection.format === "png"
      ? pixelArea * 4
      : Math.max(1_000_000, pages.length * 5_000_000)
  return {
    outputId: output.id,
    format: selection.format,
    pageIds: [...pageIds],
    pageCount: pages.length,
    pixelArea,
    estimatedStorageBytes,
  }
}
