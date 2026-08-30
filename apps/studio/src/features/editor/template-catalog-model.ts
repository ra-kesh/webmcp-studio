import type {
  DesignTemplateCatalogItem,
  TemplateApplicationImpact,
} from "@webmcp/document"

export const allTemplateCategoriesValue = "__all__"

export type TemplateCatalogIdentity = {
  id: string
  version: number
}

export type TemplateCatalogPendingAction = {
  type: "create" | "apply"
  template: TemplateCatalogIdentity
}

export type TemplateCatalogCompatibility = {
  compatible: boolean
  label: string
  description: string
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

const normalized = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ")

export function templateCatalogKey(
  template: Pick<DesignTemplateCatalogItem, "id" | "version">
) {
  return `${template.id}@${template.version}`
}

export function isSameTemplate(
  template: Pick<DesignTemplateCatalogItem, "id" | "version">,
  identity: TemplateCatalogIdentity | null | undefined
) {
  return Boolean(
    identity &&
    template.id === identity.id &&
    template.version === identity.version
  )
}

export function templateCatalogCategories(
  items: readonly DesignTemplateCatalogItem[]
) {
  return [...new Set(items.map((item) => item.category))].sort((left, right) =>
    left.localeCompare(right)
  )
}

export function filterTemplateCatalog(
  items: readonly DesignTemplateCatalogItem[],
  options: { search: string; category: string }
) {
  const search = normalized(options.search)
  return items.filter((item) => {
    if (
      options.category !== allTemplateCategoriesValue &&
      normalized(item.category) !== normalized(options.category)
    ) {
      return false
    }
    if (!search) return true
    return normalized(
      [item.name, item.description, item.category, ...item.tags].join(" ")
    ).includes(search)
  })
}

export function templateCompatibility(
  template: DesignTemplateCatalogItem,
  hasQuotationSource: boolean
): TemplateCatalogCompatibility {
  if (!template.requiresQuotationSource) {
    return {
      compatible: true,
      label: "Ready",
      description:
        "This starter works with any document and does not require linked quotation data.",
    }
  }
  if (hasQuotationSource) {
    return {
      compatible: true,
      label: "Source linked",
      description:
        "This style uses the linked quotation revision and keeps its source-backed content intact.",
    }
  }
  return {
    compatible: false,
    label: "Quotation required",
    description:
      "Link a Stuwiz quotation before creating or applying this source-backed style.",
  }
}

export function templateDimensionsLabel(template: DesignTemplateCatalogItem) {
  const dimensions = [
    ...new Set(
      template.dimensions.map(({ width, height }) => `${width} × ${height}`)
    ),
  ]
  if (dimensions.length === 0) return "No page size"
  if (dimensions.length === 1) return `${dimensions[0]} px`
  return `${dimensions[0]} px + ${dimensions.length - 1} more`
}

export function templatePreviewLayout(
  template: DesignTemplateCatalogItem,
  bounds: { width: number; height: number } = { width: 196, height: 136 }
) {
  const page = template.previewDocument.pages.find(
    (candidate) => candidate.id === template.previewPageId
  )
  if (!page) {
    throw new Error(
      `Template ${templateCatalogKey(template)} has no preview page.`
    )
  }
  const scale = Math.min(bounds.width / page.width, bounds.height / page.height)
  return {
    scale,
    width: page.width * scale,
    height: page.height * scale,
  }
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
