import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { z } from "zod"
import {
  defaultImageFrameMask,
  defaultImagePlacement,
  fieldValidationSchema,
  fieldValueSchema,
  imageFrameMaskSchema,
  imagePlacementSchema,
  isSupportedFieldColor,
  nodeVariablePropertySchema,
  paintStyleVariablePropertySchema,
  textRangeVariablePropertySchema,
  textSizingModeSchema,
  typographyStyleVariablePropertySchema,
  type Document,
  type OutputVariant,
  type SceneNode,
} from "./schema"
import {
  STUDIO_DESIGN_PLAN_VERSION,
  studioBlankDocumentPresets,
  studioGenerationLimits,
} from "./generation-contract"
import { isManagedRendererFont, validateRenderPolicy } from "./render-policy"
import { assertValidDocument } from "./validation"

const localIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/, "Use a request-local ID")
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(studioGenerationLimits.maxNameCharacters)
const safeColorSchema = z
  .string()
  .max(128)
  .refine(
    (value) => isSupportedFieldColor(value) && value !== "",
    "Use a supported color"
  )
const finiteGeometrySchema = z.number().finite()

const baseNodeShape = {
  localId: localIdSchema,
  pageLocalId: localIdSchema,
  name: nameSchema,
  x: finiteGeometrySchema.nonnegative(),
  y: finiteGeometrySchema.nonnegative(),
  width: finiteGeometrySchema.positive(),
  height: finiteGeometrySchema.positive(),
  rotation: finiteGeometrySchema.min(-360).max(360).default(0),
  opacity: finiteGeometrySchema.min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
}

const optionalStyleReferences = {
  typographyStyleLocalId: localIdSchema.optional(),
  paintStyleLocalId: localIdSchema.optional(),
}

const textPlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("text"),
    text: z.string().max(studioGenerationLimits.maxTextCharacters),
    color: safeColorSchema,
    fontFamily: z.string().trim().min(1).max(200),
    fontSize: finiteGeometrySchema.positive().max(2_000),
    fontWeight: z.number().int().min(100).max(900),
    italic: z.boolean().default(false),
    decoration: z.enum(["none", "underline", "line_through"]).default("none"),
    lineHeight: finiteGeometrySchema.min(0.5).max(3).default(1.18),
    letterSpacing: finiteGeometrySchema.min(-20).max(200).default(0),
    align: z.enum(["left", "center", "right"]).default("left"),
    sizingMode: textSizingModeSchema.default("fixed"),
    ...optionalStyleReferences,
  })
  .strict()

const rectPlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("rect"),
    fill: safeColorSchema,
    radius: finiteGeometrySchema.nonnegative().default(0),
    stroke: safeColorSchema.optional(),
    strokeWidth: finiteGeometrySchema.nonnegative().default(0),
    paintStyleLocalId: localIdSchema.optional(),
  })
  .strict()

const ellipsePlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("ellipse"),
    fill: safeColorSchema,
    stroke: safeColorSchema.optional(),
    strokeWidth: finiteGeometrySchema.nonnegative().default(0),
    paintStyleLocalId: localIdSchema.optional(),
  })
  .strict()

const linePlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("line"),
    stroke: safeColorSchema,
    strokeWidth: finiteGeometrySchema.positive().max(1_000).default(2),
    paintStyleLocalId: localIdSchema.optional(),
  })
  .strict()

const iconPlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("icon"),
    path: z.string().min(1).max(studioGenerationLimits.maxIconPathCharacters),
    viewBox: z.string().trim().min(1).max(200).default("0 0 24 24"),
    fill: safeColorSchema,
    stroke: safeColorSchema.optional(),
    strokeWidth: finiteGeometrySchema.nonnegative().default(0),
    paintStyleLocalId: localIdSchema.optional(),
  })
  .strict()

const imagePlanNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal("image"),
    assetId: z.string().trim().min(1).max(200),
    placement: imagePlacementSchema.default(defaultImagePlacement),
    frameMask: imageFrameMaskSchema.default(defaultImageFrameMask),
    alt: z.string().max(2_000).default(""),
    decorative: z.boolean().default(false),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.decorative && node.alt !== "") {
      context.addIssue({
        code: "custom",
        path: ["alt"],
        message: "Decorative images must use an empty alternative description",
      })
    }
  })

