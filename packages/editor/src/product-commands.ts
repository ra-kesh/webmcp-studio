import type { SceneNode } from "@webmcp/document"
import {
  editorCommandDisabledReason,
  editorCommandIds,
  editorCommandRegistry,
  formatEditorShortcut,
  isEditorCommandEnabled,
  type EditorCommandContext,
  type EditorCommandDefinition,
  type EditorCommandId,
  type EditorShortcutMode,
  type EditorShortcutPlatform,
} from "./commands"
import type { Alignment, Distribution } from "./geometry"
import type { InspectorMaskCapabilities } from "./inspector"
import {
  documentStructureCommandIds,
  isDocumentStructureCommandEnabled,
  type DocumentStructureCommandContext,
  type DocumentStructureCommandId,
} from "./structure-commands"

export const productActionCommandIds = [
  "document.home",
  "document.new",
  "document.import-json",
  "document.import-quotation",
  "document.export-json",
  "document.publish",
  "output.export-png",
  "output.export-pdf",
  "developer.api-playground",
  "canvas.rulers.toggle",
  "canvas.guides.toggle",
  "canvas.guides.manage",
  "command.search",
  "help.shortcuts",
  "object.rename",
  "object.visibility.toggle",
  "object.lock.toggle",
  "arrange.front",
  "arrange.back",
  "arrange.forward",
  "arrange.backward",
  "arrange.align",
  "arrange.distribute",
] as const

export type ProductActionCommandId = (typeof productActionCommandIds)[number]

export const productCommandIds = [
  ...editorCommandIds,
  ...documentStructureCommandIds,
  ...productActionCommandIds,
] as const

export type ProductCommandId = (typeof productCommandIds)[number]
export type ProductCommandCategory =
  "file" | "edit" | "view" | "object" | "text" | "arrange" | "help"

export type ProductCommandScope =
  "global" | "document" | "selection" | "node" | "group" | "page" | "output"

export type ProductCommandIconToken =
  | "add"
  | "align"
  | "api"
  | "arrange"
  | "copy"
  | "crop"
  | "delete"
  | "document"
  | "download"
  | "duplicate"
  | "edit"
  | "group"
  | "hand"
  | "help"
  | "image"
  | "layers"
  | "lock"
  | "page"
  | "paste"
  | "publish"
  | "redo"
  | "search"
  | "select"
  | "shape"
  | "text"
  | "undo"
  | "visibility"
  | "zoom"
  | "output"
  | "mask"

export type ProductShortcut = Readonly<{
  code: string
  primary?: boolean
  shift?: boolean
  alt?: boolean
  mode?: EditorShortcutMode
}>

export type ProductCommandDefinition = Readonly<{
  id: ProductCommandId
  label: string
  category: ProductCommandCategory
  subgroup: string
  keywords: readonly string[]
  alternateNames: readonly string[]
  scope: ProductCommandScope
  stableTargetRequired: boolean
  mutating: boolean
  destructive: boolean
  discoverable: boolean
  appMenu: boolean
  icon: ProductCommandIconToken
  shortcuts: readonly ProductShortcut[]
}>

type TargetIdentity = Readonly<{
  documentId: string
  snapshotId: string
  displayName: string
}>

export type ProductCommandTarget =
  | (TargetIdentity & Readonly<{ kind: "document" }>)
  | (TargetIdentity &
      Readonly<{
        kind: "selection"
        pageId: string
        nodeIds: readonly string[]
        groupId?: string | null
      }>)
  | (TargetIdentity &
      Readonly<{ kind: "node"; pageId: string; nodeId: string }>)
  | (TargetIdentity &
      Readonly<{ kind: "group"; pageId: string; groupId: string }>)
  | (TargetIdentity & Readonly<{ kind: "page"; pageId: string }>)
  | (TargetIdentity & Readonly<{ kind: "output"; outputId: string }>)

export type ProductCommandArguments =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "text-preset"; presetId: string }>
  | Readonly<{
      kind: "alignment"
      alignment: Alignment
      relativeTo: "selection" | "page"
    }>
  | Readonly<{ kind: "distribution"; distribution: Distribution }>
  | Readonly<{
      kind: "mask-create"
      sourceNodeIds: readonly [string, ...string[]]
    }>
  | Readonly<{
      kind: "mask-sources"
      sourceNodeIds: readonly [string, ...string[]]
    }>

export type ProductCommandArgumentContract =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "text-preset"
      optional: true
      fields: Readonly<{ presetId: Readonly<{ type: "string"; minLength: 1 }> }>
    }>
  | Readonly<{
      kind: "alignment"
      variants: readonly Alignment[]
      relativeTo: readonly ["selection", "page"]
    }>
  | Readonly<{
      kind: "distribution"
      variants: readonly Distribution[]
    }>
  | Readonly<{
      kind: "mask-create"
      fields: Readonly<{
        sourceNodeIds: Readonly<{ type: "string[]"; minItems: 1; maxItems: 4 }>
      }>
    }>
  | Readonly<{
      kind: "mask-sources"
      fields: Readonly<{
        sourceNodeIds: Readonly<{ type: "string[]"; minItems: 1; maxItems: 4 }>
      }>
    }>

export type ProductCommandInvocation = Readonly<{
  commandId: ProductCommandId
  target?: ProductCommandTarget
  arguments?: ProductCommandArguments
}>

export function productCommandArgumentContract(
  commandId: ProductCommandId
): ProductCommandArgumentContract {
  if (commandId === "object.add-text") {
    return {
      kind: "text-preset",
      optional: true,
      fields: { presetId: { type: "string", minLength: 1 } },
    }
  }
  if (commandId === "arrange.align") {
    return {
      kind: "alignment",
      variants: [
        "left",
        "horizontal-center",
        "right",
        "top",
        "vertical-center",
        "bottom",
      ],
      relativeTo: ["selection", "page"],
    }
  }
  if (commandId === "arrange.distribute") {
    return { kind: "distribution", variants: ["horizontal", "vertical"] }
  }
  if (commandId === "mask.create") {
    return {
      kind: "mask-create",
      fields: {
        sourceNodeIds: { type: "string[]", minItems: 1, maxItems: 4 },
      },
    }
  }
  if (commandId === "mask.sources.set") {
    return {
      kind: "mask-sources",
      fields: {
        sourceNodeIds: { type: "string[]", minItems: 1, maxItems: 4 },
      },
    }
  }
  return { kind: "none" }
}

export type ProductCommandCheckedState = boolean | "mixed" | undefined

export type ProductCommandStateInput = Readonly<{
  enabled?: boolean
  disabledReason?: string | null
  label?: string
  checked?: ProductCommandCheckedState
}>

export type ProductCommandSelectionState = Readonly<{
  pageId: string
  nodeIds: readonly string[]
  nodeTypes: readonly SceneNode["type"][]
  groupId?: string | null
  anyLocked: boolean
  allLocked: boolean
  allVisible: boolean
  allHidden: boolean
}>

