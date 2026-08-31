import type {
  ImageFrameMask,
  ImagePlacement,
  SceneNode,
} from "@webmcp/document"
import type { InspectorNodeCapabilities } from "./inspector"

export const editorImageCommandIds = [
  "image.insert",
  "image.replace",
  "image.crop",
  "image.crop.apply",
  "image.crop.cancel",
  "image.fit",
  "image.fill",
  "image.flip-horizontal",
  "image.flip-vertical",
  "image.rotate-left",
  "image.rotate-right",
  "image.rotation.reset",
  "image.reset-placement",
  "image.resize-frame-to-image",
  "image.frame.rectangle",
  "image.frame.rounded-rectangle",
  "image.frame.ellipse",
] as const

export type EditorImageCommandId = (typeof editorImageCommandIds)[number]

export const editorCommandIds = [
  "tool.select",
  "tool.hand",
  "canvas.fit",
  "canvas.zoom-selection",
  "canvas.zoom-in",
  "canvas.zoom-out",
  "canvas.zoom-reset",
  "selection.select-all",
  "selection.copy",
  "selection.nudge-left",
  "selection.nudge-right",
  "selection.nudge-up",
  "selection.nudge-down",
  "history.undo",
  "history.redo",
  ...editorImageCommandIds,
  "object.add-text",
  "object.add-rectangle",
  "object.add-ellipse",
  "object.add-line",
  "object.paste",
  "object.duplicate",
  "object.group",
  "object.ungroup",
  "mask.create",
  "mask.release",
  "mask.type.vector",
  "mask.type.alpha",
  "mask.type.luminance",
  "mask.sources.set",
  "object.delete",
] as const

export type EditorCommandId = (typeof editorCommandIds)[number]

export type EditorMaskCommandId = Extract<EditorCommandId, `mask.${string}`>

export type EditorMaskCommandCapabilities = Readonly<{
  canCreate: boolean
  createDisabledReason: string | null
  canRelease: boolean
  releaseDisabledReason: string | null
  canSetVector: boolean
  vectorDisabledReason: string | null
  canSetAlpha: boolean
  alphaDisabledReason: string | null
  canSetLuminance: boolean
  luminanceDisabledReason: string | null
  canSetSources: boolean
  sourcesDisabledReason: string | null
}>

export type EditorImageCommandCapabilities = Readonly<{
  canInsert: boolean
  canReplace: boolean
  replaceDisabledReason: string | null
  canEnterCrop: boolean
  canApplyCrop: boolean
  canCancelCrop: boolean
  canFit: boolean
  canFill: boolean
  canFlip: boolean
  canRotate: boolean
  canResetRotation: boolean
  canResetPlacement: boolean
  canResizeFrameToImage: boolean
  canSetRectangleFrame: boolean
  canSetRoundedRectangleFrame: boolean
  canSetEllipseFrame: boolean
  cropDraftChanged: boolean
}>

export type DeriveEditorImageCommandCapabilitiesOptions = Readonly<{
  selectedNodes: readonly SceneNode[]
  inspectorCapabilities: InspectorNodeCapabilities
  documentEditable: boolean
  imageCropActive: boolean
  imageCropDraftChanged?: boolean
  /** True only after the crop session owns frame-mask draft state. */
  cropFrameMaskDraftSupported?: boolean
  /** True only when the host can project verified natural image dimensions. */
  resizeFrameToImageSupported?: boolean
  activeImagePlacement?: Readonly<ImagePlacement> | null
  activeImageFrameMask?: Readonly<ImageFrameMask> | null
}>

const isDefaultImagePlacement = (placement: Readonly<ImagePlacement>) =>
  placement.mode === "fill" &&
  placement.focalX === 0.5 &&
  placement.focalY === 0.5 &&
  placement.zoom === 1 &&
  placement.rotation === 0 &&
  !placement.flipX &&
  !placement.flipY

const sameImagePlacement = (
  left: Readonly<ImagePlacement>,
  right: Readonly<ImagePlacement>
) =>
  left.mode === right.mode &&
  left.focalX === right.focalX &&
  left.focalY === right.focalY &&
  left.zoom === right.zoom &&
  left.rotation === right.rotation &&
  left.flipX === right.flipX &&
  left.flipY === right.flipY

const normalizeImageRotation = (rotation: number) =>
  ((((rotation + 180) % 360) + 360) % 360) - 180

