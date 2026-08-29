export * from "./change-sets"
export * from "./design-queries"
export * from "./registration"
export * from "./product-command-proposals"

export const toolNames = [
  "inspect_design",
  "read_design_tree",
  "get_capabilities",
  "execute_product_command",
  "read_design_node",
  "search_design_nodes",
  "search_assets",
  "validate_design",
  "propose_asset_insertion",
  "propose_field_updates",
  "propose_canvas_edits",
  "propose_output_variant",
  "publish_template",
  "inspect_render_history",
  "render_template",
] as const

export type ToolName = (typeof toolNames)[number]

export type ToolDescriptor = {
  name: ToolName
  description: string
  mutates: boolean
  requiresHumanReview: boolean
  routes: readonly ("library" | "editor" | "review" | "template" | "render")[]
}

export const toolCatalog: readonly ToolDescriptor[] = [
  {
    name: "inspect_design",
    description:
      "Read the active document, outputs, fields, pages, and selection.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review"],
  },
  {
    name: "read_design_tree",
    description: "Read the ordered page, group, and layer tree.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review"],
  },
  {
    name: "get_capabilities",
    description:
      "Read the complete canonical Studio command policy and exact disabled reasons.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review"],
  },
  {
    name: "execute_product_command",
    description:
      "Dry-run, propose, or run an explicitly allowed canonical Studio command.",
    mutates: true,
    requiresHumanReview: true,
    routes: ["editor", "review"],
  },
  {
    name: "read_design_node",
    description:
      "Read one layer with page, output, group, and binding context.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review"],
  },
  {
    name: "search_design_nodes",
    description: "Search layer names and text across the document.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review"],
  },
  {
    name: "search_assets",
    description:
      "Search the current workspace asset library without inserting an asset.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["library", "editor"],
  },
  {
    name: "validate_design",
    description:
      "Check missing values, references, overflow, and export readiness.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["editor", "review", "template"],
  },
  {
    name: "propose_field_updates",
    description: "Create reviewable changes to shared template fields.",
    mutates: false,
    requiresHumanReview: true,
    routes: ["editor", "review"],
  },
  {
    name: "propose_asset_insertion",
    description: "Insert an approved asset as a reviewable image layer.",
    mutates: false,
    requiresHumanReview: true,
    routes: ["editor", "review"],
  },
  {
    name: "propose_canvas_edits",
    description: "Create reviewable node commands against a document revision.",
    mutates: false,
    requiresHumanReview: true,
    routes: ["editor", "review"],
  },
  {
    name: "propose_output_variant",
    description:
      "Propose another output size from existing content and fields.",
    mutates: false,
    requiresHumanReview: true,
    routes: ["editor", "review"],
  },
  {
    name: "publish_template",
    description:
      "Publish the accepted document revision as an immutable template version.",
    mutates: true,
    requiresHumanReview: true,
    routes: ["template"],
  },
  {
    name: "inspect_render_history",
    description:
      "Inspect recent persisted render jobs and their downloadable artifacts.",
    mutates: false,
    requiresHumanReview: false,
    routes: ["render"],
  },
  {
    name: "render_template",
    description:
      "Render a published template version with supplied field values.",
    mutates: true,
    requiresHumanReview: false,
    routes: ["template", "render"],
  },
]

export function toolsForRoute(
  route: ToolDescriptor["routes"][number]
): ToolDescriptor[] {
  return toolCatalog.filter((tool) => tool.routes.includes(route))
}