export type ProductCommandRuntimeContext = Readonly<{
  documentId: string
  snapshotId: string
  activePageId: string
  activeOutputId: string | null
  pageIds: readonly string[]
  outputIds: readonly string[]
  pdfOutputIds?: readonly string[]
  nodeIds: readonly string[]
  pageNodeCounts?: Readonly<Partial<Record<string, number>>>
  groupIds: readonly string[]
  documentDisplayName?: string
  pageDisplayNames?: Readonly<Partial<Record<string, string>>>
  outputDisplayNames?: Readonly<Partial<Record<string, string>>>
  selection: ProductCommandSelectionState | null
  activeTool: "select" | "hand"
  editor: EditorCommandContext
  structureByTarget?: Readonly<
    Partial<Record<string, DocumentStructureCommandContext>>
  >
  stateByCommandId?: Readonly<
    Partial<Record<ProductCommandId, ProductCommandStateInput>>
  >
  mask?: InspectorMaskCapabilities
}>

export type ResolvedProductCommand = Readonly<{
  definition: ProductCommandDefinition
  invocation: ProductCommandInvocation
  label: string
  enabled: boolean
  disabledReason: string | null
  checked: ProductCommandCheckedState
  targetDisplayName: string | null
}>

export type ProductCommandValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: "invalid" | "stale"; reason: string }>

export type ProductCommandRunResult =
  | Readonly<{ status: "accepted" }>
  | Readonly<{ status: "declined" }>
  | Readonly<{ status: "disabled" | "invalid" | "stale"; reason: string }>

export type ProductCommandExecutionMode = "dry_run" | "proposal" | "direct"

export type ProductCommandExecutionPolicy = Readonly<{
  modes: readonly ProductCommandExecutionMode[]
  reason: string | null
  recommendedTool: string | null
}>

const directlyExecutableProductCommands = new Set<ProductCommandId>([
  "tool.select",
  "tool.hand",
  "canvas.fit",
  "canvas.zoom-reset",
  "selection.copy",
])

const proposalExecutableProductCommands = new Set<ProductCommandId>([
  "selection.nudge-left",
  "selection.nudge-right",
  "selection.nudge-up",
  "selection.nudge-down",
  "object.duplicate",
  "object.group",
  "object.ungroup",
  "object.delete",
  "object.visibility.toggle",
  "object.lock.toggle",
  "image.fit",
  "image.fill",
  "image.flip-horizontal",
  "image.flip-vertical",
  "image.rotate-left",
  "image.rotate-right",
  "image.rotation.reset",
  "image.reset-placement",
  "image.frame.rectangle",
  "image.frame.rounded-rectangle",
  "image.frame.ellipse",
  "arrange.front",
  "arrange.back",
  "arrange.forward",
  "arrange.backward",
  "arrange.align",
  "arrange.distribute",
  "mask.create",
  "mask.release",
  "mask.type.vector",
  "mask.type.alpha",
  "mask.type.luminance",
  "mask.sources.set",
  "page.remove",
  "page.move-up",
  "page.move-down",
])

const specializedProductCommandTools: Readonly<
  Partial<Record<ProductCommandId, string>>
> = {
  "image.insert": "propose_asset_insertion",
  "image.replace": "propose_canvas_edits",
  "document.publish": "publish_template",
  "output.export-png": "render_template",
  "output.export-pdf": "render_template",
}

export function productCommandExecutionPolicy(
  commandId: ProductCommandId
): ProductCommandExecutionPolicy {
  if (directlyExecutableProductCommands.has(commandId)) {
    return { modes: ["dry_run", "direct"], reason: null, recommendedTool: null }
  }
  if (proposalExecutableProductCommands.has(commandId)) {
    return {
      modes: ["dry_run", "proposal"],
      reason: null,
      recommendedTool: null,
    }
  }
  const recommendedTool = specializedProductCommandTools[commandId] ?? null
  return {
    modes: [],
    reason: recommendedTool
      ? `Use ${recommendedTool} for this workflow.`
      : "This command needs a typed workflow contract before automation can execute it.",
    recommendedTool,
  }
}