export const studioDesignPlanNodeSchema = z.discriminatedUnion("type", [
  textPlanNodeSchema,
  rectPlanNodeSchema,
  ellipsePlanNodeSchema,
  linePlanNodeSchema,
  iconPlanNodeSchema,
  imagePlanNodeSchema,
])

const designPlanOutputSchema = z
  .object({
    localId: localIdSchema,
    name: nameSchema,
    kind: z.enum(["proposal", "social", "custom"]),
    pageLocalIds: z
      .array(localIdSchema)
      .min(1)
      .max(studioGenerationLimits.maxPages),
    exportFormats: z
      .array(z.enum(["png", "pdf"]))
      .min(1)
      .max(2)
      .refine(
        (formats) => new Set(formats).size === formats.length,
        "Export formats must be unique"
      ),
  })
  .strict()

const designPlanPageSchema = z
  .object({
    localId: localIdSchema,
    outputLocalId: localIdSchema,
    name: nameSchema,
    width: z
      .number()
      .int()
      .positive()
      .max(studioGenerationLimits.maxPageDimension),
    height: z
      .number()
      .int()
      .positive()
      .max(studioGenerationLimits.maxPageDimension),
    background: safeColorSchema,
    nodeLocalIds: z.array(localIdSchema).max(studioGenerationLimits.maxNodes),
  })
  .strict()

const organizeGroupPlanSchema = z
  .object({
    localId: localIdSchema,
    pageLocalId: localIdSchema,
    name: nameSchema,
    role: z.literal("organize"),
    nodeLocalIds: z
      .array(localIdSchema)
      .min(1)
      .max(studioGenerationLimits.maxNodes),
    parentGroupLocalId: localIdSchema.optional(),
  })
  .strict()

const maskGroupPlanSchema = z
  .object({
    localId: localIdSchema,
    pageLocalId: localIdSchema,
    name: nameSchema,
    role: z.literal("mask"),
    nodeLocalIds: z
      .array(localIdSchema)
      .min(1)
      .max(studioGenerationLimits.maxNodes),
    parentGroupLocalId: localIdSchema.optional(),
    mask: z
      .object({
        type: z.enum(["vector", "alpha", "luminance"]),
        sourceNodeLocalIds: z.array(localIdSchema).min(1).max(4),
      })
      .strict(),
  })
  .strict()

const typographyStylePlanSchema = z
  .object({
    localId: localIdSchema,
    name: nameSchema,
    fontFamily: z.string().trim().min(1).max(200),
    fontSize: finiteGeometrySchema.positive().max(2_000),
    fontWeight: z.number().int().min(100).max(900),
    italic: z.boolean(),
    lineHeight: finiteGeometrySchema.min(0.5).max(3),
    letterSpacing: finiteGeometrySchema.min(-20).max(200),
    decoration: z.enum(["none", "underline", "line_through"]),
  })
  .strict()

const paintStylePlanSchema = z
  .object({
    localId: localIdSchema,
    name: nameSchema,
    color: safeColorSchema,
    opacity: finiteGeometrySchema.min(0).max(1),
  })
  .strict()

const variablePlanSchema = z.discriminatedUnion("type", [
  z
    .object({
      localId: localIdSchema,
      name: nameSchema,
      type: z.literal("color"),
      value: safeColorSchema,
    })
    .strict(),
  z
    .object({
      localId: localIdSchema,
      name: nameSchema,
      type: z.literal("number"),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      localId: localIdSchema,
      name: nameSchema,
      type: z.literal("string"),
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      localId: localIdSchema,
      name: nameSchema,
      type: z.literal("font_family"),
      value: z.string().trim().min(1).max(200),
    })
    .strict(),
])

const variableBindingPlanSchema = z
  .object({
    localId: localIdSchema,
    variableLocalId: localIdSchema,
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("node"),
          nodeLocalId: localIdSchema,
          property: nodeVariablePropertySchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("text_range"),
          nodeLocalId: localIdSchema,
          range: z
            .object({
              start: z.number().int().nonnegative(),
              end: z.number().int().positive(),
            })
            .strict(),
          property: textRangeVariablePropertySchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("typography_style"),
          styleLocalId: localIdSchema,
          property: typographyStyleVariablePropertySchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("paint_style"),
          styleLocalId: localIdSchema,
          property: paintStyleVariablePropertySchema,
        })
        .strict(),
    ]),
  })
  .strict()

