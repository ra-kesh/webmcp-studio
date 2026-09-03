import { z } from "zod"
import {
  documentSchema,
  type Document,
  type FillPaint,
  type GroupDefinition,
  type SceneNode,
} from "./schema"

export const studioInterchangeFormat = "webmcp-studio-interchange" as const
export const studioInterchangeVersion = 1 as const

export const studioInterchangeTargetSchema = z.enum(["figma", "canva"])

export const studioInterchangeAssetSchema = z
  .object({
    assetId: z.string().min(1),
    source: z.string().min(1),
    sourceKind: z.enum(["managed", "curated", "local", "remote", "inline"]),
    nodeIds: z.array(z.string().min(1)).min(1),
  })
  .strict()

export const studioInterchangeFontSchema = z
  .object({
    family: z.string().min(1),
    weights: z.array(z.number().int().min(100).max(900)).min(1),
    styles: z.array(z.enum(["normal", "italic"])).min(1),
    nodeIds: z.array(z.string().min(1)),
    styleIds: z.array(z.string().min(1)),
  })
  .strict()

export const studioInterchangeCompatibilityIssueSchema = z
  .object({
    id: z.string().min(1),
    target: studioInterchangeTargetSchema,
    scope: z.enum(["document", "node", "group", "font"]),
    sourceId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    fallback: z.enum([
      "native",
      "metadata_only",
      "font_substitution",
      "selective_rasterization",
    ]),
  })
  .strict()

export const studioInterchangeCompatibilityReportSchema = z
  .object({
    target: studioInterchangeTargetSchema,
    nativeLayerCount: z.number().int().nonnegative(),
    fallbackLayerCount: z.number().int().nonnegative(),
    issues: z.array(studioInterchangeCompatibilityIssueSchema),
  })
  .strict()

export const studioInterchangePackageSchema = z
  .object({
    format: z.literal(studioInterchangeFormat),
    version: z.literal(studioInterchangeVersion),
    exportedAt: z.string().datetime(),
    source: z
      .object({
        documentId: z.string().min(1),
        documentName: z.string().min(1),
        documentRevision: z.number().int().nonnegative(),
        schemaVersion: z.literal(6),
      })
      .strict(),
    document: documentSchema,
    assets: z.array(studioInterchangeAssetSchema),
    fonts: z.array(studioInterchangeFontSchema),
    compatibility: z
      .object({
        figma: studioInterchangeCompatibilityReportSchema,
        canva: studioInterchangeCompatibilityReportSchema,
      })
      .strict(),
  })
  .strict()

export type StudioInterchangeTarget = z.infer<
  typeof studioInterchangeTargetSchema
>
export type StudioInterchangeAsset = z.infer<
  typeof studioInterchangeAssetSchema
>
export type StudioInterchangeFont = z.infer<typeof studioInterchangeFontSchema>
export type StudioInterchangeCompatibilityIssue = z.infer<
  typeof studioInterchangeCompatibilityIssueSchema
>
export type StudioInterchangeCompatibilityReport = z.infer<
  typeof studioInterchangeCompatibilityReportSchema
>
export type StudioInterchangePackage = z.infer<
  typeof studioInterchangePackageSchema
>

type AssetAccumulator = {
  assetId: string
  source: string
  sourceKind: StudioInterchangeAsset["sourceKind"]
  nodeIds: Set<string>
}

type FontAccumulator = {
  family: string
  weights: Set<number>
  styles: Set<"normal" | "italic">
  nodeIds: Set<string>
  styleIds: Set<string>
}

const sourceKind = (source: string): StudioInterchangeAsset["sourceKind"] => {
  if (source.startsWith("asset:managed/")) return "managed"
  if (source.startsWith("asset:local/")) return "local"
  if (source.startsWith("/assets/")) return "curated"
  if (source.startsWith("data:")) return "inline"
  return "remote"
}

const collectPaintAssets = (
  node: SceneNode,
  paints: readonly FillPaint[],
  assets: Map<string, AssetAccumulator>
) => {
  for (const paint of paints) {
    if (paint.type !== "image") continue
    collectAsset(node.id, paint.assetId, paint.src, assets)
  }
}

const collectAsset = (
  nodeId: string,
  assetId: string,
  source: string,
  assets: Map<string, AssetAccumulator>
) => {
  const key = `${assetId}\u0000${source}`
  const current = assets.get(key) ?? {
    assetId,
    source,
    sourceKind: sourceKind(source),
    nodeIds: new Set<string>(),
  }
  current.nodeIds.add(nodeId)
  assets.set(key, current)
}

const collectFont = (
  fonts: Map<string, FontAccumulator>,
  family: string,
  weight: number,
  italic: boolean,
  source: { nodeId?: string; styleId?: string }
) => {
  const current = fonts.get(family) ?? {
    family,
    weights: new Set<number>(),
    styles: new Set<"normal" | "italic">(),
    nodeIds: new Set<string>(),
    styleIds: new Set<string>(),
  }
  current.weights.add(weight)
  current.styles.add(italic ? "italic" : "normal")
  if (source.nodeId) current.nodeIds.add(source.nodeId)
  if (source.styleId) current.styleIds.add(source.styleId)
  fonts.set(family, current)
}

const collectAssets = (document: Document): StudioInterchangeAsset[] => {
  const assets = new Map<string, AssetAccumulator>()
  for (const node of document.nodes) {
    if (node.type === "image") {
      collectAsset(node.id, node.assetId, node.src, assets)
    }
    if ("fills" in node && node.fills) {
      collectPaintAssets(node, node.fills, assets)
    }
  }
  return [...assets.values()]
    .map((asset) => ({
      ...asset,
      nodeIds: [...asset.nodeIds].sort(),
    }))
    .sort((left, right) =>
      `${left.assetId}\u0000${left.source}`.localeCompare(
        `${right.assetId}\u0000${right.source}`
      )
    )
}