const words = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("…", "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

function editorCategory(id: EditorCommandId): ProductCommandCategory {
  if (id.startsWith("tool.") || id.startsWith("canvas.")) return "view"
  if (id === "object.add-text") return "text"
  if (
    id.startsWith("selection.") ||
    id.startsWith("history.") ||
    id === "object.paste" ||
    id === "object.duplicate" ||
    id === "object.delete"
  ) {
    return "edit"
  }
  return "object"
}

function editorScope(id: EditorCommandId): ProductCommandScope {
  if (id.startsWith("tool.") || id.startsWith("canvas.")) return "global"
  if (id === "selection.select-all") return "page"
  if (id.startsWith("mask.") && id !== "mask.create") return "group"
  if (
    id === "history.undo" ||
    id === "history.redo" ||
    id.startsWith("object.add-") ||
    id === "object.paste" ||
    id === "image.insert"
  ) {
    return "document"
  }
  return "selection"
}

function editorIcon(id: EditorCommandId): ProductCommandIconToken {
  if (id === "tool.select" || id === "selection.select-all") return "select"
  if (id === "tool.hand") return "hand"
  if (id.startsWith("canvas.")) return "zoom"
  if (id === "history.undo") return "undo"
  if (id === "history.redo") return "redo"
  if (id === "selection.copy") return "copy"
  if (id === "object.paste") return "paste"
  if (id === "object.duplicate") return "duplicate"
  if (id === "object.delete") return "delete"
  if (id === "object.group" || id === "object.ungroup") return "group"
  if (id.startsWith("mask.")) return "mask"
  if (id === "object.add-text") return "text"
  if (id.startsWith("object.add-")) return "shape"
  if (id.includes("crop") || id.includes("frame")) return "crop"
  if (id.startsWith("image.")) return "image"
  return "edit"
}

function definition(input: {
  id: ProductCommandId
  label: string
  category: ProductCommandCategory
  subgroup: string
  keywords?: readonly string[]
  alternateNames?: readonly string[]
  scope: ProductCommandScope
  stableTargetRequired?: boolean
  mutating: boolean
  destructive?: boolean
  discoverable?: boolean
  appMenu?: boolean
  icon: ProductCommandIconToken
  shortcuts?: readonly ProductShortcut[]
}): ProductCommandDefinition {
  return Object.freeze({
    ...input,
    keywords: Object.freeze([
      ...new Set([
        ...words(input.label),
        ...words(input.category),
        ...words(input.subgroup),
        ...(input.keywords ?? []),
      ]),
    ]),
    alternateNames: Object.freeze([...(input.alternateNames ?? [])]),
    stableTargetRequired:
      input.stableTargetRequired ??
      (input.scope !== "global" && input.scope !== "document"),
    destructive: input.destructive ?? false,
    discoverable: input.discoverable ?? true,
    appMenu: input.appMenu ?? true,
    shortcuts: Object.freeze([...(input.shortcuts ?? [])]),
  })
}

const editorDefinitions = Object.fromEntries(
  editorCommandIds.map((id) => {
    const current: EditorCommandDefinition = editorCommandRegistry[id]
    const scope = editorScope(id)
    return [
      id,
      definition({
        id,
        label: current.label,
        category: editorCategory(id),
        subgroup: id.split(".")[0]!,
        keywords: id.split(/[.-]/),
        scope,
        stableTargetRequired: scope === "selection" || scope === "page",
        mutating: current.mutating,
        destructive: id === "object.delete",
        appMenu: !(
          id.startsWith("selection.nudge-") ||
          id === "image.crop.apply" ||
          id === "image.crop.cancel" ||
          id === "image.resize-frame-to-image"
        ),
        icon: editorIcon(id),
        shortcuts: (current.shortcuts ?? []).map(
          ({ code, primary, shift, alt, mode }) => ({
            code,
            primary,
            shift,
            alt,
            mode,
          })
        ),
      }),
    ]
  })
) as Record<EditorCommandId, ProductCommandDefinition>

const structureLabels: Record<DocumentStructureCommandId, string> = {
  "page.add": "Add page",
  "page.duplicate": "Duplicate page",
  "page.update": "Rename page…",
  "page.remove": "Delete page",
  "page.move-up": "Move page left",
  "page.move-down": "Move page right",
  "output.add": "Add output",
  "output.update": "Rename output…",
  "output.remove": "Delete output",
}

const structureDefinitions = Object.fromEntries(
  documentStructureCommandIds.map((id) => {
    const scope = id.startsWith("page.") ? "page" : "output"
    return [
      id,
      definition({
        id,
        label: structureLabels[id],
        category: "file",
        subgroup: scope,
        keywords: id.split(/[.-]/),
        scope,
        mutating: true,
        destructive: id === "page.remove" || id === "output.remove",
        appMenu: false,
        icon: scope,
      }),
    ]
  })
) as Record<DocumentStructureCommandId, ProductCommandDefinition>

const actionDefinitions: Record<
  ProductActionCommandId,
  ProductCommandDefinition
> = {
  "document.home": definition({
    id: "document.home",
    label: "Studio home",
    category: "file",
    subgroup: "document",
    keywords: ["back", "documents", "start"],
    alternateNames: ["Back to documents"],
    scope: "document",
    mutating: false,
    icon: "document",
  }),
  "document.new": definition({
    id: "document.new",
    label: "New document…",
    category: "file",
    subgroup: "document",
    keywords: ["create"],
    scope: "document",
    mutating: true,
    icon: "document",
  }),
  "document.import-json": definition({
    id: "document.import-json",
    label: "Import document JSON…",
    category: "file",
    subgroup: "import",
    keywords: ["open", "upload"],
    scope: "document",
    mutating: true,
    icon: "document",
  }),
  "document.import-quotation": definition({
    id: "document.import-quotation",
    label: "Import quotation source…",
    category: "file",
    subgroup: "import",
    keywords: ["stuwiz", "proposal"],
    scope: "document",
    mutating: true,
    icon: "document",
  }),
  "document.export-json": definition({
    id: "document.export-json",
    label: "Export document JSON",
    category: "file",
    subgroup: "export",
    keywords: ["download"],
    scope: "document",
    mutating: false,
    icon: "download",
  }),
  "document.publish": definition({
    id: "document.publish",
    label: "Publish",
    category: "file",
    subgroup: "publish",
    keywords: ["version", "release"],
    scope: "document",
    mutating: true,
    icon: "publish",
  }),
  "output.export-png": definition({
    id: "output.export-png",
    label: "Export current page as PNG",
    category: "file",
    subgroup: "export",
    keywords: ["image", "download"],
    scope: "page",
    mutating: false,
    icon: "download",
  }),
  "output.export-pdf": definition({
    id: "output.export-pdf",
    label: "Export output as PDF",
    category: "file",
    subgroup: "export",
    keywords: ["document", "download"],
    scope: "output",
    mutating: false,
    icon: "download",
  }),
  "developer.api-playground": definition({
    id: "developer.api-playground",
    label: "Open API Playground",
    category: "file",
    subgroup: "developer",
    keywords: ["webmcp", "automation"],
    scope: "global",
    mutating: false,
    icon: "api",
  }),
  "canvas.rulers.toggle": definition({
    id: "canvas.rulers.toggle",
    label: "Rulers",
    category: "view",
    subgroup: "guides",
    keywords: ["measure", "coordinates"],
    scope: "global",
    mutating: false,
    icon: "zoom",
  }),
  "canvas.guides.toggle": definition({
    id: "canvas.guides.toggle",
    label: "Guides",
    category: "view",
    subgroup: "guides",
    keywords: ["snap", "alignment"],
    scope: "global",
    mutating: false,
    icon: "align",
  }),
  "canvas.guides.manage": definition({
    id: "canvas.guides.manage",
    label: "Manage guides…",
    category: "view",
    subgroup: "guides",
    keywords: ["ruler", "coordinate", "accessibility"],
    scope: "global",
    mutating: false,
    icon: "align",
  }),
  "command.search": definition({
    id: "command.search",
    label: "Search commands…",
    category: "help",
    subgroup: "discovery",
    keywords: ["palette", "find"],
    alternateNames: ["Command palette"],
    scope: "global",
    mutating: false,
    icon: "search",
    shortcuts: [{ code: "KeyK", primary: true }],
  }),
  "help.shortcuts": definition({
    id: "help.shortcuts",
    label: "Keyboard shortcuts",
    category: "help",
    subgroup: "discovery",
    keywords: ["keys", "reference"],
    scope: "global",
    mutating: false,
    icon: "help",
  }),
  "object.rename": definition({
    id: "object.rename",
    label: "Rename layer…",
    category: "object",
    subgroup: "identity",
    keywords: ["name"],
    scope: "selection",
    mutating: true,
    icon: "edit",
  }),
  "object.visibility.toggle": definition({
    id: "object.visibility.toggle",
    label: "Hide selection",
    category: "object",
    subgroup: "state",
    keywords: ["show", "visibility"],
    scope: "selection",
    mutating: true,
    icon: "visibility",
  }),
  "object.lock.toggle": definition({
    id: "object.lock.toggle",
    label: "Lock selection",
    category: "object",
    subgroup: "state",
    keywords: ["unlock", "protect"],
    scope: "selection",
    mutating: true,
    icon: "lock",
  }),
  "arrange.front": definition({
    id: "arrange.front",
    label: "Bring to front",
    category: "arrange",
    subgroup: "order",
    keywords: ["top", "layer"],
    scope: "selection",
    mutating: true,
    icon: "arrange",
  }),
  "arrange.back": definition({
    id: "arrange.back",
    label: "Send to back",
    category: "arrange",
    subgroup: "order",
    keywords: ["bottom", "layer"],
    scope: "selection",
    mutating: true,
    icon: "arrange",
  }),
  "arrange.forward": definition({
    id: "arrange.forward",
    label: "Bring forward",
    category: "arrange",
    subgroup: "order",
    keywords: ["layer"],
    scope: "selection",
    mutating: true,
    icon: "arrange",
  }),
  "arrange.backward": definition({
    id: "arrange.backward",
    label: "Send backward",
    category: "arrange",
    subgroup: "order",
    keywords: ["layer"],
    scope: "selection",
    mutating: true,
    icon: "arrange",
  }),
  "arrange.align": definition({
    id: "arrange.align",
    label: "Align",
    category: "arrange",
    subgroup: "alignment",
    keywords: ["left", "center", "right", "top", "bottom", "page"],
    scope: "selection",
    mutating: true,
    icon: "align",
  }),
  "arrange.distribute": definition({
    id: "arrange.distribute",
    label: "Distribute",
    category: "arrange",
    subgroup: "alignment",
    keywords: ["horizontal", "vertical", "spacing"],
    scope: "selection",
    mutating: true,
    icon: "align",
  }),
}

export const productCommandCatalog: Readonly<
  Record<ProductCommandId, ProductCommandDefinition>
> = Object.freeze({
  ...editorDefinitions,
  ...structureDefinitions,
  ...actionDefinitions,
})

const targetKindForScope: Partial<
  Record<ProductCommandScope, ProductCommandTarget["kind"]>
> = {
  document: "document",
  selection: "selection",
  node: "node",
  group: "group",
  page: "page",
  output: "output",
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

export function validateProductCommandInvocation(
  invocation: ProductCommandInvocation,
  context: ProductCommandRuntimeContext
): ProductCommandValidation {
  const command = productCommandCatalog[invocation.commandId]
  if (!command)
    return { ok: false, status: "invalid", reason: "Unknown command." }
  const expectedTargetKind = targetKindForScope[command.scope]
  if (command.stableTargetRequired && !invocation.target) {
    return {
      ok: false,
      status: "invalid",
      reason: "This command needs a target.",
    }
  }
  if (
    invocation.target &&
    expectedTargetKind &&
    invocation.target.kind !== expectedTargetKind &&
    !(
      command.scope === "selection" &&
      (invocation.target.kind === "node" || invocation.target.kind === "group")
    )
  ) {
    return {
      ok: false,
      status: "invalid",
      reason: "The command target has the wrong type.",
    }
  }
  const target = invocation.target
  if (!target) return validateInvocationArguments(invocation)
  if (target.documentId !== context.documentId) {
    return {
      ok: false,
      status: "stale",
      reason: "The document changed after this command opened.",
    }
  }
  if (target.snapshotId !== context.snapshotId) {
    return {
      ok: false,
      status: "stale",
      reason: "The document changed after this command opened.",
    }
  }
  if (target.kind === "selection") {
    if (
      target.pageId !== context.activePageId ||
      !context.selection ||
      context.selection.pageId !== target.pageId ||
      !sameIds(target.nodeIds, context.selection.nodeIds) ||
      (target.groupId !== undefined &&
        target.groupId !== (context.selection.groupId ?? null))
    ) {
      return {
        ok: false,
        status: "stale",
        reason: "The selection changed after this command opened.",
      }
    }
    if (target.nodeIds.some((id) => !context.nodeIds.includes(id))) {
      return {
        ok: false,
        status: "stale",
        reason: "A selected layer no longer exists.",
      }
    }
  }
  if (target.kind === "node" && !context.nodeIds.includes(target.nodeId)) {
    return { ok: false, status: "stale", reason: "The layer no longer exists." }
  }
  if (
    target.kind === "node" &&
    (target.pageId !== context.activePageId ||
      !context.selection?.nodeIds.includes(target.nodeId))
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "The layer target changed after this command opened.",
    }
  }
  if (target.kind === "group" && !context.groupIds.includes(target.groupId)) {
    return { ok: false, status: "stale", reason: "The group no longer exists." }
  }
  if (
    target.kind === "group" &&
    (target.pageId !== context.activePageId ||
      context.selection?.groupId !== target.groupId)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "The group target changed after this command opened.",
    }
  }
  if (target.kind === "page" && !context.pageIds.includes(target.pageId)) {
    return { ok: false, status: "stale", reason: "The page no longer exists." }
  }
  if (
    invocation.commandId === "selection.select-all" &&
    target.kind === "page" &&
    target.pageId !== context.activePageId
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "The active page changed after this command opened.",
    }
  }
  if (
    target.kind === "output" &&
    !context.outputIds.includes(target.outputId)
  ) {
    return {
      ok: false,
      status: "stale",
      reason: "The output no longer exists.",
    }
  }
  return validateInvocationArguments(invocation)
}

