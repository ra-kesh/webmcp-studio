import { z } from "zod"
import { isRenderSafeImageSource } from "./image-source-policy"
import {
  textDecorationSchema,
  textLinkSchema,
  textParagraphSchema,
  textRunSchema,
} from "./rich-text"
import {
  CURATED_ASSET_PATH_PREFIX,
  LOCAL_ASSET_PREFIX,
  MANAGED_ASSET_PREFIX,
  curatedAssetSourceSchema,
  curatedImageAssetIdentity,
  localAssetIdSchema,
  localAssetSourceSchema,
  localImageAssetIdentity,
  managedAssetSourceSchema,
  managedImageAssetIdentity,
  mediaAssetIdSchema,
} from "./media"

const id = z.string().min(1)

export const textSizingModeSchema = z.enum([
  "auto_width",
  "auto_height",
  "fixed",
])

export const constraintAxisSchema = z.enum([
  "min",
  "center",
  "max",
  "stretch",
  "scale",
])

export const nodeConstraintsSchema = z
  .object({
    horizontal: constraintAxisSchema,
    vertical: constraintAxisSchema,
  })
  .strict()

export const defaultNodeConstraints = () =>
  nodeConstraintsSchema.parse({ horizontal: "min", vertical: "min" })

export const frameChildLayoutSchema = z
  .object({
    nodeId: id,
    positioning: z.enum(["auto", "absolute"]),
    horizontalSizing: z.enum(["fixed", "fill"]),
    verticalSizing: z.enum(["fixed", "fill"]),
    offsetX: z.number(),
    offsetY: z.number(),
    grow: z.number().nonnegative().default(0),
  })
  .strict()

export const frameAutoLayoutSchema = z
  .object({
    direction: z.enum(["horizontal", "vertical"]),
    horizontalSizing: z.enum(["fixed", "hug"]),
    verticalSizing: z.enum(["fixed", "hug"]),
    gap: z.number().nonnegative(),
    padding: z
      .object({
        top: z.number().nonnegative(),
        right: z.number().nonnegative(),
        bottom: z.number().nonnegative(),
        left: z.number().nonnegative(),
      })
      .strict(),
    primaryAlign: z.enum(["start", "center", "end", "space_between"]),
    counterAlign: z.enum(["start", "center", "end", "stretch"]),
  })
  .strict()

const frameLayoutGridBaseSchema = z.object({
  id,
  visible: z.boolean().default(true),
  color: z.string().min(1).default("#2563eb"),
  opacity: z.number().min(0).max(1).default(0.12),
  offset: z.number().nonnegative().default(0),
})

export const frameLayoutGridSchema = z.discriminatedUnion("pattern", [
  frameLayoutGridBaseSchema
    .extend({
      pattern: z.enum(["columns", "rows"]),
      alignment: z.enum(["min", "center", "max", "stretch"]),
      count: z.number().int().min(1).max(64),
      sectionSize: z.number().positive(),
      gutter: z.number().nonnegative(),
    })
    .strict(),
  frameLayoutGridBaseSchema
    .extend({
      pattern: z.literal("grid"),
      size: z.number().positive(),
    })
    .strict(),
])

export const frameLayoutGridsSchema = z
  .array(frameLayoutGridSchema)
  .max(8)
  .superRefine((grids, context) => {
    const ids = new Set<string>()
    grids.forEach((grid, index) => {
      if (ids.has(grid.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Frame layout guide IDs must be unique",
        })
      }
      ids.add(grid.id)
    })
  })

/**
 * Image placement is deliberately expressed as product-level controls rather
 * than a serialized renderer matrix. The render projection owns the affine
 * conversion so Fabric, preview, HTML, PNG, and PDF share one interpretation.
 *
 * `zoom` is relative to the frame-covering scale. Values below 1 are valid so
 * entering manual mode from Fit can preserve the exact visible pixels.
 */
export const imagePlacementSchema = z
  .object({
    mode: z.enum(["fill", "fit", "manual"]),
    focalX: z.number().min(0).max(1),
    focalY: z.number().min(0).max(1),
    zoom: z.number().positive().max(64),
    rotation: z.number().min(-180).max(180),
    flipX: z.boolean(),
    flipY: z.boolean(),
  })
  .strict()

export const imageFrameMaskSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rectangle") }).strict(),
  z
    .object({
      shape: z.literal("rounded_rectangle"),
      /** Radius normalized against the shorter frame edge. */
      radius: z.number().min(0).max(0.5),
    })
    .strict(),
  z.object({ shape: z.literal("ellipse") }).strict(),
])

export const defaultImagePlacement = () =>
  imagePlacementSchema.parse({
    mode: "fill",
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  })

export const defaultImageFrameMask = () =>
  imageFrameMaskSchema.parse({ shape: "rectangle" })

const baseNodeSchema = z
  .object({
    id,
    name: z.string().min(1),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().default(0),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    opacity: z.number().min(0).max(1).default(1),
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
    constraints: nodeConstraintsSchema.default(defaultNodeConstraints),
  })
  .strict()

const baseNodePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    constraints: nodeConstraintsSchema.optional(),
  })
  .strict()