const fieldPlanSchema = z
  .object({
    localId: localIdSchema,
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(120),
    label: nameSchema,
    type: z.enum([
      "text",
      "number",
      "currency",
      "date",
      "asset",
      "color",
      "choice",
      "boolean",
    ]),
    required: z.boolean().default(false),
    defaultValue: fieldValueSchema,
    agentDescription: z.string().max(1_000).default(""),
    validation: fieldValidationSchema.default({}),
  })
  .strict()

const fieldBindingPlanSchema = z
  .object({
    localId: localIdSchema,
    fieldLocalId: localIdSchema,
    nodeLocalId: localIdSchema,
    property: z.enum(["text", "src", "visible", "fill"]),
  })
  .strict()

export const studioDesignPlanSchema = z
  .object({
    version: z.literal(STUDIO_DESIGN_PLAN_VERSION),
    documentName: z.string().trim().min(1).max(80),
    outputs: z
      .array(designPlanOutputSchema)
      .min(1)
      .max(studioGenerationLimits.maxOutputs),
    pages: z
      .array(designPlanPageSchema)
      .min(1)
      .max(studioGenerationLimits.maxPages),
    nodes: z
      .array(studioDesignPlanNodeSchema)
      .max(studioGenerationLimits.maxNodes),
    groups: z
      .array(
        z.discriminatedUnion("role", [
          organizeGroupPlanSchema,
          maskGroupPlanSchema,
        ])
      )
      .max(studioGenerationLimits.maxGroups)
      .default([]),
    typographyStyles: z
      .array(typographyStylePlanSchema)
      .max(studioGenerationLimits.maxTypographyStyles)
      .default([]),
    paintStyles: z
      .array(paintStylePlanSchema)
      .max(studioGenerationLimits.maxPaintStyles)
      .default([]),
    variables: z
      .array(variablePlanSchema)
      .max(studioGenerationLimits.maxVariables)
      .default([]),
    variableBindings: z
      .array(variableBindingPlanSchema)
      .max(studioGenerationLimits.maxBindings)
      .default([]),
    fields: z
      .array(fieldPlanSchema)
      .max(studioGenerationLimits.maxFields)
      .default([]),
    bindings: z
      .array(fieldBindingPlanSchema)
      .max(studioGenerationLimits.maxBindings)
      .default([]),
  })
  .strict()

export type StudioDesignPlan = z.infer<typeof studioDesignPlanSchema>

export type ApprovedGenerationAsset = Readonly<{
  id: string
  src: string
  selectable: boolean
}>

export type DesignPlanCompileOptions = Readonly<{
  presetId: string
  requestId: string
  idempotencyKey: string
  now: string
  approvedAssets: ReadonlyMap<string, ApprovedGenerationAsset>
}>

export type DesignPlanCompilationErrorCode =
  | "invalid_plan"
  | "budget_exceeded"
  | "duplicate_local_id"
  | "unknown_reference"
  | "invalid_relationship"
  | "unsupported_font"
  | "unapproved_asset"
  | "invalid_geometry"
  | "render_policy_failed"

export class DesignPlanCompilationError extends Error {
  constructor(
    readonly code: DesignPlanCompilationErrorCode,
    message: string,
    readonly path?: string
  ) {
    super(message)
    this.name = "DesignPlanCompilationError"
  }
}

const fail = (
  code: DesignPlanCompilationErrorCode,
  message: string,
  path?: string
): never => {
  throw new DesignPlanCompilationError(code, message, path)
}

const canonicalIdFactory = (requestId: string, idempotencyKey: string) => {
  const seed = `${requestId}\u0000${idempotencyKey}`
  return (kind: string, localId: string) => {
    const digest = bytesToHex(
      sha256(utf8ToBytes(`${seed}\u0000${kind}\u0000${localId}`))
    )
    return `${kind}-${digest.slice(0, 32)}`
  }
}