export type EditorImagePlacementCommandId = Extract<
  EditorImageCommandId,
  | "image.fit"
  | "image.fill"
  | "image.flip-horizontal"
  | "image.flip-vertical"
  | "image.rotate-left"
  | "image.rotate-right"
  | "image.rotation.reset"
  | "image.reset-placement"
>

export type EditorImagePlacementCommandDraft = Readonly<{
  type: "set_image_placement"
  nodeId: string
  placement: ImagePlacement
}>

export const applyEditorImagePlacementCommand = (
  commandId: EditorImagePlacementCommandId,
  placement: Readonly<ImagePlacement>
): ImagePlacement => {
  switch (commandId) {
    case "image.fit":
      return { ...placement, mode: "fit" }
    case "image.fill":
      return { ...placement, mode: "fill" }
    case "image.flip-horizontal":
      return { ...placement, flipX: !placement.flipX }
    case "image.flip-vertical":
      return { ...placement, flipY: !placement.flipY }
    case "image.rotate-left":
      return {
        ...placement,
        rotation: normalizeImageRotation(placement.rotation - 90),
      }
    case "image.rotate-right":
      return {
        ...placement,
        rotation: normalizeImageRotation(placement.rotation + 90),
      }
    case "image.rotation.reset":
      return { ...placement, rotation: 0 }
    case "image.reset-placement":
      return {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      }
  }
}

export function createImagePlacementCommandDrafts(
  commandId: EditorImagePlacementCommandId,
  selectedNodes: readonly SceneNode[]
): readonly EditorImagePlacementCommandDraft[] {
  return selectedNodes.flatMap((node) => {
    if (node.type !== "image" || node.locked || !node.visible) return []
    const placement = applyEditorImagePlacementCommand(
      commandId,
      node.placement
    )
    return sameImagePlacement(node.placement, placement)
      ? []
      : [{ type: "set_image_placement", nodeId: node.id, placement }]
  })
}

export type EditorImageFrameCommandId = Extract<
  EditorImageCommandId,
  | "image.frame.rectangle"
  | "image.frame.rounded-rectangle"
  | "image.frame.ellipse"
>

export type EditorImageFrameCommandDraft = Readonly<{
  type: "set_image_frame_mask"
  nodeId: string
  frameMask: ImageFrameMask
}>

export const applyEditorImageFrameCommand = (
  commandId: EditorImageFrameCommandId,
  current: Readonly<ImageFrameMask>
): ImageFrameMask => {
  switch (commandId) {
    case "image.frame.rectangle":
      return { shape: "rectangle" }
    case "image.frame.rounded-rectangle":
      return {
        shape: "rounded_rectangle",
        radius: current.shape === "rounded_rectangle" ? current.radius : 0.12,
      }
    case "image.frame.ellipse":
      return { shape: "ellipse" }
  }
}

export function createImageFrameCommandDrafts(
  commandId: EditorImageFrameCommandId,
  selectedNodes: readonly SceneNode[]
): readonly EditorImageFrameCommandDraft[] {
  return selectedNodes.flatMap((node) => {
    if (node.type !== "image" || node.locked || !node.visible) return []
    const frameMask = applyEditorImageFrameCommand(commandId, node.frameMask)
    return node.frameMask.shape === frameMask.shape
      ? []
      : [{ type: "set_image_frame_mask", nodeId: node.id, frameMask }]
  })
}

