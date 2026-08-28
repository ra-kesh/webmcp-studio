import { z } from "zod"
import { applyFieldValues } from "./commands"
import { fieldValueMatchesType, normalizeFieldValueForStorage } from "./fields"
import { managedAssetIdFromSource } from "./media"
import { createTemplateManifest } from "./publishing"
import {
  documentSchema,
  fieldTypeSchema,
  fieldValidationSchema,
  fieldValueSchema,
  isSupportedFieldColor,
  templateVersionSchema,
  type Document,
  type FieldDefinition,
  type TemplateVersion,
} from "./schema"
import { assertValidDocument } from "./validation"

const legacyFieldDefinitionSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    type: fieldTypeSchema,
    required: z.boolean().default(false),
    defaultValue: fieldValueSchema,
    agentDescription: z.string().max(1_000).optional(),
    validation: fieldValidationSchema.optional(),
  })
  .strict()

const legacyDocumentSchema = documentSchema.extend({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  fields: z.array(legacyFieldDefinitionSchema),
  fieldValues: z.record(z.string(), fieldValueSchema),
})

const templateVersionEnvelopeSchema = templateVersionSchema
  .omit({ document: true })
  .extend({ document: z.unknown() })

export type DocumentMigration = {
  code:
    | "legacy_date_normalized"
    | "legacy_currency_normalized"
    | "legacy_managed_image_identity_normalized"
    | "legacy_image_placement_migrated"
    | "legacy_image_frame_mask_defaulted"
    | "legacy_image_accessibility_unresolved"
    | "document_schema_upgraded"
    | "legacy_field_preserved_as_text"
    | "legacy_fill_promoted_to_color"
    | "template_manifest_recomputed"
  message: string
  fieldId?: string
  nodeId?: string
}

function normalizeLegacyImageModel(input: unknown): {
  input: unknown
  migrations: DocumentMigration[]
} {
  const normalized = structuredClone(input)
  const migrations: DocumentMigration[] = []
  if (!normalized || typeof normalized !== "object") {
    return { input: normalized, migrations }
  }
  const document = normalized as Record<string, unknown>
  if (document.schemaVersion !== 1 || !Array.isArray(document.nodes)) {
    return { input: normalized, migrations }
  }

  for (const candidate of document.nodes) {
    if (!candidate || typeof candidate !== "object") continue
    const node = candidate as Record<string, unknown>
    if (node.type !== "image") continue
    const nodeId = typeof node.id === "string" ? node.id : undefined
    const focusX =
      typeof node.cropX === "number" && Number.isFinite(node.cropX)
        ? Math.min(1, Math.max(0, node.cropX))
        : 0.5
    const focusY =
      typeof node.cropY === "number" && Number.isFinite(node.cropY)
        ? Math.min(1, Math.max(0, node.cropY))
        : 0.5
    const mode = node.fit === "contain" ? "fit" : "fill"

    node.placement = {
      mode,
      focalX: focusX,
      focalY: focusY,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    }
    delete node.fit
    delete node.cropX
    delete node.cropY
    migrations.push({
      code: "legacy_image_placement_migrated",
      ...(nodeId ? { nodeId } : {}),
      message: `Image ${typeof node.name === "string" ? node.name : (nodeId ?? "layer")} placement was migrated from ${mode === "fit" ? "contain" : "cover"} to ${mode}`,
    })

    node.frameMask = { shape: "rectangle" }
    migrations.push({
      code: "legacy_image_frame_mask_defaulted",
      ...(nodeId ? { nodeId } : {}),
      message: `Image ${typeof node.name === "string" ? node.name : (nodeId ?? "layer")} received the default rectangular frame mask`,
    })

    node.decorative = false
    if (typeof node.alt !== "string" || node.alt.trim() === "") {
      migrations.push({
        code: "legacy_image_accessibility_unresolved",
        ...(nodeId ? { nodeId } : {}),
        message: `Image ${typeof node.name === "string" ? node.name : (nodeId ?? "layer")} needs an alternative description or explicit decorative intent`,
      })
    }
  }

  migrations.push({
    code: "document_schema_upgraded",
    message: "Document schema was upgraded from version 1 to version 2",
  })
  return { input: normalized, migrations }
}

export type DecodedDocument = {
  document: Document
  migrations: DocumentMigration[]
}

export type DecodedTemplateVersion = {
  version: TemplateVersion
  migrations: DocumentMigration[]
}

export type TemplateRepublicationIdentity = Pick<
  TemplateVersion,
  "id" | "templateId" | "version" | "sourceSnapshotId" | "publishedAt"
>

export class DocumentMigrationError extends Error {
  readonly fieldId?: string

  constructor(message: string, fieldId?: string) {
    super(message)
    this.name = "DocumentMigrationError"
    this.fieldId = fieldId
  }
}