function validateInvocationArguments(
  invocation: ProductCommandInvocation
): ProductCommandValidation {
  if (invocation.commandId === "arrange.align") {
    return invocation.arguments?.kind === "alignment"
      ? { ok: true }
      : { ok: false, status: "invalid", reason: "Choose an alignment." }
  }
  if (invocation.commandId === "arrange.distribute") {
    return invocation.arguments?.kind === "distribution"
      ? { ok: true }
      : {
          ok: false,
          status: "invalid",
          reason: "Choose a distribution direction.",
        }
  }
  if (invocation.commandId === "mask.create") {
    return invocation.arguments?.kind === "mask-create" &&
      invocation.arguments.sourceNodeIds.length >= 1 &&
      invocation.arguments.sourceNodeIds.length <= 4 &&
      new Set(invocation.arguments.sourceNodeIds).size ===
        invocation.arguments.sourceNodeIds.length
      ? { ok: true }
      : {
          ok: false,
          status: "invalid",
          reason: "Choose from one through four unique mask source layers.",
        }
  }
  if (invocation.commandId === "mask.sources.set") {
    return invocation.arguments?.kind === "mask-sources" &&
      invocation.arguments.sourceNodeIds.length >= 1 &&
      invocation.arguments.sourceNodeIds.length <= 4 &&
      new Set(invocation.arguments.sourceNodeIds).size ===
        invocation.arguments.sourceNodeIds.length
      ? { ok: true }
      : {
          ok: false,
          status: "invalid",
          reason: "Choose from one through four unique mask source layers.",
        }
  }
  if (
    invocation.arguments &&
    invocation.arguments.kind !== "none" &&
    !(
      invocation.commandId === "object.add-text" &&
      invocation.arguments.kind === "text-preset"
    )
  ) {
    return {
      ok: false,
      status: "invalid",
      reason: "This command does not accept those options.",
    }
  }
  return { ok: true }
}