export function deriveEditorImageCommandCapabilities({
  selectedNodes,
  inspectorCapabilities,
  documentEditable,
  imageCropActive,
  imageCropDraftChanged = false,
  cropFrameMaskDraftSupported = false,
  resizeFrameToImageSupported = false,
  activeImagePlacement,
  activeImageFrameMask,
}: DeriveEditorImageCommandCapabilitiesOptions): EditorImageCommandCapabilities {
  const selectedImages = selectedNodes.filter(
    (node): node is Extract<SceneNode, { type: "image" }> =>
      node.type === "image"
  )
  const placements = activeImagePlacement
    ? [activeImagePlacement]
    : selectedImages.map((node) => node.placement)
  const frameMasks = activeImageFrameMask
    ? [activeImageFrameMask]
    : selectedImages.map((node) => node.frameMask)
  const canTransform = inspectorCapabilities.canFlipImage
  const canSetFrame =
    inspectorCapabilities.canApplyFrameMask &&
    (!imageCropActive || cropFrameMaskDraftSupported)

  return {
    canInsert: documentEditable && !imageCropActive,
    canReplace: inspectorCapabilities.canReplaceImage,
    replaceDisabledReason: inspectorCapabilities.replaceImageDisabledReason,
    canEnterCrop: inspectorCapabilities.canEnterCrop,
    // Done remains available for an unchanged draft because it is also the
    // explicit, non-destructive way to leave crop mode.
    canApplyCrop: imageCropActive,
    canCancelCrop: imageCropActive,
    canFit:
      canTransform && placements.some((placement) => placement.mode !== "fit"),
    canFill:
      canTransform && placements.some((placement) => placement.mode !== "fill"),
    canFlip: canTransform,
    canRotate: canTransform,
    canResetRotation:
      canTransform && placements.some((placement) => placement.rotation !== 0),
    canResetPlacement:
      canTransform &&
      placements.some((placement) => !isDefaultImagePlacement(placement)),
    canResizeFrameToImage:
      documentEditable &&
      imageCropActive &&
      resizeFrameToImageSupported &&
      selectedImages.length === 1 &&
      canTransform,
    canSetRectangleFrame:
      canSetFrame && frameMasks.some((mask) => mask.shape !== "rectangle"),
    canSetRoundedRectangleFrame:
      canSetFrame &&
      frameMasks.some((mask) => mask.shape !== "rounded_rectangle"),
    canSetEllipseFrame:
      canSetFrame && frameMasks.some((mask) => mask.shape !== "ellipse"),
    cropDraftChanged: imageCropDraftChanged,
  }
}

export type EditorCommandContext = {
  reviewPending: boolean
  hasSelection: boolean
  selectedNodeCount: number
  hasSelectedGroup: boolean
  hasClipboard: boolean
  hasUndo: boolean
  hasRedo: boolean
  hasZoomSelection: boolean
  canCropImage: boolean
  canTransformImage?: boolean
  imageCropActive: boolean
  /** Canonical image command policy. Legacy image fields remain during wiring. */
  image?: EditorImageCommandCapabilities
  mask?: EditorMaskCommandCapabilities
}

export function isEditorCommandEnabled(
  commandId: EditorCommandId,
  context: EditorCommandContext
) {
  if (context.reviewPending && isMutatingEditorCommand(commandId)) return false

  switch (commandId) {
    case "tool.select":
    case "tool.hand":
      return !context.imageCropActive
    case "canvas.zoom-selection":
      return context.hasZoomSelection
    case "selection.copy":
    case "selection.nudge-left":
    case "selection.nudge-right":
    case "selection.nudge-up":
    case "selection.nudge-down":
    case "object.duplicate":
    case "object.delete":
      return context.hasSelection
    case "history.undo":
      return context.hasUndo
    case "history.redo":
      return context.hasRedo
    case "object.paste":
      return context.hasClipboard
    case "object.group":
      return context.selectedNodeCount > 1
    case "object.ungroup":
      return context.hasSelectedGroup
    case "mask.create":
      return context.mask?.canCreate ?? false
    case "mask.release":
      return context.mask?.canRelease ?? false
    case "mask.type.vector":
      return context.mask?.canSetVector ?? false
    case "mask.type.alpha":
      return context.mask?.canSetAlpha ?? false
    case "mask.type.luminance":
      return context.mask?.canSetLuminance ?? false
    case "mask.sources.set":
      return context.mask?.canSetSources ?? false
    case "image.insert":
      return context.image?.canInsert ?? !context.imageCropActive
    case "image.replace":
      return context.image?.canReplace ?? false
    case "image.crop":
      return (
        context.image?.canEnterCrop ??
        (context.canCropImage && !context.imageCropActive)
      )
    case "image.crop.apply":
      return context.image?.canApplyCrop ?? context.imageCropActive
    case "image.crop.cancel":
      return context.image?.canCancelCrop ?? context.imageCropActive
    case "image.fit":
      return context.image?.canFit ?? false
    case "image.fill":
      return context.image?.canFill ?? false
    case "image.flip-horizontal":
    case "image.flip-vertical":
      return (
        context.image?.canFlip ??
        (context.imageCropActive ||
          Boolean(context.canTransformImage ?? context.canCropImage))
      )
    case "image.rotate-left":
    case "image.rotate-right":
      return context.image?.canRotate ?? false
    case "image.rotation.reset":
      return context.image?.canResetRotation ?? false
    case "image.reset-placement":
      return context.image?.canResetPlacement ?? false
    case "image.resize-frame-to-image":
      return context.image?.canResizeFrameToImage ?? false
    case "image.frame.rectangle":
      return context.image?.canSetRectangleFrame ?? false
    case "image.frame.rounded-rectangle":
      return context.image?.canSetRoundedRectangleFrame ?? false
    case "image.frame.ellipse":
      return context.image?.canSetEllipseFrame ?? false
    default:
      return true
  }
}

