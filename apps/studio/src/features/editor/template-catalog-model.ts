import type { TemplateApplicationImpact } from "@webmcp/document"

export type TemplateCatalogIdentity = {
  id: string
  version: number
}

export type TemplateImpactRow = {
  id:
    | "pages"
    | "outputs"
    | "nodes"
    | "groups"
    | "components"
    | "component-instances"
    | "fields"
    | "bindings"
    | "image-assets"
    | "quotation-source"
  label: string
  value: string
  warning: boolean
}

const beforeAfter = ({ before, after }: { before: number; after: number }) =>
  `${before} → ${after}`

export function templateImpactRows(
  impact: TemplateApplicationImpact
): TemplateImpactRow[] {
  return [
    {
      id: "pages",
      label: "Pages",
      value: beforeAfter(impact.pages),
      warning: impact.pages.before !== impact.pages.after,
    },
    {
      id: "outputs",
      label: "Outputs",
      value: beforeAfter(impact.outputs),
      warning: impact.outputs.before !== impact.outputs.after,
    },
    {
      id: "nodes",
      label: "Objects",
      value: beforeAfter(impact.nodes),
      warning: impact.nodes.before !== impact.nodes.after,
    },
    {
      id: "groups",
      label: "Groups",
      value: beforeAfter(impact.groups),
      warning: impact.groups.before !== impact.groups.after,
    },
    {
      id: "components",
      label: "Components",
      value: beforeAfter(impact.components),
      warning: impact.components.before !== impact.components.after,
    },
    {
      id: "component-instances",
      label: "Instances",
      value: beforeAfter(impact.componentInstances),
      warning:
        impact.componentInstances.before !== impact.componentInstances.after,
    },
    {
      id: "fields",
      label: "Fields",
      value: beforeAfter(impact.fields),
      warning: impact.fields.before !== impact.fields.after,
    },
    {
      id: "bindings",
      label: "Bindings",
      value: beforeAfter(impact.bindings),
      warning: impact.bindings.before !== impact.bindings.after,
    },
    {
      id: "image-assets",
      label: "Image assets",
      value: beforeAfter(impact.imageAssets),
      warning: impact.imageAssets.before !== impact.imageAssets.after,
    },
    {
      id: "quotation-source",
      label: "Quotation source",
      value: impact.disconnectsQuotationSource
        ? "Will disconnect"
        : "Unchanged",
      warning: impact.disconnectsQuotationSource,
    },
  ]
}