function defaultDisabledReason(
  commandId: ProductCommandId,
  context: ProductCommandRuntimeContext,
  target?: ProductCommandTarget
) {
  if (
    context.editor.reviewPending &&
    productCommandCatalog[commandId].mutating
  ) {
    return "Resolve the pending review before editing."
  }
  if (commandId === "history.undo") return "There is nothing to undo."
  if (commandId === "history.redo") return "There is nothing to redo."
  if (commandId === "object.paste") return "Copy a layer before pasting."
  if (commandId === "selection.select-all") {
    const pageId =
      target?.kind === "page" ? target.pageId : context.activePageId
    if (context.pageNodeCounts?.[pageId] === 0) {
      return "This page does not contain any layers."
    }
  }
  if (productCommandCatalog[commandId].scope === "selection") {
    if (!context.selection) return "Select a layer first."
    if (context.selection.anyLocked && commandId !== "object.lock.toggle") {
      return "Unlock the selected layers before editing."
    }
  }
  if (commandId === "object.group")
    return "Select at least two layers to group."
  if (commandId === "object.ungroup") return "Select a group to ungroup."
  if (commandId === "canvas.zoom-selection")
    return "Select a layer to zoom to it."
  if (commandId === "image.crop") {
    return context.editor.imageCropActive
      ? "Finish or cancel the active image crop first."
      : "Select one unlocked image with a ready source."
  }
  if (commandId === "image.crop.apply" || commandId === "image.crop.cancel") {
    return "No image crop is active."
  }
  if (commandId === "image.fit") return "The image is already fitted."
  if (commandId === "image.fill") return "The image already fills its frame."
  if (commandId === "image.rotation.reset")
    return "The image rotation is already zero."
  if (commandId === "image.reset-placement")
    return "The image placement is already at its default."
  if (commandId === "image.resize-frame-to-image")
    return "The image's natural size is not available."
  if (commandId.startsWith("image.frame."))
    return "The image already uses this frame shape."
  if (commandId.startsWith("image."))
    return "Select an unlocked image with a ready source."
  if (commandId.startsWith("mask.")) {
    return editorCommandDisabledReason(
      commandId as EditorCommandId,
      context.editor
    )
  }
  if (
    context.editor.imageCropActive &&
    productCommandCatalog[commandId].mutating
  ) {
    return "Finish or cancel the active image crop first."
  }
  if (commandId === "page.remove")
    return "An output must keep at least one page."
  if (commandId === "page.move-up") return "This page is already first."
  if (commandId === "page.move-down") return "This page is already last."
  if (commandId === "output.remove")
    return "A document must keep at least one output."
  if (commandId === "output.export-pdf")
    return "This output does not support PDF export."
  return "This command is not available right now."
}

function baseEnabled(
  commandId: ProductCommandId,
  context: ProductCommandRuntimeContext,
  target?: ProductCommandTarget
) {
  if (commandId === "selection.select-all") {
    const pageId =
      target?.kind === "page" ? target.pageId : context.activePageId
    if (context.pageNodeCounts?.[pageId] === 0) return false
  }
  if (commandId === "output.export-pdf" && context.pdfOutputIds) {
    const outputId =
      target?.kind === "output" ? target.outputId : context.activeOutputId
    if (!outputId || !context.pdfOutputIds.includes(outputId)) return false
  }
  if (
    productCommandCatalog[commandId].scope === "selection" &&
    productCommandCatalog[commandId].mutating &&
    context.selection?.anyLocked &&
    commandId !== "object.lock.toggle"
  ) {
    return false
  }
  if ((editorCommandIds as readonly string[]).includes(commandId)) {
    return isEditorCommandEnabled(commandId as EditorCommandId, context.editor)
  }
  if ((documentStructureCommandIds as readonly string[]).includes(commandId)) {
    const key =
      target?.kind === "page"
        ? target.pageId
        : target?.kind === "output"
          ? target.outputId
          : undefined
    const structureContext = key ? context.structureByTarget?.[key] : undefined
    return structureContext
      ? isDocumentStructureCommandEnabled(
          commandId as DocumentStructureCommandId,
          structureContext
        )
      : false
  }
  if (
    productCommandCatalog[commandId].mutating &&
    context.editor.reviewPending
  ) {
    return false
  }
  if (
    productCommandCatalog[commandId].mutating &&
    context.editor.imageCropActive &&
    !commandId.startsWith("image.crop") &&
    !commandId.startsWith("image.")
  ) {
    return false
  }
  if (productCommandCatalog[commandId].scope === "selection") {
    if (!context.selection) return false
    if (context.selection.anyLocked && commandId !== "object.lock.toggle")
      return false
  }
  if (commandId === "object.rename")
    return context.selection?.nodeIds.length === 1
  if (commandId === "arrange.align")
    return Boolean(context.selection?.nodeIds.length)
  if (commandId === "arrange.distribute")
    return (context.selection?.nodeIds.length ?? 0) >= 3
  return true
}

function invocationEnabled(
  invocation: ProductCommandInvocation,
  context: ProductCommandRuntimeContext
) {
  if (!baseEnabled(invocation.commandId, context, invocation.target)) {
    return false
  }
  if (
    invocation.commandId === "mask.sources.set" &&
    invocation.arguments?.kind === "mask-sources"
  ) {
    const sourceNodeIds = invocation.arguments.sourceNodeIds
    return Boolean(
      context.mask &&
      sourceNodeIds.every((sourceNodeId) =>
        context.mask!.eligibleSourceNodeIds.includes(sourceNodeId)
      ) &&
      !(
        context.mask.sourceNodeIds.length === sourceNodeIds.length &&
        context.mask.sourceNodeIds.every(
          (sourceNodeId, index) => sourceNodeId === sourceNodeIds[index]
        )
      )
    )
  }
  if (
    invocation.commandId === "mask.create" &&
    invocation.arguments?.kind === "mask-create"
  ) {
    const sourceNodeIds = invocation.arguments.sourceNodeIds
    return Boolean(
      context.mask &&
      sourceNodeIds.length < (context.selection?.nodeIds.length ?? 0) &&
      sourceNodeIds.every((sourceNodeId) =>
        context.mask!.eligibleSourceNodeIds.includes(sourceNodeId)
      )
    )
  }
  if (
    invocation.commandId === "arrange.forward" ||
    invocation.commandId === "arrange.backward"
  ) {
    return (
      invocation.target?.kind !== "group" &&
      context.selection?.nodeIds.length === 1
    )
  }
  if (
    invocation.commandId === "arrange.align" &&
    invocation.arguments?.kind === "alignment"
  ) {
    return invocation.arguments.relativeTo === "page"
      ? Boolean(context.selection?.nodeIds.length)
      : (context.selection?.nodeIds.length ?? 0) >= 2
  }
  return true
}

function invocationDisabledReason(
  invocation: ProductCommandInvocation,
  context: ProductCommandRuntimeContext
) {
  if (
    invocation.commandId === "mask.create" &&
    invocation.arguments?.kind === "mask-create"
  ) {
    const sourceNodeIds = invocation.arguments.sourceNodeIds
    if (sourceNodeIds.length >= (context.selection?.nodeIds.length ?? 0))
      return "Keep at least one selected layer as masked content."
    if (
      sourceNodeIds.some(
        (sourceNodeId) =>
          !context.mask?.eligibleSourceNodeIds.includes(sourceNodeId)
      )
    )
      return "Choose eligible source layers from the current selection."
  }
  if (
    invocation.commandId === "mask.sources.set" &&
    invocation.arguments?.kind === "mask-sources"
  ) {
    const sourceNodeIds = invocation.arguments.sourceNodeIds
    if (
      context.mask?.sourceNodeIds.length === sourceNodeIds.length &&
      context.mask.sourceNodeIds.every(
        (sourceNodeId, index) => sourceNodeId === sourceNodeIds[index]
      )
    ) {
      return "Those layers are already the mask sources in that order."
    }
    if (
      sourceNodeIds.some(
        (sourceNodeId) =>
          !context.mask?.eligibleSourceNodeIds.includes(sourceNodeId)
      )
    ) {
      return "Choose an unstroked, unbound rectangle, ellipse, or icon in this mask group."
    }
  }
  if (
    (invocation.commandId === "arrange.forward" ||
      invocation.commandId === "arrange.backward") &&
    (invocation.target?.kind === "group" ||
      context.selection?.nodeIds.length !== 1)
  ) {
    return "Select one layer to move it one step."
  }
  if (
    invocation.commandId === "arrange.align" &&
    invocation.arguments?.kind === "alignment" &&
    invocation.arguments.relativeTo === "selection" &&
    (context.selection?.nodeIds.length ?? 0) < 2
  ) {
    return "Select at least two layers to align them."
  }
  if (
    invocation.commandId === "arrange.distribute" &&
    (context.selection?.nodeIds.length ?? 0) < 3
  ) {
    return "Select at least three layers to distribute."
  }
  return null
}