const uniqueLocalIds = (plan: StudioDesignPlan) => {
  const entries = [
    ...plan.outputs.map((item) => [item.localId, "outputs"] as const),
    ...plan.pages.map((item) => [item.localId, "pages"] as const),
    ...plan.nodes.map((item) => [item.localId, "nodes"] as const),
    ...plan.groups.map((item) => [item.localId, "groups"] as const),
    ...plan.typographyStyles.map(
      (item) => [item.localId, "typographyStyles"] as const
    ),
    ...plan.paintStyles.map((item) => [item.localId, "paintStyles"] as const),
    ...plan.variables.map((item) => [item.localId, "variables"] as const),
    ...plan.variableBindings.map(
      (item) => [item.localId, "variableBindings"] as const
    ),
    ...plan.fields.map((item) => [item.localId, "fields"] as const),
    ...plan.bindings.map((item) => [item.localId, "bindings"] as const),
  ]
  const seen = new Map<string, string>()
  for (const [localId, collection] of entries) {
    const previous = seen.get(localId)
    if (previous) {
      fail(
        "duplicate_local_id",
        `Local ID ${localId} is used in both ${previous} and ${collection}.`,
        collection
      )
    }
    seen.set(localId, collection)
  }
}

const requireReference = <Value>(
  map: ReadonlyMap<string, Value>,
  localId: string,
  path: string
) =>
  map.get(localId) ??
  fail("unknown_reference", `Unknown local ID ${localId}.`, path)

const assertUniqueReferences = (values: readonly string[], path: string) => {
  if (new Set(values).size !== values.length) {
    fail(
      "invalid_relationship",
      `${path} must not contain duplicate local IDs.`,
      path
    )
  }
}

const assertGroupDepth = (plan: StudioDesignPlan) => {
  const groups = new Map(plan.groups.map((group) => [group.localId, group]))
  for (const group of plan.groups) {
    const visited = new Set<string>()
    let current: typeof group | undefined = group
    let depth = 0
    while (current) {
      if (visited.has(current.localId)) {
        fail(
          "invalid_relationship",
          `Group ${group.localId} contains a parent cycle.`,
          "groups"
        )
      }
      visited.add(current.localId)
      depth += 1
      if (depth > studioGenerationLimits.maxGroupDepth) {
        fail(
          "budget_exceeded",
          `Group ${group.localId} exceeds the maximum nesting depth of ${studioGenerationLimits.maxGroupDepth}.`,
          "groups"
        )
      }
      current = current.parentGroupLocalId
        ? requireReference(
            groups,
            current.parentGroupLocalId,
            "groups.parentGroupLocalId"
          )
        : undefined
    }
  }
}

const canonicalOutputKind = (
  kind: StudioDesignPlan["outputs"][number]["kind"],
  pages: readonly StudioDesignPlan["pages"][number][]
): OutputVariant["kind"] =>
  kind === "social"
    ? pages.every((page) => page.width === page.height)
      ? "square"
      : "custom"
    : kind

