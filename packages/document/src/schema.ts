import { z } from "zod"
import { isRenderSafeImageSource } from "./image-source-policy"
import { managedImageAssetIdentity } from "./media"

const id = z.string().min(1)

export const textSizingModeSchema = z.enum([
  "auto_width",
  "auto_height",
  "fixed",
])

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
    opacity: z.number().min(0).max(1).default(1),
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
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
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict()

export const textNodePatchSchema = baseNodePatchSchema.extend({
  text: z.string().optional(),
  color: z.string().optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  lineHeight: z.number().min(0.5).max(3).optional(),
  letterSpacing: z.number().min(-20).max(200).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  sizingMode: textSizingModeSchema.optional(),
})

export const sceneNodePatchSchema = z
  .union([
    textNodePatchSchema,
    baseNodePatchSchema.extend({
      fill: z.string().optional(),
      radius: z.number().min(0).optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
    }),
    baseNodePatchSchema.extend({
      fill: z.string().optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
    }),
    baseNodePatchSchema.extend({
      stroke: z.string().optional(),
      strokeWidth: z.number().positive().optional(),
    }),
    baseNodePatchSchema.extend({
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
  ])
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A node update must change at least one property",
  })

export const sceneNodeSchema = z
  .discriminatedUnion("type", [
    baseNodeSchema.extend({
      type: z.literal("text"),
      text: z.string(),
      color: z.string(),
      fontFamily: z.string().min(1),
      fontSize: z.number().positive(),
      fontWeight: z.number().int().min(100).max(900),
      lineHeight: z.number().min(0.5).max(3).default(1.18),
      letterSpacing: z.number().min(-20).max(200).default(0),
      align: z.enum(["left", "center", "right"]).default("left"),
      sizingMode: textSizingModeSchema.default("fixed"),
    }),
    baseNodeSchema.extend({
      type: z.literal("rect"),
      fill: z.string(),
      radius: z.number().min(0).default(0),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
    }),
    baseNodeSchema.extend({
      type: z.literal("ellipse"),
      fill: z.string(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().default(0),
    }),
    baseNodeSchema.extend({
      type: z.literal("line"),
      stroke: z.string(),
      strokeWidth: z.number().positive().default(2),
    }),
    baseNodeSchema.extend({
      type: z.literal("icon"),
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
    if (identity.managed && !identity.coherent) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Managed image assetId must match ${identity.assetId}`,
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
  if (/^asset:local\/[A-Za-z0-9._:-]+$/.test(value)) return true
  if (/^asset:managed\/asset-[A-Za-z0-9_-]{10,90}$/.test(value)) return true
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
    "Asset values must be an HTTPS URL, inline safe image, or managed asset reference"
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

export const groupDefinitionSchema = z
  .object({
    id,
    pageId: id,
    name: z.string().min(1),
    nodeIds: z.array(id),
    parentGroupId: id.optional(),
  })
  .strict()

export const documentSchema = z
  .object({
    schemaVersion: z.literal(2),
    id,
    name: z.string().min(1),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    outputs: z.array(outputVariantSchema).min(1),
    pages: z.array(pageSchema).min(1),
    nodes: z.array(sceneNodeSchema),
    groups: z.array(groupDefinitionSchema).default([]),
    fields: z.array(fieldDefinitionSchema),
    fieldValues: z.record(z.string(), fieldValueSchema),
    bindings: z.array(fieldBindingSchema),
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
    type: z.literal("replace_image_source"),
    nodeId: id,
    assetId: id,
    src: z.string(),
    alt: z.string().optional(),
    altProvenance: z.enum(["generated", "authored"]).optional(),
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
    bindings: z.array(fieldBindingSchema),
  }),
  commandBaseSchema.extend({
    type: z.literal("duplicate_nodes"),
    pageId: id,
    nodes: z.array(sceneNodeSchema).min(1),
    groups: z.array(groupDefinitionSchema),
    bindings: z.array(fieldBindingSchema),
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
    bindings: z.array(fieldBindingSchema),
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
