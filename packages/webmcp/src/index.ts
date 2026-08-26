import type {
  ChangeSet,
  Document,
  TemplateVersion,
  ValidationIssue,
} from "@webmcp/document"

export * from "./change-sets"
export * from "./registration"

export const toolNames = [
  "inspect_design",
  "search_assets",
  "validate_design",
  "propose_field_updates",
  "propose_canvas_edits",
  "propose_output_variant",
  "resolve_change_set",
  "publish_template",
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
    name: "resolve_change_set",
    description:
      "Accept or reject individual operations in a pending change set.",
    mutates: true,
    requiresHumanReview: true,
    routes: ["review"],
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
    name: "render_template",
    description:
      "Render a published template version with supplied field values.",
    mutates: true,
    requiresHumanReview: false,
    routes: ["template", "render"],
  },
]

export interface StudioToolService {
  inspectDesign(): Promise<Document>
  validateDesign(): Promise<ValidationIssue[]>
  proposeChangeSet(changeSet: ChangeSet): Promise<ChangeSet>
  publishTemplate(changeSetId: string): Promise<TemplateVersion>
  renderTemplate(
    templateVersionId: string,
    values: Record<string, unknown>
  ): Promise<{ renderId: string }>
}

export function toolsForRoute(
  route: ToolDescriptor["routes"][number]
): ToolDescriptor[] {
  return toolCatalog.filter((tool) => tool.routes.includes(route))
}