export const textNodePatchSchema = baseNodePatchSchema.extend({
  text: z.string().optional(),
  runs: z.array(textRunSchema).optional(),
  paragraphs: z.array(textParagraphSchema).optional(),
  links: z.array(textLinkSchema).optional(),
  typographyStyleId: id.optional(),
  paintStyleId: id.optional(),
  color: z.string().optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  decoration: textDecorationSchema.optional(),
  lineHeight: z.number().min(0.5).max(3).optional(),
  letterSpacing: z.number().min(-20).max(200).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  sizingMode: textSizingModeSchema.optional(),
})

export const sceneNodePatchSchema = z
  .union([
    textNodePatchSchema,
    baseNodePatchSchema.extend({
      paintStyleId: id.optional(),
      fill: z.string().optional(),
      radius: z.number().min(0).optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
    }),
    baseNodePatchSchema.extend({
      paintStyleId: id.optional(),
      fill: z.string().optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
    }),
    baseNodePatchSchema.extend({
      paintStyleId: id.optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().positive().optional(),
    }),
    baseNodePatchSchema.extend({
      paintStyleId: id.optional(),
      path: z.string().min(1).optional(),
      viewBox: z.string().min(1).optional(),
      fill: z.string().optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
    }),
    baseNodePatchSchema.extend({
      assetId: id.optional(),
      src: z.string().optional(),
      placement: imagePlacementSchema.optional(),
      frameMask: imageFrameMaskSchema.optional(),
      alt: z.string().optional(),
      altProvenance: z.enum(["generated", "authored"]).optional(),
      decorative: z.boolean().optional(),
    }),
    baseNodePatchSchema.extend({
      paintStyleId: id.optional(),
      fill: z.string().optional(),
      radius: z.number().min(0).optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
      children: z.array(frameChildLayoutSchema).optional(),
      autoLayout: frameAutoLayoutSchema.nullable().optional(),
      clipsContent: z.boolean().optional(),
      layoutGrids: frameLayoutGridsSchema.optional(),
    }),
  ])
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A node update must change at least one property",
  })