export function compileStudioDesignPlan(
  input: unknown,
  options: DesignPlanCompileOptions
): Document {
  const normalizedBytes = utf8ToBytes(JSON.stringify(input)).byteLength
  if (normalizedBytes > studioGenerationLimits.maxRequestBytes) {
    fail(
      "budget_exceeded",
      `Design Plan uses ${normalizedBytes} bytes; the limit is ${studioGenerationLimits.maxRequestBytes}.`
    )
  }
  const parsed = studioDesignPlanSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    fail(
      "invalid_plan",
      issue?.message ?? "The Studio Design Plan is invalid.",
      issue?.path.join(".")
    )
  }
  const plan = parsed.data!
  const preset = studioBlankDocumentPresets.find(
    (candidate) => candidate.id === options.presetId
  )!
  if (!preset)
    fail(
      "invalid_plan",
      `Unknown blank preset: ${options.presetId}.`,
      "presetId"
    )
  uniqueLocalIds(plan)
  assertGroupDepth(plan)

  const outputPlans = new Map(
    plan.outputs.map((output) => [output.localId, output])
  )
  const pagePlans = new Map(plan.pages.map((page) => [page.localId, page]))
  const nodePlans = new Map(plan.nodes.map((node) => [node.localId, node]))
  const typographyPlans = new Map(
    plan.typographyStyles.map((style) => [style.localId, style])
  )
  const paintPlans = new Map(
    plan.paintStyles.map((style) => [style.localId, style])
  )
  for (const page of plan.pages) {
    requireReference(outputPlans, page.outputLocalId, "pages.outputLocalId")
    assertUniqueReferences(
      page.nodeLocalIds,
      `pages.${page.localId}.nodeLocalIds`
    )
    if (page.width !== preset.width || page.height !== preset.height) {
      fail(
        "invalid_geometry",
        `Page ${page.localId} must match ${preset.name} at ${preset.width} × ${preset.height}.`,
        `pages.${page.localId}`
      )
    }
    if (page.width * page.height > studioGenerationLimits.maxPagePixelArea) {
      fail(
        "budget_exceeded",
        `Page ${page.localId} exceeds the page pixel-area limit.`,
        `pages.${page.localId}`
      )
    }
    for (const nodeLocalId of page.nodeLocalIds) {
      const node = requireReference(
        nodePlans,
        nodeLocalId,
        `pages.${page.localId}.nodeLocalIds`
      )
      if (node.pageLocalId !== page.localId) {
        fail(
          "invalid_relationship",
          `Node ${nodeLocalId} points to ${node.pageLocalId}, not ${page.localId}.`,
          `nodes.${nodeLocalId}.pageLocalId`
        )
      }
    }
  }
  for (const node of plan.nodes) {
    const page = requireReference(
      pagePlans,
      node.pageLocalId,
      `nodes.${node.localId}.pageLocalId`
    )
    if (!page.nodeLocalIds.includes(node.localId)) {
      fail(
        "invalid_relationship",
        `Page ${page.localId} does not order node ${node.localId}.`,
        `pages.${page.localId}.nodeLocalIds`
      )
    }
    if (
      node.x + node.width > page.width ||
      node.y + node.height > page.height
    ) {
      fail(
        "invalid_geometry",
        `Node ${node.localId} extends outside page ${page.localId}.`,
        `nodes.${node.localId}`
      )
    }
    if (node.type === "text") {
      if (!isManagedRendererFont(node.fontFamily)) {
        fail(
          "unsupported_font",
          `Font ${node.fontFamily} is not available in Studio.`,
          `nodes.${node.localId}.fontFamily`
        )
      }
      if (node.typographyStyleLocalId)
        requireReference(
          typographyPlans,
          node.typographyStyleLocalId,
          `nodes.${node.localId}.typographyStyleLocalId`
        )
      if (node.paintStyleLocalId)
        requireReference(
          paintPlans,
          node.paintStyleLocalId,
          `nodes.${node.localId}.paintStyleLocalId`
        )
    } else if ("paintStyleLocalId" in node && node.paintStyleLocalId) {
      requireReference(
        paintPlans,
        node.paintStyleLocalId,
        `nodes.${node.localId}.paintStyleLocalId`
      )
    }
    if (node.type === "image") {
      const asset = options.approvedAssets.get(node.assetId)
      if (!asset || !asset.selectable) {
        fail(
          "unapproved_asset",
          `Asset ${node.assetId} is not approved for generation.`,
          `nodes.${node.localId}.assetId`
        )
      }
    }
  }
  for (const output of plan.outputs) {
    assertUniqueReferences(
      output.pageLocalIds,
      `outputs.${output.localId}.pageLocalIds`
    )
    const ownedPages = output.pageLocalIds.map((pageLocalId) =>
      requireReference(
        pagePlans,
        pageLocalId,
        `outputs.${output.localId}.pageLocalIds`
      )
    )
    if (ownedPages.some((page) => page.outputLocalId !== output.localId)) {
      fail(
        "invalid_relationship",
        `Output ${output.localId} lists a page owned by another output.`,
        `outputs.${output.localId}.pageLocalIds`
      )
    }
    const missing = plan.pages.some(
      (page) =>
        page.outputLocalId === output.localId &&
        !output.pageLocalIds.includes(page.localId)
    )
    if (missing) {
      fail(
        "invalid_relationship",
        `Output ${output.localId} omits one of its pages.`,
        `outputs.${output.localId}.pageLocalIds`
      )
    }
  }

  const createId = canonicalIdFactory(options.requestId, options.idempotencyKey)
  const ids = {
    output: new Map(
      plan.outputs.map((item) => [
        item.localId,
        createId("output", item.localId),
      ])
    ),
    page: new Map(
      plan.pages.map((item) => [item.localId, createId("page", item.localId)])
    ),
    node: new Map(
      plan.nodes.map((item) => [item.localId, createId("node", item.localId)])
    ),
    group: new Map(
      plan.groups.map((item) => [item.localId, createId("group", item.localId)])
    ),
    typography: new Map(
      plan.typographyStyles.map((item) => [
        item.localId,
        createId("typography", item.localId),
      ])
    ),
    paint: new Map(
      plan.paintStyles.map((item) => [
        item.localId,
        createId("paint", item.localId),
      ])
    ),
    variable: new Map(
      plan.variables.map((item) => [
        item.localId,
        createId("variable", item.localId),
      ])
    ),
    variableBinding: new Map(
      plan.variableBindings.map((item) => [
        item.localId,
        createId("variable-binding", item.localId),
      ])
    ),
    field: new Map(
      plan.fields.map((item) => [item.localId, createId("field", item.localId)])
    ),
    binding: new Map(
      plan.bindings.map((item) => [
        item.localId,
        createId("binding", item.localId),
      ])
    ),
  }
  const id = (
    map: ReadonlyMap<string, string>,
    localId: string,
    path: string
  ) => requireReference(map, localId, path)

  const nodes: SceneNode[] = plan.nodes.map((node) => {
    const common = {
      id: id(ids.node, node.localId, "nodes"),
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      opacity: node.opacity,
      visible: node.visible,
      locked: node.locked,
      constraints: { horizontal: "min" as const, vertical: "min" as const },
    }
    if (node.type === "text") {
      return {
        ...common,
        type: "text",
        text: node.text,
        runs: [],
        paragraphs: [],
        links: [],
        color: node.color,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        italic: node.italic,
        decoration: node.decoration,
        lineHeight: node.lineHeight,
        letterSpacing: node.letterSpacing,
        align: node.align,
        sizingMode: node.sizingMode,
        ...(node.typographyStyleLocalId
          ? {
              typographyStyleId: id(
                ids.typography,
                node.typographyStyleLocalId,
                "nodes.typographyStyleLocalId"
              ),
            }
          : {}),
        ...(node.paintStyleLocalId
          ? {
              paintStyleId: id(
                ids.paint,
                node.paintStyleLocalId,
                "nodes.paintStyleLocalId"
              ),
            }
          : {}),
      }
    }
    if (node.type === "image") {
      const asset = options.approvedAssets.get(node.assetId)!
      return {
        ...common,
        type: "image",
        assetId: asset.id,
        src: asset.src,
        placement: node.placement,
        frameMask: node.frameMask,
        alt: node.alt,
        altProvenance: "generated",
        decorative: node.decorative,
      }
    }
    return {
      ...common,
      ...Object.fromEntries(
        Object.entries(node).filter(
          ([key]) =>
            ![
              "localId",
              "pageLocalId",
              "name",
              "x",
              "y",
              "width",
              "height",
              "rotation",
              "opacity",
              "visible",
              "locked",
              "paintStyleLocalId",
            ].includes(key)
        )
      ),
      ...(node.paintStyleLocalId
        ? {
            paintStyleId: id(
              ids.paint,
              node.paintStyleLocalId,
              "nodes.paintStyleLocalId"
            ),
          }
        : {}),
    } as SceneNode
  })

  const fields = plan.fields.map((field) => {
    const defaultValue =
      field.type === "asset" &&
      typeof field.defaultValue === "string" &&
      field.defaultValue
        ? (options.approvedAssets.get(field.defaultValue)?.src ??
          fail(
            "unapproved_asset",
            `Asset ${field.defaultValue} is not approved for field ${field.key}.`,
            `fields.${field.localId}.defaultValue`
          ))
        : field.defaultValue
    return {
      id: id(ids.field, field.localId, "fields"),
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      defaultValue,
      agentDescription: field.agentDescription,
      validation: field.validation,
    }
  })

  const document = assertValidDocument({
    schemaVersion: 6,
    id: createId("document", "root"),
    name: plan.documentName,
    revision: 0,
    createdAt: options.now,
    updatedAt: options.now,
    outputs: plan.outputs.map((output) => {
      const pages = output.pageLocalIds.map((pageLocalId) =>
        requireReference(pagePlans, pageLocalId, "outputs.pageLocalIds")
      )
      return {
        id: id(ids.output, output.localId, "outputs"),
        name: output.name,
        kind: canonicalOutputKind(output.kind, pages),
        pageIds: output.pageLocalIds.map((pageLocalId) =>
          id(ids.page, pageLocalId, "outputs.pageLocalIds")
        ),
        exportFormats: output.exportFormats,
      }
    }),
    pages: plan.pages.map((page) => ({
      id: id(ids.page, page.localId, "pages"),
      outputId: id(ids.output, page.outputLocalId, "pages.outputLocalId"),
      name: page.name,
      width: page.width,
      height: page.height,
      background: page.background,
      nodeIds: page.nodeLocalIds.map((nodeLocalId) =>
        id(ids.node, nodeLocalId, "pages.nodeLocalIds")
      ),
    })),
    nodes,
    groups: plan.groups.map((group) => ({
      id: id(ids.group, group.localId, "groups"),
      pageId: id(ids.page, group.pageLocalId, "groups.pageLocalId"),
      name: group.name,
      role: group.role,
      nodeIds: group.nodeLocalIds.map((nodeLocalId) =>
        id(ids.node, nodeLocalId, "groups.nodeLocalIds")
      ),
      ...(group.parentGroupLocalId
        ? {
            parentGroupId: id(
              ids.group,
              group.parentGroupLocalId,
              "groups.parentGroupLocalId"
            ),
          }
        : {}),
      ...(group.role === "mask"
        ? {
            mask: {
              type: group.mask.type,
              sourceNodeIds: group.mask.sourceNodeLocalIds.map((nodeLocalId) =>
                id(ids.node, nodeLocalId, "groups.mask.sourceNodeLocalIds")
              ) as [string, ...string[]],
            },
          }
        : {}),
    })),
    components: [],
    componentInstances: [],
    typographyStyles: plan.typographyStyles.map(({ localId, ...style }) => ({
      ...style,
      id: id(ids.typography, localId, "typographyStyles"),
    })),
    paintStyles: plan.paintStyles.map(({ localId, ...style }) => ({
      ...style,
      id: id(ids.paint, localId, "paintStyles"),
    })),
    variables: plan.variables.map(({ localId, ...variable }) => ({
      ...variable,
      id: id(ids.variable, localId, "variables"),
    })),
    variableBindings: plan.variableBindings.map((binding) => ({
      id: id(ids.variableBinding, binding.localId, "variableBindings"),
      variableId: id(
        ids.variable,
        binding.variableLocalId,
        "variableBindings.variableLocalId"
      ),
      target: (() => {
        if (
          binding.target.kind === "node" ||
          binding.target.kind === "text_range"
        ) {
          const { nodeLocalId, ...target } = binding.target
          return {
            ...target,
            nodeId: id(
              ids.node,
              nodeLocalId,
              "variableBindings.target.nodeLocalId"
            ),
          }
        }
        const { styleLocalId, ...target } = binding.target
        return {
          ...target,
          styleId: id(
            binding.target.kind === "typography_style"
              ? ids.typography
              : ids.paint,
            styleLocalId,
            "variableBindings.target.styleLocalId"
          ),
        }
      })(),
    })),
    fields,
    fieldValues: Object.fromEntries(
      fields.map((field) => [field.id, field.defaultValue])
    ),
    bindings: plan.bindings.map((binding) => ({
      id: id(ids.binding, binding.localId, "bindings"),
      fieldId: id(ids.field, binding.fieldLocalId, "bindings.fieldLocalId"),
      nodeId: id(ids.node, binding.nodeLocalId, "bindings.nodeLocalId"),
      property: binding.property,
    })),
  })
  const policyErrors = validateRenderPolicy(document).filter(
    (issue) => issue.severity === "error"
  )
  if (policyErrors.length) {
    fail(
      "render_policy_failed",
      policyErrors[0]!.message,
      policyErrors[0]!.nodeId
    )
  }
  return document
}
