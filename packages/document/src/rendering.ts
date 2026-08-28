import { applyFieldValues } from "./commands"
import {
  fieldValueMatchesType,
  fieldValueSatisfiesDefinition,
  normalizeFieldValueForStorage,
} from "./fields"
import {
  documentSchema,
  templateVersionSchema,
  type Document,
  type TemplateVersion,
} from "./schema"
import { validateDocument } from "./validation"

export type TemplateModifications = Record<string, string | number | boolean>

export function materializeTemplateVersion(
  versionInput: TemplateVersion,
  modifications: TemplateModifications
): Document {
  const version = templateVersionSchema.parse(versionInput)
  const document = documentSchema.parse(structuredClone(version.document))
  const fieldsByKey = new Map(
    document.fields.map((field) => [field.key, field])
  )
  const fieldValues = { ...document.fieldValues }

  for (const [key, value] of Object.entries(modifications)) {
    const field = fieldsByKey.get(key)
    if (!field) throw new Error(`Unknown template parameter: ${key}`)
    if (field.required && typeof value === "string" && value.trim() === "") {
      throw new Error(`${field.label} cannot be empty`)
    }
    if (!fieldValueMatchesType(field, value)) {
      throw new Error(`${field.label} received the wrong value type`)
    }
    if (!fieldValueSatisfiesDefinition(field, value)) {
      throw new Error(`${field.label} did not satisfy its field constraints`)
    }
    fieldValues[field.id] = normalizeFieldValueForStorage(field, value)
  }

  const materialized = documentSchema.parse(
    applyFieldValues({ ...document, fieldValues })
  )
  const blocking = validateDocument(materialized).filter(
    (issue) => issue.severity === "error"
  )
  if (blocking.length) {
    throw new Error(blocking[0]?.message ?? "Template values are invalid")
  }
  return materialized
}