function dynamicState(
  commandId: ProductCommandId,
  context: ProductCommandRuntimeContext
): ProductCommandStateInput {
  const supplied = context.stateByCommandId?.[commandId] ?? {}
  if (commandId === "tool.select")
    return { checked: context.activeTool === "select", ...supplied }
  if (commandId === "tool.hand")
    return { checked: context.activeTool === "hand", ...supplied }
  if (commandId === "object.visibility.toggle") {
    const selection = context.selection
    return {
      label: selection?.allVisible ? "Hide selection" : "Show selection",
      ...supplied,
    }
  }
  if (commandId === "object.lock.toggle") {
    const selection = context.selection
    return {
      label: selection?.allLocked ? "Unlock selection" : "Lock selection",
      ...supplied,
    }
  }
  if (commandId === "mask.type.vector") {
    return { checked: context.mask?.type === "vector", ...supplied }
  }
  if (commandId === "mask.type.alpha") {
    return { checked: context.mask?.type === "alpha", ...supplied }
  }
  if (commandId === "mask.type.luminance") {
    return { checked: context.mask?.type === "luminance", ...supplied }
  }
  return supplied
}

export function resolveProductCommand(
  invocation: ProductCommandInvocation,
  context: ProductCommandRuntimeContext
): ResolvedProductCommand {
  const definition = productCommandCatalog[invocation.commandId]
  const state = dynamicState(invocation.commandId, context)
  const validation = validateProductCommandInvocation(invocation, context)
  const enabledByPolicy = invocationEnabled(invocation, context)
  const enabled = validation.ok && enabledByPolicy && state.enabled !== false
  let reason: string | null = null
  if (!validation.ok) reason = validation.reason
  else if (!enabled) {
    reason =
      state.disabledReason ??
      invocationDisabledReason(invocation, context) ??
      ((editorCommandIds as readonly string[]).includes(invocation.commandId)
        ? editorCommandDisabledReason(
            invocation.commandId as EditorCommandId,
            context.editor
          )
        : null) ??
      defaultDisabledReason(invocation.commandId, context, invocation.target)
  }
  return {
    definition,
    invocation,
    label: state.label ?? definition.label,
    enabled,
    disabledReason: reason,
    checked: state.checked,
    targetDisplayName: invocation.target?.displayName ?? null,
  }
}

export function createProductCommandRuntime(input: {
  getContext: () => ProductCommandRuntimeContext
  execute: (
    invocation: ProductCommandInvocation,
    context: ProductCommandRuntimeContext
  ) => boolean
}) {
  return Object.freeze({
    resolve(invocation: ProductCommandInvocation) {
      return resolveProductCommand(invocation, input.getContext())
    },
    run(invocation: ProductCommandInvocation): ProductCommandRunResult {
      const context = input.getContext()
      const resolved = resolveProductCommand(invocation, context)
      const validation = validateProductCommandInvocation(invocation, context)
      if (!validation.ok) {
        return { status: validation.status, reason: validation.reason }
      }
      if (!resolved.enabled) {
        return {
          status: "disabled",
          reason:
            resolved.disabledReason ??
            "This command is not available right now.",
        }
      }
      return input.execute(invocation, context) === true
        ? { status: "accepted" }
        : { status: "declined" }
    },
  })
}

export type ProductMenuCommandItem = Readonly<{
  type: "command"
  command: ResolvedProductCommand
}>
export type ProductMenuSeparator = Readonly<{ type: "separator" }>
export type ProductMenuExplanation = Readonly<{
  type: "explanation"
  text: string
}>
export type ProductMenuSubmenu = Readonly<{
  type: "submenu"
  id: string
  label: string
  items: readonly ProductMenuItem[]
}>
export type ProductMenuItem =
  | ProductMenuCommandItem
  | ProductMenuSeparator
  | ProductMenuExplanation
  | ProductMenuSubmenu

export type ProductMenuGroup = Readonly<{
  id: string
  label?: string
  items: readonly ProductMenuItem[]
}>

export type ProductAppMenu = Readonly<{
  id: ProductCommandCategory
  label: string
  groups: readonly ProductMenuGroup[]
}>

const separator = (): ProductMenuSeparator => ({ type: "separator" })

function commandItem(
  commandId: ProductCommandId,
  context: ProductCommandRuntimeContext,
  target?: ProductCommandTarget,
  args?: ProductCommandArguments
): ProductMenuCommandItem {
  return {
    type: "command",
    command: resolveProductCommand(
      {
        commandId,
        ...(target ? { target } : {}),
        ...(args ? { arguments: args } : {}),
      },
      context
    ),
  }
}

function submenu(
  id: string,
  label: string,
  items: readonly ProductMenuItem[]
): ProductMenuSubmenu {
  return { type: "submenu", id, label, items }
}

function targetFor(
  context: ProductCommandRuntimeContext,
  scope: ProductCommandScope
): ProductCommandTarget | undefined {
  if (scope === "document") {
    return {
      kind: "document",
      documentId: context.documentId,
      snapshotId: context.snapshotId,
      displayName: context.documentDisplayName ?? "Current document",
    }
  }
  if (scope === "selection" && context.selection) {
    return {
      kind: "selection",
      documentId: context.documentId,
      snapshotId: context.snapshotId,
      displayName:
        context.selection.nodeIds.length === 1
          ? "Selected layer"
          : `${context.selection.nodeIds.length} selected layers`,
      pageId: context.selection.pageId,
      nodeIds: context.selection.nodeIds,
      groupId: context.selection.groupId ?? null,
    }
  }
  if (scope === "group" && context.mask?.groupId) {
    return {
      kind: "group",
      documentId: context.documentId,
      snapshotId: context.snapshotId,
      displayName: "Selected mask",
      pageId: context.activePageId,
      groupId: context.mask.groupId,
    }
  }
  if (scope === "page") {
    return {
      kind: "page",
      documentId: context.documentId,
      snapshotId: context.snapshotId,
      displayName:
        context.pageDisplayNames?.[context.activePageId] ?? "Current page",
      pageId: context.activePageId,
    }
  }
  if (scope === "output" && context.activeOutputId) {
    return {
      kind: "output",
      documentId: context.documentId,
      snapshotId: context.snapshotId,
      displayName:
        context.outputDisplayNames?.[context.activeOutputId] ?? "Active output",
      outputId: context.activeOutputId,
    }
  }
  return undefined
}

