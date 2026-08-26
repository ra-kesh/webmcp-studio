import type { FieldBinding, FieldDefinition, SceneNode } from "./schema"

export type BindableProperty = FieldBinding["property"]

export const bindingPropertiesForNode = (
  node: SceneNode
): BindableProperty[] => {
  if (node.type === "text") return ["text", "visible"]
  if (node.type === "image") return ["src", "visible"]
  if (node.type === "rect" || node.type === "ellipse" || node.type === "icon") {
    return ["fill", "visible"]
  }
  return ["visible"]
}

export function fieldValueMatchesType(
  field: Pick<FieldDefinition, "type">,
  value: string | number | boolean
): boolean {
  if (field.type === "boolean") return typeof value === "boolean"
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
  }
  if (field.type === "currency") {
    return (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    )
  }
  return typeof value === "string"
}

export function fieldCanBindToProperty(
  field: FieldDefinition,
  node: SceneNode,
  property: BindableProperty
): boolean {
  if (!bindingPropertiesForNode(node).includes(property)) return false
  if (property === "visible") return field.type === "boolean"
  if (property === "src") return field.type === "asset"
  if (property === "fill") return field.type === "text"
  return field.type !== "asset" && field.type !== "boolean"
}