export const sceneNodeSchema = z
  .discriminatedUnion("type", [
    baseNodeSchema.extend({
      type: z.literal("text"),
      text: z.string(),
      runs: z.array(textRunSchema),
      paragraphs: z.array(textParagraphSchema),
      links: z.array(textLinkSchema),
      typographyStyleId: id.optional(),
      paintStyleId: id.optional(),
      color: z.string(),
      fontFamily: z.string().min(1),
      fontSize: z.number().positive(),
      fontWeight: z.number().int().min(100).max(900),
      italic: z.boolean().default(false),
      decoration: textDecorationSchema.default("none"),
      lineHeight: z.number().min(0.5).max(3).default(1.18),
      letterSpacing: z.number().min(-20).max(200).default(0),
      align: z.enum(["left", "center", "right"]).default("left"),
      sizingMode: textSizingModeSchema.default("fixed"),
    }),
    baseNodeSchema.extend({
      type: z.literal("rect"),
      paintStyleId: id.optional(),
      fill: z.string(),
      radius: z.number().min(0).default(0),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
    }),
    baseNodeSchema.extend({
      type: z.literal("ellipse"),
      paintStyleId: id.optional(),
      fill: z.string(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
    }),
    baseNodeSchema.extend({
      type: z.literal("line"),
      paintStyleId: id.optional(),
      stroke: z.string(),
      strokeWidth: z.number().positive().default(2),
    }),
    baseNodeSchema.extend({
      type: z.literal("icon"),
      paintStyleId: id.optional(),
      path: z.string().min(1),
      viewBox: z.string().default("0 0 24 24"),
      fill: z.string(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
    }),
    baseNodeSchema.extend({
      type: z.literal("image"),
      assetId: id,
      src: z.string(),
      placement: imagePlacementSchema.default(defaultImagePlacement),
      frameMask: imageFrameMaskSchema.default(defaultImageFrameMask),
      alt: z.string().default(""),
      altProvenance: z.enum(["generated", "authored"]).optional(),
      decorative: z.boolean().default(false),
    }),
    baseNodeSchema.extend({
      type: z.literal("frame"),
      paintStyleId: id.optional(),
      fill: z.string(),
      radius: z.number().min(0).default(0),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
      children: z.array(frameChildLayoutSchema),
      autoLayout: frameAutoLayoutSchema.nullable().default(null),
      clipsContent: z.boolean().default(false),
      layoutGrids: frameLayoutGridsSchema.optional(),
    }),
  ])
  .superRefine((node, context) => {
    if (node.type !== "image") return
    if (node.decorative && node.alt !== "") {
      context.addIssue({
        code: "custom",
        path: ["alt"],
        message: "Decorative images must use an empty alternative description",
      })
    }
    const identity = managedImageAssetIdentity(node.assetId, node.src)
    const localIdentity = localImageAssetIdentity(node.assetId, node.src)
    const curatedIdentity = curatedImageAssetIdentity(node.assetId, node.src)
    if (
      (node.src.startsWith(LOCAL_ASSET_PREFIX) && !localIdentity.local) ||
      (node.src.startsWith(MANAGED_ASSET_PREFIX) && !identity.managed) ||
      (node.src.startsWith(CURATED_ASSET_PATH_PREFIX) &&
        !curatedIdentity.curated)
    ) {
      context.addIssue({
        code: "custom",
        path: ["src"],
        message: "Image asset source identity is malformed",
      })
    }
    if (localIdentity.local && !localIdentity.coherent) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Local image assetId must match ${localIdentity.assetId}`,
      })
    }
    if (identity.managed && !identity.coherent) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Managed image assetId must match ${identity.assetId}`,
      })
    }
    if (curatedIdentity.curated && !curatedIdentity.coherent) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Curated image assetId must match ${curatedIdentity.assetId}`,
      })
    }
  })

export const pageSchema = z
  .object({
    id,
    outputId: id,
    name: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    background: z.string(),
    nodeIds: z.array(id),
  })
  .strict()

export const outputVariantSchema = z
  .object({
    id,
    name: z.string().min(1),
    kind: z.enum(["proposal", "whatsapp_portrait", "square", "custom"]),
    pageIds: z.array(id).min(1),
    exportFormats: z.array(z.enum(["png", "pdf"])).min(1),
  })
  .strict()

export const fieldTypeSchema = z.enum([
  "text",
  "number",
  "currency",
  "date",
  "asset",
  "color",
  "choice",
  "boolean",
])

export const fieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
])

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return day <= (daysInMonth[month - 1] ?? 0)
}

const optionalIsoDateSchema = z
  .string()
  .refine(
    (value) => value === "" || isCalendarDate(value),
    "Date values must use YYYY-MM-DD"
  )

export function isSafeFieldAssetReference(value: string): boolean {
  if (value === "") return true
  if (value.startsWith("asset:local/")) {
    return localAssetSourceSchema.safeParse(value).success
  }
  if (value.startsWith("asset:managed/")) {
    return managedAssetSourceSchema.safeParse(value).success
  }
  if (value.startsWith(CURATED_ASSET_PATH_PREFIX)) {
    return curatedAssetSourceSchema.safeParse(value).success
  }
  if (isRenderSafeImageSource(value)) return true
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

const optionalAssetReferenceSchema = z
  .string()
  .refine(
    isSafeFieldAssetReference,
    "Asset values must be an approved curated path, HTTPS URL, inline safe image, or managed asset reference"
  )

const DECIMAL_CURRENCY = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const WESTERN_GROUPED_CURRENCY = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/
const INDIAN_GROUPED_CURRENCY = /^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/
// FIELD-01 deliberately models Stuwiz quotation money as INR. Accepting an
// arbitrary currency affix without storing that identity would let a later
// normalization silently turn USD/EUR into INR.
const CURRENCY_AFFIX = /^(?:INR|₹)$/

export function isSupportedCurrencyString(value: string): boolean {
  if (value === "") return true
  let normalized = value.trim()
  const negative = normalized.startsWith("-")
  if (negative) normalized = normalized.slice(1).trimStart()
  const parts = normalized.split(/\s+/)
  const affixed =
    parts.length === 2 &&
    (CURRENCY_AFFIX.test(parts[0] ?? "") || CURRENCY_AFFIX.test(parts[1] ?? ""))
  let amount = affixed
    ? CURRENCY_AFFIX.test(parts[0] ?? "")
      ? (parts[1] ?? "")
      : (parts[0] ?? "")
    : normalized
  const symbol = amount.match(/^₹/)?.[0]
  if (symbol) amount = amount.slice(symbol.length)
  const trailingSymbol = amount.match(/₹$/)?.[0]
  if (trailingSymbol) amount = amount.slice(0, -trailingSymbol.length)
  if (!amount || /^\s|\s$/.test(amount)) return false
  return (
    DECIMAL_CURRENCY.test(`${negative ? "-" : ""}${amount}`) ||
    WESTERN_GROUPED_CURRENCY.test(amount) ||
    INDIAN_GROUPED_CURRENCY.test(amount)
  )
}

const currencyValueSchema = z.union([
  z.number().finite(),
  z
    .string()
    .refine(
      isSupportedCurrencyString,
      "Currency values must be a decimal or supported formatted amount"
    ),
])

const FIELD_COLOR =
  /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|hsl)a?\([0-9.,%+\-/\s]+\)|transparent)$/i

export function isSupportedFieldColor(value: string): boolean {
  return value === "" || (value.length <= 128 && FIELD_COLOR.test(value.trim()))
}

const colorValueSchema = z
  .string()
  .refine(isSupportedFieldColor, "Color values must use a safe CSS color")

export const fieldChoiceOptionSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
    label: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
    agentDescription: z.string().max(1_000).default(""),
  })
  .strict()

export const fieldValidationSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    minimum: fieldValueSchema.optional(),
    maximum: fieldValueSchema.optional(),
    options: z.array(fieldChoiceOptionSchema).min(1).max(100).optional(),
  })
  .strict()
  .default({})

export const fieldValueSchemas = {
  text: z.string(),
  number: z.number().finite(),
  currency: currencyValueSchema,
  date: optionalIsoDateSchema,
  asset: optionalAssetReferenceSchema,
  color: colorValueSchema,
  choice: z.string(),
  boolean: z.boolean(),
} as const

export const fieldDefinitionSchema = z
  .object({
    id,
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    type: fieldTypeSchema,
    required: z.boolean().default(false),
    defaultValue: fieldValueSchema,
    agentDescription: z.string().max(1_000).default(""),
    validation: fieldValidationSchema,
  })
  .strict()
  .superRefine((field, context) => {
    const result = fieldValueSchemas[field.type].safeParse(field.defaultValue)
    if (!result.success) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: `Invalid default value for ${field.type} field`,
      })
    }
    if (
      field.required &&
      typeof field.defaultValue === "string" &&
      field.defaultValue.trim() === ""
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "Required fields need a non-empty default value",
      })
    }
    if (
      field.validation.minLength !== undefined &&
      field.validation.maxLength !== undefined &&
      field.validation.minLength > field.validation.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation", "maxLength"],
        message: "Maximum length cannot be smaller than minimum length",
      })
    }
    if (field.type === "choice") {
      const options = field.validation.options ?? []
      if (!options.length) {
        context.addIssue({
          code: "custom",
          path: ["validation", "options"],
          message: "Choice fields need at least one option",
        })
      }
      const values = new Set<string>()
      for (const [index, option] of options.entries()) {
        if (values.has(option.value)) {
          context.addIssue({
            code: "custom",
            path: ["validation", "options", index, "value"],
            message: `Choice value ${option.value} is duplicated`,
          })
        }
        values.add(option.value)
      }
      if (
        field.defaultValue !== "" &&
        typeof field.defaultValue === "string" &&
        !values.has(field.defaultValue)
      ) {
        context.addIssue({
          code: "custom",
          path: ["defaultValue"],
          message: "Choice default must match one configured option",
        })
      }
    } else if (field.validation.options) {
      context.addIssue({
        code: "custom",
        path: ["validation", "options"],
        message: "Only choice fields can define options",
      })
    }
    if (
      (field.validation.minLength !== undefined ||
        field.validation.maxLength !== undefined) &&
      field.type !== "text"
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Only text fields can define length constraints",
      })
    }
    if (
      (field.validation.minimum !== undefined ||
        field.validation.maximum !== undefined) &&
      !["number", "currency", "date"].includes(field.type)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Only number, currency, and date fields can define bounds",
      })
    }
    for (const [key, boundary] of [
      ["minimum", field.validation.minimum],
      ["maximum", field.validation.maximum],
    ] as const) {
      if (boundary === undefined) continue
      if (
        !["number", "currency", "date"].includes(field.type) ||
        !fieldValueSchemas[field.type].safeParse(boundary).success ||
        boundary === ""
      ) {
        context.addIssue({
          code: "custom",
          path: ["validation", key],
          message: `${key} must match the field type and cannot be empty`,
        })
      }
    }
  })

export const fieldBindingSchema = z
  .object({
    id,
    fieldId: id,
    nodeId: id,
    property: z.enum(["text", "src", "visible", "fill"]),
  })
  .strict()

const groupDefinitionBaseSchema = z.object({
  id,
  pageId: id,
  name: z.string().min(1),
  nodeIds: z.array(id),
  parentGroupId: id.optional(),
})

export const maskGroupTypeSchema = z.enum(["vector", "alpha", "luminance"])

export const organizeGroupDefinitionSchema = groupDefinitionBaseSchema
  .extend({ role: z.literal("organize") })
  .strict()

export const maskGroupDefinitionSchema = groupDefinitionBaseSchema
  .extend({
    role: z.literal("mask"),
    mask: z
      .object({
        type: maskGroupTypeSchema,
        sourceNodeIds: z.tuple([id]).rest(id),
      })
      .strict(),
  })
  .strict()

export const groupDefinitionSchema = z.discriminatedUnion("role", [
  organizeGroupDefinitionSchema,
  maskGroupDefinitionSchema,
])

export const componentTransformSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    scale: z.number().positive().max(64),
    rotation: z.number().finite().min(-360).max(360),
  })
  .strict()

const componentNodePatchesSchema = z
  .record(id, sceneNodePatchSchema)
  .refine((patches) => Object.keys(patches).length <= 10_000, {
    message: "A component cannot patch more than 10,000 source layers",
  })

export const componentRemovablePropertySchema = z.enum([
  "typographyStyleId",
  "paintStyleId",
  "stroke",
  "altProvenance",
])

const componentRemovedPropertiesSchema = z
  .record(
    id,
    z
      .array(componentRemovablePropertySchema)
      .min(1)
      .max(4)
      .refine(
        (properties) => new Set(properties).size === properties.length,
        "Removed component properties must be unique"
      )
  )
  .refine((entries) => Object.keys(entries).length <= 10_000, {
    message:
      "A component cannot remove properties from more than 10,000 layers",
  })

export const componentVariantSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    overrides: componentNodePatchesSchema,
    removedProperties: componentRemovedPropertiesSchema.optional(),
  })
  .strict()

export const componentDefinitionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000),
    sourceGroupId: id,
    defaultVariantId: id,
    variants: z.array(componentVariantSchema).min(1).max(100),
  })
  .strict()
  .superRefine((component, context) => {
    const variantIds = component.variants.map((variant) => variant.id)
    if (new Set(variantIds).size !== variantIds.length) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Component variant IDs must be unique",
      })
    }
    if (!variantIds.includes(component.defaultVariantId)) {
      context.addIssue({
        code: "custom",
        path: ["defaultVariantId"],
        message: "The default variant must belong to the component",
      })
    }
  })

export const componentNodeMappingSchema = z
  .object({
    sourceNodeId: id,
    instanceNodeId: id,
  })
  .strict()

export const componentGroupMappingSchema = z
  .object({
    sourceGroupId: id,
    instanceGroupId: id,
  })
  .strict()

export const componentInstanceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    componentId: id,
    variantId: id,
    rootGroupId: id,
    transform: componentTransformSchema,
    nodeMappings: z.array(componentNodeMappingSchema).max(10_000),
    groupMappings: z.array(componentGroupMappingSchema).min(1).max(10_000),
    overrides: componentNodePatchesSchema,
    removedProperties: componentRemovedPropertiesSchema.optional(),
  })
  .strict()
  .superRefine((instance, context) => {
    const sourceNodeIds = instance.nodeMappings.map(
      (mapping) => mapping.sourceNodeId
    )
    const instanceNodeIds = instance.nodeMappings.map(
      (mapping) => mapping.instanceNodeId
    )
    const sourceGroupIds = instance.groupMappings.map(
      (mapping) => mapping.sourceGroupId
    )
    const instanceGroupIds = instance.groupMappings.map(
      (mapping) => mapping.instanceGroupId
    )
    const duplicateMapping =
      new Set(sourceNodeIds).size !== sourceNodeIds.length ||
      new Set(instanceNodeIds).size !== instanceNodeIds.length ||
      new Set(sourceGroupIds).size !== sourceGroupIds.length ||
      new Set(instanceGroupIds).size !== instanceGroupIds.length
    if (duplicateMapping) {
      context.addIssue({
        code: "custom",
        path: ["nodeMappings"],
        message: "Component instance mappings must be one-to-one",
      })
    }
    if (!instanceGroupIds.includes(instance.rootGroupId)) {
      context.addIssue({
        code: "custom",
        path: ["rootGroupId"],
        message: "The instance root must be present in its group mappings",
      })
    }
    if (
      [
        ...Object.keys(instance.overrides),
        ...Object.keys(instance.removedProperties ?? {}),
      ].some((sourceNodeId) => !sourceNodeIds.includes(sourceNodeId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["overrides"],
        message: "Instance overrides must target a mapped source layer",
      })
    }
  })

export const componentDefinitionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1_000).optional(),
    defaultVariantId: id.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A component update must change at least one property",
  })

export const componentVariantPatchSchema = componentVariantSchema
  .omit({ id: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A component variant update must change at least one property",
  })

export const componentInstanceMetadataPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    transform: componentTransformSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A component instance update must change at least one property",
  })

export const componentOverridePropertySchema = z.enum([
  "name",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "flipX",
  "flipY",
  "opacity",
  "visible",
  "locked",
  "constraints",
  "text",
  "runs",
  "paragraphs",
  "links",
  "typographyStyleId",
  "paintStyleId",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "decoration",
  "lineHeight",
  "letterSpacing",
  "align",
  "sizingMode",
  "fill",
  "radius",
  "stroke",
  "strokeWidth",
  "path",
  "viewBox",
  "assetId",
  "src",
  "placement",
  "frameMask",
  "alt",
  "altProvenance",
  "decorative",
  "children",
  "autoLayout",
  "clipsContent",
])

export const typographyStyleSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    fontFamily: z.string().min(1),
    fontSize: z.number().positive(),
    fontWeight: z.number().int().min(100).max(900),
    italic: z.boolean(),
    lineHeight: z.number().min(0.5).max(3),
    letterSpacing: z.number().min(-20).max(200),
    decoration: textDecorationSchema,
  })
  .strict()

export const paintStyleSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    color: z.string().min(1).max(128),
    opacity: z.number().min(0).max(1),
  })
  .strict()

export const typographyStylePatchSchema = typographyStyleSchema
  .omit({ id: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A typography style update must change at least one property",
  })

export const paintStylePatchSchema = paintStyleSchema
  .omit({ id: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A paint style update must change at least one property",
  })

export const designStyleTargetSchema = z
  .object({
    nodeId: id,
    range: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .strict()
      .refine((range) => range.start < range.end, {
        message: "A style target range must not be empty",
      })
      .optional(),
  })
  .strict()

export const designVariableSchema = z.discriminatedUnion("type", [
  z
    .object({
      id,
      name: z.string().trim().min(1).max(120),
      type: z.literal("color"),
      value: colorValueSchema.refine((value) => value !== "", {
        message: "A color variable cannot be empty",
      }),
    })
    .strict(),
  z
    .object({
      id,
      name: z.string().trim().min(1).max(120),
      type: z.literal("number"),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      id,
      name: z.string().trim().min(1).max(120),
      type: z.literal("string"),
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      id,
      name: z.string().trim().min(1).max(120),
      type: z.literal("font_family"),
      value: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[^{};<>\u0000-\u001f\u007f\\]+$/, "Use a safe font family"),
    })
    .strict(),
])

export const designVariablePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    value: z.union([z.string().max(10_000), z.number().finite()]).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A variable update must change at least one property",
  })

export const nodeVariablePropertySchema = z.enum([
  "text",
  "color",
  "fill",
  "stroke",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "strokeWidth",
  "radius",
])

export const textRangeVariablePropertySchema = z.enum([
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
])

export const typographyStyleVariablePropertySchema = z.enum([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
])

export const paintStyleVariablePropertySchema = z.enum(["color", "opacity"])

export const variableBindingTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node"),
      nodeId: id,
      property: nodeVariablePropertySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text_range"),
      nodeId: id,
      range: z
        .object({
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
        })
        .strict()
        .refine((range) => range.start < range.end, {
          message: "A variable binding range must not be empty",
        }),
      property: textRangeVariablePropertySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("typography_style"),
      styleId: id,
      property: typographyStyleVariablePropertySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("paint_style"),
      styleId: id,
      property: paintStyleVariablePropertySchema,
    })
    .strict(),
])

export const variableBindingSchema = z
  .object({
    id,
    variableId: id,
    target: variableBindingTargetSchema,
  })
  .strict()

export const documentSchema = z
  .object({
    schemaVersion: z.literal(6),
    id,
    name: z.string().min(1),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    outputs: z.array(outputVariantSchema).min(1),
    pages: z.array(pageSchema).min(1),
    nodes: z.array(sceneNodeSchema),
    groups: z.array(groupDefinitionSchema).default([]),
    components: z.array(componentDefinitionSchema),
    componentInstances: z.array(componentInstanceSchema),
    typographyStyles: z.array(typographyStyleSchema),
    paintStyles: z.array(paintStyleSchema),
    variables: z.array(designVariableSchema),
    variableBindings: z.array(variableBindingSchema),
    fields: z.array(fieldDefinitionSchema),
    fieldValues: z.record(z.string(), fieldValueSchema),
    bindings: z.array(fieldBindingSchema),
    /**
     * A bounded replay ledger for externally addressable structural commands.
     * It is optional so existing schema-v6 documents retain byte-for-byte
     * meaning until the first replay-protected command is applied.
     */
    commandReceipts: z
      .array(
        z
          .object({
            id,
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .max(128)
      .refine(
        (receipts) =>
          new Set(receipts.map((receipt) => receipt.id)).size ===
          receipts.length,
        "Command receipt ids must be unique"
      )
      .optional(),
  })
  .strict()

const commandBaseSchema = z
  .object({
    id,
    at: z.string().datetime(),
    actor: z.enum(["human", "agent", "api"]),
  })
  .strict()

export const documentCommandSchema = z.discriminatedUnion("type", [
  commandBaseSchema.extend({
    type: z.literal("set_field"),
    fieldId: id,
    value: fieldValueSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("add_field"),
    field: fieldDefinitionSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_field"),
    fieldId: id,
    patch: z
      .object({
        key: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        label: z.string().min(1).optional(),
        type: fieldTypeSchema.optional(),
        required: z.boolean().optional(),
        defaultValue: fieldValueSchema.optional(),
        agentDescription: z.string().max(1_000).optional(),
        validation: fieldValidationSchema.optional(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("remove_field"),
    fieldId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("bind_field"),
    binding: fieldBindingSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("unbind_field"),
    bindingId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("add_node"),
    pageId: id,
    node: sceneNodeSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_node"),
    nodeId: id,
    patch: sceneNodePatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("create_component"),
    component: componentDefinitionSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_component"),
    componentId: id,
    patch: componentDefinitionPatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("delete_component"),
    componentId: id,
    dependentPolicy: z.enum(["reject", "detach"]).default("reject"),
  }),
  commandBaseSchema.extend({
    type: z.literal("create_component_variant"),
    componentId: id,
    variant: componentVariantSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_component_variant"),
    componentId: id,
    variantId: id,
    patch: componentVariantPatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("delete_component_variant"),
    componentId: id,
    variantId: id,
    replacementVariantId: id.optional(),
  }),
  commandBaseSchema.extend({
    type: z.literal("create_component_instance"),
    pageId: id,
    parentGroupId: id.optional(),
    instance: componentInstanceSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("switch_component_variant"),
    instanceId: id,
    variantId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_component_instance"),
    instanceId: id,
    sourceNodeId: id,
    patch: sceneNodePatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_component_instance_metadata"),
    instanceId: id,
    patch: componentInstanceMetadataPatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("reset_component_override"),
    instanceId: id,
    sourceNodeId: id,
    properties: z.array(componentOverridePropertySchema).min(1).optional(),
  }),
  commandBaseSchema.extend({
    type: z.literal("reset_all_component_overrides"),
    instanceId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("detach_component_instance"),
    instanceId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("synchronize_component_instances"),
  }),
  commandBaseSchema.extend({
    type: z.literal("create_typography_style"),
    style: typographyStyleSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_typography_style"),
    styleId: id,
    patch: typographyStylePatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("delete_typography_style"),
    styleId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("apply_typography_style"),
    styleId: id,
    targets: z.array(designStyleTargetSchema).min(1).max(1_000),
  }),
  commandBaseSchema.extend({
    type: z.literal("detach_typography_style"),
    targets: z.array(designStyleTargetSchema).min(1).max(1_000),
  }),
  commandBaseSchema.extend({
    type: z.literal("create_paint_style"),
    style: paintStyleSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_paint_style"),
    styleId: id,
    patch: paintStylePatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("delete_paint_style"),
    styleId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("apply_paint_style"),
    styleId: id,
    targets: z.array(designStyleTargetSchema).min(1).max(1_000),
  }),
  commandBaseSchema.extend({
    type: z.literal("detach_paint_style"),
    targets: z.array(designStyleTargetSchema).min(1).max(1_000),
  }),
  commandBaseSchema.extend({
    type: z.literal("create_variable"),
    variable: designVariableSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_variable"),
    variableId: id,
    patch: designVariablePatchSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("delete_variable"),
    variableId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("bind_variable"),
    binding: variableBindingSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("unbind_variable"),
    bindingId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("set_image_placement"),
    nodeId: id,
    placement: imagePlacementSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("set_image_frame_mask"),
    nodeId: id,
    frameMask: imageFrameMaskSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("create_mask_group"),
    expectedRevision: z.number().int().nonnegative(),
    pageId: id,
    groupId: id,
    parentGroupId: id.optional(),
    name: z.string().trim().min(1),
    nodeIds: z.array(id).min(2).max(516),
    sourceNodeIds: z.tuple([id]).rest(id),
    maskType: maskGroupTypeSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("release_mask_group"),
    expectedRevision: z.number().int().nonnegative(),
    pageId: id,
    groupId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("set_mask_type"),
    expectedRevision: z.number().int().nonnegative(),
    pageId: id,
    groupId: id,
    maskType: maskGroupTypeSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("set_mask_sources"),
    expectedRevision: z.number().int().nonnegative(),
    pageId: id,
    groupId: id,
    sourceNodeIds: z.tuple([id]).rest(id),
  }),
  commandBaseSchema.extend({
    type: z.literal("replace_image_source"),
    nodeId: id,
    assetId: id,
    src: z.string(),
    alt: z.string().optional(),
    altProvenance: z.enum(["generated", "authored"]).optional(),
  }),
  commandBaseSchema.extend({
    type: z.literal("relink_asset_references"),
    from: localAssetSourceSchema,
    toAssetId: mediaAssetIdSchema,
    toSource: managedAssetSourceSchema,
    expectedReferenceKeys: z
      .array(z.string().min(1))
      .min(1)
      .refine(
        (keys) =>
          keys.every(
            (key, index) => index === 0 || (keys[index - 1] ?? "") < key
          ),
        "Reference keys must be unique and sorted"
      ),
  }),
  commandBaseSchema.extend({
    type: z.literal("relink_local_asset_references"),
    from: localAssetSourceSchema,
    toAssetId: localAssetIdSchema,
    toSource: localAssetSourceSchema,
    expectedReferenceKeys: z
      .array(z.string().min(1))
      .min(1)
      .refine(
        (keys) =>
          keys.every(
            (key, index) => index === 0 || (keys[index - 1] ?? "") < key
          ),
        "Reference keys must be unique and sorted"
      ),
  }),
  commandBaseSchema.extend({
    type: z.literal("remove_node"),
    nodeId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("reorder_node"),
    pageId: id,
    nodeId: id,
    toIndex: z.number().int().nonnegative(),
  }),
  commandBaseSchema.extend({
    type: z.literal("reorder_nodes"),
    pageId: id,
    nodeIds: z.array(id).min(1),
    toIndex: z.number().int().nonnegative(),
  }),
  commandBaseSchema.extend({
    type: z.literal("reparent_node"),
    pageId: id,
    nodeId: id,
    targetGroupId: id.optional(),
  }),
  commandBaseSchema.extend({
    type: z.literal("reparent_group"),
    pageId: id,
    groupId: id,
    targetGroupId: id.optional(),
  }),
  commandBaseSchema.extend({
    type: z.literal("group_nodes"),
    groupId: id,
    pageId: id,
    name: z.string().min(1),
    nodeIds: z.array(id).min(2),
  }),
  commandBaseSchema.extend({
    type: z.literal("update_group"),
    groupId: id,
    name: z.string().min(1),
  }),
  commandBaseSchema.extend({
    type: z.literal("ungroup_nodes"),
    groupId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("add_page"),
    outputId: id,
    page: pageSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("duplicate_page"),
    outputId: id,
    page: pageSchema,
    nodes: z.array(sceneNodeSchema),
    groups: z.array(groupDefinitionSchema),
    componentInstances: z.array(componentInstanceSchema),
    bindings: z.array(fieldBindingSchema),
    variableBindings: z.array(variableBindingSchema),
  }),
  commandBaseSchema.extend({
    type: z.literal("duplicate_nodes"),
    pageId: id,
    nodes: z.array(sceneNodeSchema).min(1),
    groups: z.array(groupDefinitionSchema),
    componentInstances: z.array(componentInstanceSchema),
    bindings: z.array(fieldBindingSchema),
    variableBindings: z.array(variableBindingSchema),
  }),
  commandBaseSchema.extend({
    type: z.literal("update_page"),
    pageId: id,
    patch: z
      .object({
        name: z.string().min(1).optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        background: z.string().optional(),
      })
      .strict(),
  }),
  commandBaseSchema.extend({
    type: z.literal("remove_page"),
    pageId: id,
  }),
  commandBaseSchema.extend({
    type: z.literal("reorder_page"),
    outputId: id,
    pageId: id,
    toIndex: z.number().int().nonnegative(),
  }),
  commandBaseSchema.extend({
    type: z.literal("add_output"),
    output: outputVariantSchema,
    page: pageSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("add_output_variant"),
    output: outputVariantSchema,
    page: pageSchema,
    nodes: z.array(sceneNodeSchema),
    groups: z.array(groupDefinitionSchema),
    componentInstances: z.array(componentInstanceSchema),
    bindings: z.array(fieldBindingSchema),
    variableBindings: z.array(variableBindingSchema),
  }),
  commandBaseSchema.extend({
    type: z.literal("update_output"),
    outputId: id,
    name: z.string().min(1),
  }),
  commandBaseSchema.extend({
    type: z.literal("remove_output"),
    outputId: id,
  }),
])

export const changeOperationSchema = z
  .object({
    id,
    command: documentCommandSchema,
    summary: z.string().min(1),
    status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  })
  .strict()

export const changeSetSchema = z
  .object({
    id,
    documentId: id,
    baseRevision: z.number().int().nonnegative(),
    baseSnapshotId: z.string().min(1),
    title: z.string().min(1),
    createdAt: z.string().datetime(),
    createdBy: z.enum(["human", "agent"]),
    status: z.enum(["pending", "partially_accepted", "accepted", "rejected"]),
    operations: z.array(changeOperationSchema).min(1),
  })
  .strict()

export const templateParameterSchema = z
  .object({
    id,
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    type: fieldTypeSchema,
    required: z.boolean(),
    defaultValue: fieldValueSchema,
    exampleValue: fieldValueSchema,
    agentDescription: z.string().max(1_000).default(""),
    validation: fieldValidationSchema,
    bindings: z.array(
      z
        .object({
          outputId: id,
          pageId: id,
          nodeId: id,
          property: z.enum(["text", "src", "visible", "fill"]),
        })
        .strict()
    ),
  })
  .strict()

export const templateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    parameters: z.array(templateParameterSchema),
    outputs: z.array(
      z
        .object({
          id,
          name: z.string().min(1),
          kind: z.enum(["proposal", "whatsapp_portrait", "square", "custom"]),
          exportFormats: z.array(z.enum(["png", "pdf"])).min(1),
          pages: z.array(
            z
              .object({
                id,
                name: z.string().min(1),
                width: z.number().positive(),
                height: z.number().positive(),
              })
              .strict()
          ),
        })
        .strict()
    ),
  })
  .strict()

export const templateVersionSchema = z
  .object({
    id,
    templateId: id,
    version: z.number().int().positive(),
    sourceRevision: z.number().int().nonnegative(),
    sourceSnapshotId: z
      .string()
      .regex(
        /^(?:sha256-[a-f0-9]{64}|legacy-[A-Za-z0-9._:-]+)$/,
        "Invalid document snapshot identity"
      ),
    publishedAt: z.string().datetime(),
    document: documentSchema,
    manifest: templateManifestSchema,
  })
  .strict()

export const templatePublishRequestSchema = z
  .object({
    id,
    templateId: id,
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    document: documentSchema,
  })
  .strict()

export type SceneNode = z.infer<typeof sceneNodeSchema>
export type TextNode = Extract<SceneNode, { type: "text" }>
export type TextNodePatch = z.infer<typeof textNodePatchSchema>
export type TextSizingMode = z.infer<typeof textSizingModeSchema>
export type ConstraintAxis = z.infer<typeof constraintAxisSchema>
export type NodeConstraints = z.infer<typeof nodeConstraintsSchema>
export type FrameChildLayout = z.infer<typeof frameChildLayoutSchema>
export type FrameAutoLayout = z.infer<typeof frameAutoLayoutSchema>
export type ImagePlacement = z.infer<typeof imagePlacementSchema>
export type ImageFrameMask = z.infer<typeof imageFrameMaskSchema>
export type Page = z.infer<typeof pageSchema>
export type OutputVariant = z.infer<typeof outputVariantSchema>
export type FieldType = z.infer<typeof fieldTypeSchema>
export type FieldValue = z.infer<typeof fieldValueSchema>
export type FieldChoiceOption = z.infer<typeof fieldChoiceOptionSchema>
export type FieldValidation = z.infer<typeof fieldValidationSchema>
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>
export type FieldBinding = z.infer<typeof fieldBindingSchema>
export type GroupDefinition = z.infer<typeof groupDefinitionSchema>
export type ComponentTransform = z.infer<typeof componentTransformSchema>
export type ComponentVariant = z.infer<typeof componentVariantSchema>
export type ComponentRemovableProperty = z.infer<
  typeof componentRemovablePropertySchema
>
export type ComponentDefinition = z.infer<typeof componentDefinitionSchema>
export type ComponentNodeMapping = z.infer<typeof componentNodeMappingSchema>
export type ComponentGroupMapping = z.infer<typeof componentGroupMappingSchema>
export type ComponentInstance = z.infer<typeof componentInstanceSchema>
export type TypographyStyle = z.infer<typeof typographyStyleSchema>
export type PaintStyle = z.infer<typeof paintStyleSchema>
export type TypographyStylePatch = z.infer<typeof typographyStylePatchSchema>
export type PaintStylePatch = z.infer<typeof paintStylePatchSchema>
export type DesignStyleTarget = z.infer<typeof designStyleTargetSchema>
export type DesignVariable = z.infer<typeof designVariableSchema>
export type DesignVariablePatch = z.infer<typeof designVariablePatchSchema>
export type NodeVariableProperty = z.infer<typeof nodeVariablePropertySchema>
export type TextRangeVariableProperty = z.infer<
  typeof textRangeVariablePropertySchema
>
export type TypographyStyleVariableProperty = z.infer<
  typeof typographyStyleVariablePropertySchema
>
export type PaintStyleVariableProperty = z.infer<
  typeof paintStyleVariablePropertySchema
>
export type VariableBindingTarget = z.infer<typeof variableBindingTargetSchema>
export type VariableBinding = z.infer<typeof variableBindingSchema>
export type Document = z.infer<typeof documentSchema>
export type DocumentCommand = z.infer<typeof documentCommandSchema>
export type ChangeOperation = z.infer<typeof changeOperationSchema>
export type ChangeSet = z.infer<typeof changeSetSchema>
export type TemplateParameter = z.infer<typeof templateParameterSchema>
export type TemplateManifest = z.infer<typeof templateManifestSchema>
export type TemplateVersion = z.infer<typeof templateVersionSchema>
export type TemplatePublishRequest = z.infer<
  typeof templatePublishRequestSchema
>