function itemFor(
  id: ProductCommandId,
  context: ProductCommandRuntimeContext,
  args?: ProductCommandArguments
) {
  const argumentsForCommand =
    args ??
    (id === "mask.create" && context.mask?.createSourceNodeIds.length === 1
      ? {
          kind: "mask-create" as const,
          sourceNodeIds: [context.mask.createSourceNodeIds[0]!] as const,
        }
      : id === "mask.sources.set" &&
          context.mask?.reassignmentSourceNodeIds.length === 1
        ? {
            kind: "mask-sources" as const,
            sourceNodeIds: [
              context.mask.reassignmentSourceNodeIds[0]!,
            ] as const,
          }
        : undefined)
  return commandItem(
    id,
    context,
    targetFor(context, productCommandCatalog[id].scope),
    argumentsForCommand
  )
}

const alignmentItems = (
  context: ProductCommandRuntimeContext,
  relativeTo: "selection" | "page"
) =>
  (
    [
      ["left", "Align left"],
      ["horizontal-center", "Align horizontal centers"],
      ["right", "Align right"],
      ["top", "Align top"],
      ["vertical-center", "Align vertical centers"],
      ["bottom", "Align bottom"],
    ] as const
  ).map(([alignment, label]) => {
    const item = itemFor("arrange.align", context, {
      kind: "alignment",
      alignment,
      relativeTo,
    })
    return {
      ...item,
      command: { ...item.command, label },
    }
  })

const arrangeSubmenus = (context: ProductCommandRuntimeContext) => [
  submenu("arrange-order", "Order", [
    itemFor("arrange.front", context),
    itemFor("arrange.forward", context),
    separator(),
    itemFor("arrange.backward", context),
    itemFor("arrange.back", context),
  ]),
  submenu(
    "arrange-align-selection",
    "Align selection",
    alignmentItems(context, "selection")
  ),
  submenu(
    "arrange-align-page",
    "Align to page",
    alignmentItems(context, "page")
  ),
  submenu("arrange-distribute", "Distribute", [
    itemFor("arrange.distribute", context, {
      kind: "distribution",
      distribution: "horizontal",
    }),
    itemFor("arrange.distribute", context, {
      kind: "distribution",
      distribution: "vertical",
    }),
  ]),
]

const imageItems = (context: ProductCommandRuntimeContext) => [
  itemFor("image.replace", context),
  itemFor("image.crop", context),
  separator(),
  itemFor("image.fit", context),
  itemFor("image.fill", context),
  separator(),
  itemFor("image.flip-horizontal", context),
  itemFor("image.flip-vertical", context),
  itemFor("image.rotate-left", context),
  itemFor("image.rotate-right", context),
  itemFor("image.rotation.reset", context),
  itemFor("image.reset-placement", context),
  separator(),
  submenu("image-frame", "Frame shape", [
    itemFor("image.frame.rectangle", context),
    itemFor("image.frame.rounded-rectangle", context),
    itemFor("image.frame.ellipse", context),
  ]),
]

const maskItems = (context: ProductCommandRuntimeContext) => [
  itemFor("mask.create", context),
  itemFor("mask.release", context),
  submenu("mask-type", "Mask type", [
    itemFor("mask.type.vector", context),
    itemFor("mask.type.alpha", context),
    itemFor("mask.type.luminance", context),
  ]),
  itemFor("mask.sources.set", context),
]