const collectFonts = (document: Document): StudioInterchangeFont[] => {
  const fonts = new Map<string, FontAccumulator>()
  for (const node of document.nodes) {
    if (node.type !== "text") continue
    collectFont(fonts, node.fontFamily, node.fontWeight, node.italic, {
      nodeId: node.id,
    })
    for (const run of node.runs) {
      collectFont(
        fonts,
        run.style.fontFamily ?? node.fontFamily,
        run.style.fontWeight ?? node.fontWeight,
        run.style.italic ?? node.italic,
        { nodeId: node.id }
      )
    }
  }
  for (const style of document.typographyStyles) {
    collectFont(fonts, style.fontFamily, style.fontWeight, style.italic, {
      styleId: style.id,
    })
  }
  return [...fonts.values()]
    .map((font) => ({
      family: font.family,
      weights: [...font.weights].sort((left, right) => left - right),
      styles: [...font.styles].sort(),
      nodeIds: [...font.nodeIds].sort(),
      styleIds: [...font.styleIds].sort(),
    }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

const issue = (
  target: StudioInterchangeTarget,
  scope: StudioInterchangeCompatibilityIssue["scope"],
  sourceId: string,
  code: string,
  message: string,
  fallback: StudioInterchangeCompatibilityIssue["fallback"]
): StudioInterchangeCompatibilityIssue => ({
  id: `${target}:${scope}:${sourceId}:${code}`,
  target,
  scope,
  sourceId,
  code,
  message,
  fallback,
})

const nodeIssues = (
  node: SceneNode,
  target: StudioInterchangeTarget
): StudioInterchangeCompatibilityIssue[] => {
  const issues: StudioInterchangeCompatibilityIssue[] = []
  if (
    target === "canva" &&
    ["icon", "vector", "boolean_result"].includes(node.type)
  ) {
    issues.push(
      issue(
        target,
        "node",
        node.id,
        "custom-vector",
        "Canva may not reproduce this custom path exactly.",
        "selective_rasterization"
      )
    )
  }
  if (target === "canva" && (node.effects?.length ?? 0) > 0) {
    issues.push(
      issue(
        target,
        "node",
        node.id,
        "effects",
        "Canva does not expose every Studio effect through its editing API.",
        "selective_rasterization"
      )
    )
  }
  if (target === "canva" && node.blendMode && node.blendMode !== "normal") {
    issues.push(
      issue(
        target,
        "node",
        node.id,
        "blend-mode",
        "Canva may not preserve this blend mode.",
        "selective_rasterization"
      )
    )
  }
  return issues
}

const groupIssues = (
  group: GroupDefinition,
  target: StudioInterchangeTarget
): StudioInterchangeCompatibilityIssue[] => {
  if (group.role !== "mask") return []
  if (target === "figma" && group.mask.type === "vector") return []
  return [
    issue(
      target,
      "group",
      group.id,
      `${group.mask.type}-mask`,
      `${target === "figma" ? "Figma" : "Canva"} may not preserve this ${group.mask.type} mask exactly.`,
      "selective_rasterization"
    ),
  ]
}

const documentIssues = (
  document: Document,
  target: StudioInterchangeTarget
): StudioInterchangeCompatibilityIssue[] => {
  const issues: StudioInterchangeCompatibilityIssue[] = []
  if (document.bindings.length > 0 || document.variableBindings.length > 0) {
    issues.push(
      issue(
        target,
        "document",
        document.id,
        "studio-bindings",
        "Studio field and variable bindings are retained as metadata but are not native target bindings.",
        "metadata_only"
      )
    )
  }
  if (
    document.components.length > 0 ||
    document.componentInstances.length > 0
  ) {
    issues.push(
      issue(
        target,
        "document",
        document.id,
        "studio-components",
        "Studio component identity is retained as metadata unless the target importer maps it explicitly.",
        "metadata_only"
      )
    )
  }
  return issues
}

export const createStudioInterchangeCompatibilityReport = (
  document: Document,
  target: StudioInterchangeTarget
): StudioInterchangeCompatibilityReport => {
  const issues = [
    ...document.nodes.flatMap((node) => nodeIssues(node, target)),
    ...document.groups.flatMap((group) => groupIssues(group, target)),
    ...documentIssues(document, target),
  ]
  const fallbackNodeIds = new Set(
    issues
      .filter(
        (entry) =>
          entry.scope === "node" && entry.fallback === "selective_rasterization"
      )
      .map((entry) => entry.sourceId)
  )
  return {
    target,
    nativeLayerCount: document.nodes.length - fallbackNodeIds.size,
    fallbackLayerCount: fallbackNodeIds.size,
    issues,
  }
}

export const createStudioInterchangePackage = (
  document: Document,
  options: Readonly<{ exportedAt?: string }> = {}
): StudioInterchangePackage =>
  studioInterchangePackageSchema.parse({
    format: studioInterchangeFormat,
    version: studioInterchangeVersion,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    source: {
      documentId: document.id,
      documentName: document.name,
      documentRevision: document.revision,
      schemaVersion: document.schemaVersion,
    },
    document,
    assets: collectAssets(document),
    fonts: collectFonts(document),
    compatibility: {
      figma: createStudioInterchangeCompatibilityReport(document, "figma"),
      canva: createStudioInterchangeCompatibilityReport(document, "canva"),
    },
  })

export const decodeStudioInterchangePackage = (
  input: unknown
): StudioInterchangePackage => studioInterchangePackageSchema.parse(input)