function normalizeLegacyManagedImageIdentities(input: unknown): {
  input: unknown
  migrations: DocumentMigration[]
} {
  const normalized = structuredClone(input)
  const migrations: DocumentMigration[] = []
  if (!normalized || typeof normalized !== "object") {
    return { input: normalized, migrations }
  }
  const nodes = (normalized as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return { input: normalized, migrations }
  for (const candidate of nodes) {
    if (!candidate || typeof candidate !== "object") continue
    const node = candidate as Record<string, unknown>
    if (node.type !== "image" || typeof node.src !== "string") continue
    const assetId = managedAssetIdFromSource(node.src)
    if (!assetId || node.assetId === assetId) continue
    node.assetId = assetId
    migrations.push({
      code: "legacy_managed_image_identity_normalized",
      ...(typeof node.id === "string" ? { nodeId: node.id } : {}),
      message: `Managed image ${typeof node.name === "string" ? node.name : (node.id ?? "layer")} was normalized to its canonical asset identity`,
    })
  }
  return { input: normalized, migrations }
}

function canonicalSerializedValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerializedValue).join(",")}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalSerializedValue(entry)}`
    )
    .join(",")}}`
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const

function calendarDate(year: number, month: number, day: number): string | null {
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return fieldValueMatchesType({ type: "date" }, candidate) ? candidate : null
}

function normalizeLegacyDate(value: string): string | null {
  if (fieldValueMatchesType({ type: "date" }, value)) return value
  const numeric = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (numeric) {
    return calendarDate(
      Number(numeric[3]),
      Number(numeric[2]),
      Number(numeric[1])
    )
  }
  const named = value.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})$/)
  if (named) {
    const month = MONTHS.indexOf(
      named[2]?.toLowerCase() as (typeof MONTHS)[number]
    )
    if (month >= 0) {
      return calendarDate(Number(named[3]), month + 1, Number(named[1]))
    }
  }
  return null
}

function valuesForField(
  document: z.infer<typeof legacyDocumentSchema>,
  field: z.infer<typeof legacyFieldDefinitionSchema>
) {
  const current = document.fieldValues[field.id]
  return [field.defaultValue, ...(current === undefined ? [] : [current])]
}

function migrateLegacyDocument(input: unknown): DecodedDocument {
  const legacy = legacyDocumentSchema.parse(structuredClone(input))
  const migrations: DocumentMigration[] = []
  const fields = legacy.fields.map((legacyField) => {
    const values = valuesForField(legacy, legacyField)
    let field: FieldDefinition = {
      ...legacyField,
      agentDescription: legacyField.agentDescription ?? "",
      validation: legacyField.validation ?? {},
    }

    if (field.type === "date") {
      const normalized = values.map((value) =>
        typeof value === "string" ? normalizeLegacyDate(value) : null
      )
      if (normalized.every((value) => value !== null)) {
        field = { ...field, defaultValue: normalized[0] ?? "" }
        const current = normalized[1]
        if (current !== undefined) legacy.fieldValues[field.id] = current
        if (values.some((value, index) => value !== normalized[index])) {
          migrations.push({
            code: "legacy_date_normalized",
            fieldId: field.id,
            message: `${field.label} was normalized to ISO calendar dates`,
          })
        }
      } else {
        field = { ...field, type: "text" }
        migrations.push({
          code: "legacy_field_preserved_as_text",
          fieldId: field.id,
          message: `${field.label} used a non-ISO legacy date and was preserved as text`,
        })
      }
    }

    if (field.type === "currency") {
      const hasInvalidValue = values.some(
        (value) => !fieldValueMatchesType(field, value)
      )
      if (hasInvalidValue) {
        field = {
          ...field,
          type: "text",
          defaultValue: String(field.defaultValue),
          validation: {},
        }
        if (legacy.fieldValues[field.id] !== undefined) {
          legacy.fieldValues[field.id] = String(legacy.fieldValues[field.id])
        }
        migrations.push({
          code: "legacy_field_preserved_as_text",
          fieldId: field.id,
          message: `${field.label} used non-INR legacy money and was preserved as text`,
        })
      } else {
        try {
          const previousDefault = field.defaultValue
          const previousCurrent = legacy.fieldValues[field.id]
          field = {
            ...field,
            defaultValue: normalizeFieldValueForStorage(
              field,
              field.defaultValue
            ),
          }
          const currentValue = legacy.fieldValues[field.id]
          if (currentValue !== undefined) {
            legacy.fieldValues[field.id] = normalizeFieldValueForStorage(
              field,
              currentValue
            )
          }
          if (
            field.defaultValue !== previousDefault ||
            legacy.fieldValues[field.id] !== previousCurrent
          ) {
            migrations.push({
              code: "legacy_currency_normalized",
              fieldId: field.id,
              message: `${field.label} INR money was normalized to a decimal string`,
            })
          }
        } catch {
          field = {
            ...field,
            type: "text",
            defaultValue: String(field.defaultValue),
            validation: {},
          }
          if (legacy.fieldValues[field.id] !== undefined) {
            legacy.fieldValues[field.id] = String(legacy.fieldValues[field.id])
          }
          migrations.push({
            code: "legacy_field_preserved_as_text",
            fieldId: field.id,
            message: `${field.label} exceeded currency precision and was preserved as text`,
          })
        }
      }
    }

    if (
      field.type === "asset" &&
      values.some((value) => !fieldValueMatchesType(field, value))
    ) {
      const hasSourceBinding = legacy.bindings.some(
        (binding) => binding.fieldId === field.id && binding.property === "src"
      )
      if (hasSourceBinding) {
        throw new DocumentMigrationError(
          `${field.label} contains an unsafe legacy asset reference that cannot be migrated while bound`,
          field.id
        )
      }
      field = { ...field, type: "text" }
      migrations.push({
        code: "legacy_field_preserved_as_text",
        fieldId: field.id,
        message: `${field.label} used a legacy asset reference and was preserved as unbound text`,
      })
    }

    return field
  })

  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  for (const binding of legacy.bindings) {
    if (binding.property !== "fill") continue
    const field = fieldsById.get(binding.fieldId)
    if (!field || field.type !== "text") continue
    const values = [
      field.defaultValue,
      ...(legacy.fieldValues[field.id] === undefined
        ? []
        : [legacy.fieldValues[field.id]]),
    ]
    if (
      !values.every(
        (value) => typeof value === "string" && isSupportedFieldColor(value)
      )
    ) {
      throw new DocumentMigrationError(
        `${field.label} is bound to fill but contains a value that is not a safe color`,
        field.id
      )
    }
    fieldsById.set(field.id, { ...field, type: "color" })
    migrations.push({
      code: "legacy_fill_promoted_to_color",
      fieldId: field.id,
      message: `${field.label} was promoted from text to the color field type`,
    })
  }

  const migrated = documentSchema.parse({
    ...legacy,
    schemaVersion: 2,
    fields: legacy.fields.map((field) => fieldsById.get(field.id)),
  })
  return {
    document: assertValidDocument(applyFieldValues(migrated)),
    migrations,
  }
}