export function buildProductAppMenus(
  context: ProductCommandRuntimeContext
): readonly ProductAppMenu[] {
  return [
    {
      id: "file",
      label: "File",
      groups: [
        {
          id: "document",
          items: [
            itemFor("document.home", context),
            itemFor("document.new", context),
            itemFor("document.import-json", context),
            itemFor("document.import-quotation", context),
          ],
        },
        {
          id: "export",
          items: [
            itemFor("document.export-json", context),
            itemFor("output.export-png", context),
            itemFor("output.export-pdf", context),
          ],
        },
        {
          id: "publish",
          items: [
            itemFor("document.publish", context),
            itemFor("developer.api-playground", context),
          ],
        },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      groups: [
        {
          id: "history",
          items: [
            itemFor("history.undo", context),
            itemFor("history.redo", context),
          ],
        },
        {
          id: "clipboard",
          items: [
            itemFor("selection.copy", context),
            itemFor("object.paste", context),
            itemFor("object.duplicate", context),
            itemFor("object.delete", context),
          ],
        },
        { id: "selection", items: [itemFor("selection.select-all", context)] },
      ],
    },
    {
      id: "view",
      label: "View",
      groups: [
        {
          id: "tools",
          items: [
            itemFor("tool.select", context),
            itemFor("tool.hand", context),
          ],
        },
        {
          id: "zoom",
          items: [
            itemFor("canvas.zoom-in", context),
            itemFor("canvas.zoom-out", context),
            itemFor("canvas.zoom-reset", context),
            itemFor("canvas.fit", context),
            itemFor("canvas.zoom-selection", context),
          ],
        },
        {
          id: "guides",
          items: [
            itemFor("canvas.rulers.toggle", context),
            itemFor("canvas.guides.toggle", context),
            itemFor("canvas.guides.manage", context),
          ],
        },
        { id: "search", items: [itemFor("command.search", context)] },
      ],
    },
    {
      id: "object",
      label: "Object",
      groups: [
        {
          id: "insert",
          items: [
            itemFor("image.insert", context),
            itemFor("object.add-rectangle", context),
            itemFor("object.add-ellipse", context),
            itemFor("object.add-line", context),
          ],
        },
        {
          id: "structure",
          items: [
            itemFor("object.group", context),
            itemFor("object.ungroup", context),
            itemFor("object.rename", context),
            separator(),
            ...maskItems(context),
          ],
        },
        {
          id: "state",
          items: [
            itemFor("object.visibility.toggle", context),
            itemFor("object.lock.toggle", context),
          ],
        },
        {
          id: "image",
          items: [submenu("object-image", "Image", imageItems(context))],
        },
      ],
    },
    {
      id: "text",
      label: "Text",
      groups: [{ id: "insert", items: [itemFor("object.add-text", context)] }],
    },
    {
      id: "arrange",
      label: "Arrange",
      groups: [{ id: "arrange", items: arrangeSubmenus(context) }],
    },
    {
      id: "help",
      label: "Help",
      groups: [
        {
          id: "discovery",
          items: [
            itemFor("command.search", context),
            itemFor("help.shortcuts", context),
          ],
        },
      ],
    },
  ]
}

export type ProductPaletteItem = ResolvedProductCommand &
  Readonly<{
    categoryLabel: string
    shortcut: string | null
    searchText: string
  }>

export type ProductShortcutPlatform = EditorShortcutPlatform | "linux"

export function formatProductCommandShortcut(
  commandId: ProductCommandId,
  platform: ProductShortcutPlatform
) {
  if ((editorCommandIds as readonly string[]).includes(commandId)) {
    return formatEditorShortcut(
      commandId as EditorCommandId,
      platform === "mac" ? "mac" : "windows"
    )
  }
  const shortcut = productCommandCatalog[commandId].shortcuts[0]
  if (!shortcut) return null
  const key = shortcut.code.replace(/^Key/, "")
  if (platform === "mac") {
    return `${shortcut.primary ? "⌘" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.alt ? "⌥" : ""}${key}`
  }
  return [
    shortcut.primary ? "Ctrl" : null,
    shortcut.shift ? "Shift" : null,
    shortcut.alt ? "Alt" : null,
    key,
  ]
    .filter(Boolean)
    .join("+")
}

/**
 * Complete serializable command-policy projection shared by non-visual
 * adapters. Unlike the palette projection, this includes commands that are
 * intentionally absent from command search and expands every typed argument
 * variant before resolving it through the canonical policy owner.
 */
export function projectProductCommandCapabilities(
  context: ProductCommandRuntimeContext
): readonly ResolvedProductCommand[] {
  return productCommandIds.flatMap((commandId) => {
    if (commandId === "arrange.align") {
      return [
        ...alignmentItems(context, "selection"),
        ...alignmentItems(context, "page"),
      ].map((item) => item.command)
    }
    if (commandId === "arrange.distribute") {
      return (["horizontal", "vertical"] as const).map((distribution) => {
        const resolved = itemFor("arrange.distribute", context, {
          kind: "distribution",
          distribution,
        }).command
        return { ...resolved, label: `Distribute ${distribution}` }
      })
    }
    return [itemFor(commandId, context).command]
  })
}

export function projectProductCommandPalette(
  context: ProductCommandRuntimeContext,
  platform: ProductShortcutPlatform
): readonly ProductPaletteItem[] {
  const project = (resolved: ResolvedProductCommand): ProductPaletteItem => {
    const { definition } = resolved
    const shortcut = formatProductCommandShortcut(
      resolved.invocation.commandId,
      platform
    )
    return {
      ...resolved,
      categoryLabel:
        definition.category[0]!.toUpperCase() + definition.category.slice(1),
      shortcut,
      searchText: [
        ...definition.keywords,
        ...definition.alternateNames,
        resolved.label,
        shortcut ?? "",
      ]
        .join(" ")
        .toLowerCase(),
    }
  }
  return projectProductCommandCapabilities(context)
    .filter(({ definition }) => definition.discoverable)
    .map(project)
}

export type ProductContextKind = "blank-canvas" | "selection" | "layer"

export function buildCanvasContextMenu(
  context: ProductCommandRuntimeContext
): readonly ProductMenuGroup[] {
  if (!context.selection) {
    return [
      {
        id: "clipboard",
        items: [
          itemFor("object.paste", context),
          itemFor("selection.select-all", context),
        ],
      },
      {
        id: "insert",
        items: [
          submenu("canvas-insert", "Insert", [
            itemFor("object.add-text", context),
            itemFor("image.insert", context),
            itemFor("object.add-rectangle", context),
            itemFor("object.add-ellipse", context),
            itemFor("object.add-line", context),
          ]),
        ],
      },
      {
        id: "view",
        items: [
          submenu("canvas-view", "View", [
            itemFor("canvas.fit", context),
            itemFor("canvas.zoom-in", context),
            itemFor("canvas.zoom-out", context),
            itemFor("canvas.zoom-reset", context),
            separator(),
            itemFor("canvas.rulers.toggle", context),
            itemFor("canvas.guides.toggle", context),
            itemFor("canvas.guides.manage", context),
          ]),
        ],
      },
    ]
  }
  const allImages = context.selection.nodeTypes.every(
    (type) => type === "image"
  )
  return [
    {
      id: "edit",
      items: [
        itemFor("selection.copy", context),
        itemFor("object.duplicate", context),
        itemFor("object.delete", context),
      ],
    },
    { id: "arrange", items: arrangeSubmenus(context) },
    {
      id: "object",
      items: [
        itemFor("object.group", context),
        itemFor("object.ungroup", context),
        itemFor("object.rename", context),
        separator(),
        itemFor("object.visibility.toggle", context),
        itemFor("object.lock.toggle", context),
        separator(),
        ...maskItems(context),
      ],
    },
    ...(allImages ? [{ id: "image", items: imageItems(context) }] : []),
  ]
}

export function buildLayerContextMenu(
  context: ProductCommandRuntimeContext,
  target: Extract<ProductCommandTarget, { kind: "node" | "group" }>
): readonly ProductMenuGroup[] {
  const selectionTarget = targetFor(context, "selection")
  const capturedTarget =
    selectionTarget?.kind === "selection"
      ? { ...selectionTarget, displayName: target.displayName }
      : target
  const targetItem = (id: ProductCommandId, args?: ProductCommandArguments) =>
    commandItem(id, context, capturedTarget, args)
  return [
    { id: "identity", items: [targetItem("object.rename")] },
    {
      id: "edit",
      items: [
        targetItem("selection.copy"),
        targetItem("object.duplicate"),
        targetItem("object.delete"),
      ],
    },
    {
      id: "arrange",
      items: [
        submenu("layer-order", "Order", [
          targetItem("arrange.front"),
          targetItem("arrange.forward"),
          separator(),
          targetItem("arrange.backward"),
          targetItem("arrange.back"),
        ]),
      ],
    },
    {
      id: "state",
      items: [
        targetItem("object.visibility.toggle"),
        targetItem("object.lock.toggle"),
      ],
    },
    { id: "mask", items: maskItems(context) },
  ]
}

export function buildPageContextMenu(
  context: ProductCommandRuntimeContext,
  target: Extract<ProductCommandTarget, { kind: "page" }>
): readonly ProductMenuGroup[] {
  return [
    {
      id: "page",
      items: [
        commandItem("page.update", context, target),
        commandItem("page.duplicate", context, target),
        commandItem("page.add", context, target),
      ],
    },
    {
      id: "order",
      items: [
        commandItem("page.move-up", context, target),
        commandItem("page.move-down", context, target),
      ],
    },
    { id: "danger", items: [commandItem("page.remove", context, target)] },
  ]
}

export function buildOutputContextMenu(
  context: ProductCommandRuntimeContext,
  target: Extract<ProductCommandTarget, { kind: "output" }>
): readonly ProductMenuGroup[] {
  return [
    {
      id: "output",
      items: [
        commandItem("output.update", context, target),
        commandItem("output.add", context, target),
      ],
    },
    {
      id: "export",
      items: [commandItem("output.export-pdf", context, target)],
    },
    { id: "danger", items: [commandItem("output.remove", context, target)] },
  ]
}

export function buildSelectedImageMenu(
  context: ProductCommandRuntimeContext
): readonly ProductMenuGroup[] {
  return [{ id: "image", items: imageItems(context) }]
}