export type EditorCommandCapability = Readonly<{
  id: EditorCommandId
  label: string
  enabled: boolean
  reason?: string
}>

export function editorCommandDisabledReason(
  commandId: EditorCommandId,
  context: EditorCommandContext
): string | null {
  if (isEditorCommandEnabled(commandId, context)) return null
  if (commandId === "image.replace") {
    return context.image?.replaceDisabledReason ?? null
  }
  if (commandId === "mask.create")
    return context.mask?.createDisabledReason ?? null
  if (commandId === "mask.release")
    return context.mask?.releaseDisabledReason ?? null
  if (commandId === "mask.type.vector")
    return context.mask?.vectorDisabledReason ?? null
  if (commandId === "mask.type.alpha")
    return context.mask?.alphaDisabledReason ?? null
  if (commandId === "mask.type.luminance")
    return context.mask?.luminanceDisabledReason ?? null
  if (commandId === "mask.sources.set")
    return context.mask?.sourcesDisabledReason ?? null
  return null
}

/**
 * Public, serializable projection of the exact command policy used by the UI.
 * Hosts may attach runtime-specific disabled reasons at their API boundary,
 * but must not reimplement enablement from selection or document shape.
 */
export function projectEditorCommandCapabilities(
  context: EditorCommandContext
): readonly EditorCommandCapability[] {
  return editorCommandIds.map((id) => {
    const reason = editorCommandDisabledReason(id, context)
    return {
      id,
      label: editorCommandLabel(id),
      enabled: isEditorCommandEnabled(id, context),
      ...(reason ? { reason } : {}),
    }
  })
}

export type EditorImageCommandHandler = () => boolean | void
type EditorImageCommandWithOptionalHostIntegration =
  "image.resize-frame-to-image"
export type EditorImageCommandHandlers = Readonly<
  Record<
    Exclude<
      EditorImageCommandId,
      EditorImageCommandWithOptionalHostIntegration
    >,
    EditorImageCommandHandler
  > &
    Partial<
      Record<
        EditorImageCommandWithOptionalHostIntegration,
        EditorImageCommandHandler
      >
    >
>

/**
 * Shared route for every visible image action. The host injects product and UI
 * handlers, while this package remains the sole enablement gate.
 */
export function dispatchEditorImageCommand(
  commandId: EditorImageCommandId,
  context: EditorCommandContext,
  handlers: EditorImageCommandHandlers
) {
  if (!isEditorCommandEnabled(commandId, context)) return false
  const handler = handlers[commandId]
  return handler ? handler() !== false : false
}

export type EditorShortcutMode = "always" | "crop-active" | "crop-inactive"

export type EditorShortcut = {
  commandId: EditorCommandId
  code: string
  primary?: boolean
  shift?: boolean
  alt?: boolean
  mode?: EditorShortcutMode
}

export type EditorCommandDefinition = Readonly<{
  label: string
  historyLabel?: string
  mutating: boolean
  shortcuts?: readonly Omit<EditorShortcut, "commandId">[]
}>

