import { z } from "zod"

const id = z.string().min(1)

const baseNodeSchema = z.object({
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

export const sceneNodeSchema = z.discriminatedUnion("type", [
  baseNodeSchema.extend({
    type: z.literal("text"),
    text: z.string(),
    color: z.string(),
    fontFamily: z.string(),
    fontSize: z.number().positive(),
    fontWeight: z.number().int().min(100).max(900),
    align: z.enum(["left", "center", "right"]).default("left"),
  }),
  baseNodeSchema.extend({
    type: z.literal("rect"),
    fill: z.string(),
    radius: z.number().min(0).default(0),
    stroke: z.string().optional(),
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
    fit: z.enum(["cover", "contain"]).default("cover"),
    alt: z.string().default(""),
  }),
])

export const pageSchema = z.object({
  id,
  outputId: id,
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string(),
  nodeIds: z.array(id),
})

export const outputVariantSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(["proposal", "whatsapp_portrait", "square"]),
  pageIds: z.array(id).min(1),
  exportFormats: z.array(z.enum(["png", "pdf"])).min(1),
})

export const fieldDefinitionSchema = z.object({
  id,
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(["text", "number", "currency", "date", "asset", "boolean"]),
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
})

export const fieldBindingSchema = z.object({
  id,
  fieldId: id,
  nodeId: id,
  property: z.enum(["text", "src", "visible", "fill"]),
})

export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().min(1),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  outputs: z.array(outputVariantSchema).min(1),
  pages: z.array(pageSchema).min(1),
  nodes: z.array(sceneNodeSchema),
  fields: z.array(fieldDefinitionSchema),
  fieldValues: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
  bindings: z.array(fieldBindingSchema),
})

const commandBaseSchema = z.object({
  id,
  at: z.string().datetime(),
  actor: z.enum(["human", "agent", "api"]),
})

export const documentCommandSchema = z.discriminatedUnion("type", [
  commandBaseSchema.extend({
    type: z.literal("set_field"),
    fieldId: id,
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  commandBaseSchema.extend({
    type: z.literal("add_node"),
    pageId: id,
    node: sceneNodeSchema,
  }),
  commandBaseSchema.extend({
    type: z.literal("update_node"),
    nodeId: id,
    patch: z.record(z.string(), z.unknown()),
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
])

export const changeOperationSchema = z.object({
  id,
  command: documentCommandSchema,
  summary: z.string().min(1),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
})

export const changeSetSchema = z.object({
  id,
  documentId: id,
  baseRevision: z.number().int().nonnegative(),
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  createdBy: z.enum(["human", "agent"]),
  status: z.enum(["pending", "partially_accepted", "accepted", "rejected"]),
  operations: z.array(changeOperationSchema).min(1),
})

export const templateVersionSchema = z.object({
  id,
  templateId: id,
  version: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  document: documentSchema,
})

export type SceneNode = z.infer<typeof sceneNodeSchema>
export type Page = z.infer<typeof pageSchema>
export type OutputVariant = z.infer<typeof outputVariantSchema>
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>
export type FieldBinding = z.infer<typeof fieldBindingSchema>
export type Document = z.infer<typeof documentSchema>
export type DocumentCommand = z.infer<typeof documentCommandSchema>
export type ChangeOperation = z.infer<typeof changeOperationSchema>
export type ChangeSet = z.infer<typeof changeSetSchema>
export type TemplateVersion = z.infer<typeof templateVersionSchema>