export function decodeDocument(input: unknown): DecodedDocument {
  const imageModel = normalizeLegacyImageModel(input)
  const normalized = normalizeLegacyManagedImageIdentities(imageModel.input)
  const current = documentSchema.safeParse(normalized.input)
  if (!current.success) {
    const migrated = migrateLegacyDocument(normalized.input)
    return {
      document: migrated.document,
      migrations: [
        ...imageModel.migrations,
        ...normalized.migrations,
        ...migrated.migrations,
      ],
    }
  }

  const legacyFillBindings = current.data.bindings.filter((binding) => {
    const field = current.data.fields.find(
      (candidate) => candidate.id === binding.fieldId
    )
    return binding.property === "fill" && field?.type === "text"
  })
  const legacyCurrency = current.data.fields.some((field) => {
    if (field.type !== "currency") return false
    const currentValue = current.data.fieldValues[field.id]
    const values = [
      field.defaultValue,
      ...(currentValue === undefined ? [] : [currentValue]),
    ]
    return values.some((value) => {
      try {
        return normalizeFieldValueForStorage(field, value) !== value
      } catch {
        return true
      }
    })
  })
  if (legacyFillBindings.length || legacyCurrency) {
    const migrated = migrateLegacyDocument(normalized.input)
    return {
      document: migrated.document,
      migrations: [
        ...imageModel.migrations,
        ...normalized.migrations,
        ...migrated.migrations,
      ],
    }
  }
  return {
    document: assertValidDocument(current.data),
    migrations: [...imageModel.migrations, ...normalized.migrations],
  }
}

export function decodeTemplateVersion(input: unknown): DecodedTemplateVersion {
  const persisted = structuredClone(input)
  const documentVersion = (
    persisted as { document?: { schemaVersion?: unknown } }
  ).document?.schemaVersion
  if (documentVersion === 1) {
    throw new DocumentMigrationError(
      "Published schemaVersion 1 template versions are immutable and cannot be migrated in place. Republish the source document under a new version identity."
    )
  }
  const validated = templateVersionSchema.parse(persisted)
  assertValidDocument(validated.document)
  if (
    canonicalSerializedValue(validated) !== canonicalSerializedValue(persisted)
  ) {
    throw new DocumentMigrationError(
      "Published template versions are immutable and cannot receive schema defaults or migrations in place. Republish the source document under a new version identity."
    )
  }
  return {
    version: persisted as TemplateVersion,
    migrations: [],
  }
}

export function migrateTemplateVersionForRepublication(
  input: unknown,
  identity: TemplateRepublicationIdentity
): DecodedTemplateVersion {
  const envelope = templateVersionEnvelopeSchema.parse(structuredClone(input))
  const decoded = decodeDocument(envelope.document)
  const version = templateVersionSchema.parse({
    ...envelope,
    ...identity,
    document: decoded.document,
    manifest: createTemplateManifest(decoded.document),
  })
  return {
    version,
    migrations: [
      ...decoded.migrations,
      {
        code: "template_manifest_recomputed" as const,
        message:
          "The derived template manifest was recomputed under a new publication identity",
      },
    ],
  }
}