export const editorCommandRegistry = {
  "tool.select": {
    label: "Select tool",
    mutating: false,
    shortcuts: [{ code: "KeyV" }],
  },
  "tool.hand": {
    label: "Hand tool",
    mutating: false,
    shortcuts: [{ code: "KeyH" }],
  },
  "canvas.fit": {
    label: "Fit canvas",
    mutating: false,
    shortcuts: [{ code: "Digit1", shift: true }],
  },
  "canvas.zoom-selection": {
    label: "Zoom to selection",
    mutating: false,
    shortcuts: [{ code: "Digit2", shift: true }],
  },
  "canvas.zoom-in": {
    label: "Zoom in",
    mutating: false,
    shortcuts: [{ code: "Equal", primary: true }],
  },
  "canvas.zoom-out": {
    label: "Zoom out",
    mutating: false,
    shortcuts: [{ code: "Minus", primary: true }],
  },
  "canvas.zoom-reset": {
    label: "Reset zoom",
    mutating: false,
    shortcuts: [{ code: "Digit0", primary: true }],
  },
  "selection.select-all": {
    label: "Select all",
    mutating: false,
    shortcuts: [{ code: "KeyA", primary: true }],
  },
  "selection.copy": {
    label: "Copy",
    mutating: false,
    shortcuts: [{ code: "KeyC", primary: true }],
  },
  "selection.nudge-left": {
    label: "Nudge left",
    mutating: true,
    shortcuts: [{ code: "ArrowLeft" }],
  },
  "selection.nudge-right": {
    label: "Nudge right",
    mutating: true,
    shortcuts: [{ code: "ArrowRight" }],
  },
  "selection.nudge-up": {
    label: "Nudge up",
    mutating: true,
    shortcuts: [{ code: "ArrowUp" }],
  },
  "selection.nudge-down": {
    label: "Nudge down",
    mutating: true,
    shortcuts: [{ code: "ArrowDown" }],
  },
  "history.undo": {
    label: "Undo",
    mutating: true,
    shortcuts: [{ code: "KeyZ", primary: true }],
  },
  "history.redo": {
    label: "Redo",
    mutating: true,
    shortcuts: [{ code: "KeyZ", primary: true, shift: true }],
  },
  "image.insert": {
    label: "Add image",
    historyLabel: "Add image",
    mutating: true,
  },
  "image.replace": {
    label: "Replace image…",
    historyLabel: "Replace image",
    mutating: true,
  },
  "image.crop": {
    label: "Crop image",
    historyLabel: "Crop image",
    mutating: true,
    shortcuts: [{ code: "Enter", mode: "crop-inactive" }],
  },
  "image.crop.apply": {
    label: "Apply crop",
    historyLabel: "Crop image",
    mutating: true,
    shortcuts: [{ code: "Enter", mode: "crop-active" }],
  },
  "image.crop.cancel": {
    label: "Cancel crop",
    mutating: true,
    shortcuts: [
      { code: "Escape", mode: "crop-active" },
      { code: "KeyZ", primary: true, mode: "crop-active" },
    ],
  },
  "image.fit": {
    label: "Fit image",
    historyLabel: "Fit image",
    mutating: true,
  },
  "image.fill": {
    label: "Fill frame",
    historyLabel: "Fill frame",
    mutating: true,
  },
  "image.flip-horizontal": {
    label: "Flip image horizontally",
    historyLabel: "Flip image horizontally",
    mutating: true,
    shortcuts: [{ code: "KeyH", shift: true }],
  },
  "image.flip-vertical": {
    label: "Flip image vertically",
    historyLabel: "Flip image vertically",
    mutating: true,
    shortcuts: [{ code: "KeyV", shift: true }],
  },
  "image.rotate-left": {
    label: "Rotate image 90° left",
    historyLabel: "Rotate image left",
    mutating: true,
  },
  "image.rotate-right": {
    label: "Rotate image 90° right",
    historyLabel: "Rotate image right",
    mutating: true,
  },
  "image.rotation.reset": {
    label: "Reset image rotation",
    historyLabel: "Reset image rotation",
    mutating: true,
  },
  "image.reset-placement": {
    label: "Reset crop",
    historyLabel: "Reset crop",
    mutating: true,
  },
  "image.resize-frame-to-image": {
    label: "Resize frame to image",
    historyLabel: "Resize frame to image",
    mutating: true,
  },
  "image.frame.rectangle": {
    label: "Rectangle image frame",
    historyLabel: "Change image frame",
    mutating: true,
  },
  "image.frame.rounded-rectangle": {
    label: "Rounded rectangle image frame",
    historyLabel: "Change image frame",
    mutating: true,
  },
  "image.frame.ellipse": {
    label: "Ellipse image frame",
    historyLabel: "Change image frame",
    mutating: true,
  },
  "object.add-text": {
    label: "Add text",
    mutating: true,
    shortcuts: [{ code: "KeyT" }],
  },
  "object.add-rectangle": {
    label: "Add rectangle",
    mutating: true,
    shortcuts: [{ code: "KeyR" }],
  },
  "object.add-ellipse": {
    label: "Add ellipse",
    mutating: true,
    shortcuts: [{ code: "KeyO" }],
  },
  "object.add-line": {
    label: "Add line",
    mutating: true,
    shortcuts: [{ code: "KeyL" }],
  },
  "object.paste": {
    label: "Paste",
    mutating: true,
    shortcuts: [{ code: "KeyV", primary: true }],
  },
  "object.duplicate": {
    label: "Duplicate",
    mutating: true,
    shortcuts: [{ code: "KeyD", primary: true }],
  },
  "object.group": {
    label: "Group",
    mutating: true,
    shortcuts: [{ code: "KeyG", primary: true }],
  },
  "object.ungroup": {
    label: "Ungroup",
    mutating: true,
    shortcuts: [{ code: "KeyG", primary: true, shift: true }],
  },
  "mask.create": {
    label: "Use as mask",
    historyLabel: "Create mask",
    mutating: true,
    shortcuts: [{ code: "KeyM", primary: true, alt: true }],
  },
  "mask.release": {
    label: "Release mask",
    historyLabel: "Release mask",
    mutating: true,
    shortcuts: [{ code: "KeyM", primary: true, shift: true, alt: true }],
  },
  "mask.type.vector": {
    label: "Vector mask",
    historyLabel: "Change mask type",
    mutating: true,
    shortcuts: [{ code: "KeyV", alt: true }],
  },
  "mask.type.alpha": {
    label: "Alpha mask",
    historyLabel: "Change mask type",
    mutating: true,
  },
  "mask.type.luminance": {
    label: "Luminance mask",
    historyLabel: "Change mask type",
    mutating: true,
  },
  "mask.sources.set": {
    label: "Use selected layer as mask source",
    historyLabel: "Change mask source",
    mutating: true,
  },
  "object.delete": {
    label: "Delete",
    mutating: true,
    shortcuts: [{ code: "Backspace" }, { code: "Delete" }],
  },
} satisfies Record<EditorCommandId, EditorCommandDefinition>

export const editorShortcuts: readonly EditorShortcut[] =
  editorCommandIds.flatMap((commandId) => {
    const definition: EditorCommandDefinition = editorCommandRegistry[commandId]
    return (definition.shortcuts ?? []).map((shortcut) => ({
      ...shortcut,
      commandId,
    }))
  })

export function editorCommandLabel(commandId: EditorCommandId) {
  return editorCommandRegistry[commandId].label
}

export function editorCommandHistoryLabel(commandId: EditorCommandId) {
  const definition: EditorCommandDefinition = editorCommandRegistry[commandId]
  return definition.historyLabel ?? definition.label
}

export function isMutatingEditorCommand(commandId: EditorCommandId) {
  return editorCommandRegistry[commandId].mutating
}

export type EditorShortcutPlatform = "mac" | "windows"

const shortcutKeyLabels: Readonly<Record<string, string>> = {
  Equal: "+",
  Minus: "−",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Enter: "Enter",
  Escape: "Escape",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "Backspace",
  Delete: "Delete",
}

export function formatEditorShortcut(
  commandId: EditorCommandId,
  platform: EditorShortcutPlatform
) {
  const shortcut = editorShortcuts.find(
    (candidate) => candidate.commandId === commandId
  )
  if (!shortcut) return null
  const key =
    shortcutKeyLabels[shortcut.code] ?? shortcut.code.replace(/^Key/, "")
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

export type EditorKeyboardChord = {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function resolveEditorShortcut(
  event: EditorKeyboardChord,
  context?: EditorCommandContext
): EditorCommandId | null {
  const primary = event.metaKey || event.ctrlKey
  const chordMatches = editorShortcuts.filter(
    (shortcut) =>
      shortcut.code === event.code &&
      Boolean(shortcut.primary) === primary &&
      Boolean(shortcut.shift) === event.shiftKey &&
      Boolean(shortcut.alt) === event.altKey
  )
  const modeMatches = (shortcut: EditorShortcut) =>
    shortcut.mode === "crop-active"
      ? context?.imageCropActive === true
      : shortcut.mode === "crop-inactive"
        ? context?.imageCropActive !== true
        : true
  const enabled = (shortcut: EditorShortcut) =>
    context === undefined || isEditorCommandEnabled(shortcut.commandId, context)
  const modeSpecific = chordMatches.find(
    (shortcut) =>
      shortcut.mode !== undefined &&
      shortcut.mode !== "always" &&
      modeMatches(shortcut) &&
      enabled(shortcut)
  )
  if (modeSpecific) return modeSpecific.commandId
  return (
    chordMatches.find(
      (shortcut) =>
        (shortcut.mode === undefined || shortcut.mode === "always") &&
        enabled(shortcut)
    )?.commandId ?? null
  )
}
