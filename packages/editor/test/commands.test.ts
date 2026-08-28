import type { SceneNode } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  createImageFrameCommandDrafts,
  createImagePlacementCommandDrafts,
  deriveEditorImageCommandCapabilities,
  dispatchEditorImageCommand,
  editorCommandIds,
  editorCommandHistoryLabel,
  editorCommandLabel,
  editorCommandRegistry,
  editorImageCommandIds,
  editorShortcuts,
  formatEditorShortcut,
  isEditorCommandEnabled,
  projectEditorCommandCapabilities,
  resolveEditorShortcut,
  type EditorCommandContext,
  type EditorImageCommandHandlers,
} from "../src/commands"
import { capabilitiesForNodes } from "../src/inspector"

type ImageNode = Extract<SceneNode, { type: "image" }>

const image = (overrides: Partial<ImageNode> = {}): ImageNode => ({
  id: "hero-image",
  type: "image",
  name: "Hero image",
  x: 40,
  y: 60,
  width: 480,
  height: 320,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: "hero-asset",
  src: "https://example.com/hero.jpg",
  placement: {
    mode: "fill",
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  frameMask: { shape: "rectangle" },
  alt: "A finished wedding album",
  decorative: false,
  ...overrides,
})

const editableContext: EditorCommandContext = {
  reviewPending: false,
  hasSelection: true,
  selectedNodeCount: 2,
  hasSelectedGroup: true,
  hasClipboard: true,
  hasUndo: true,
  hasRedo: true,
  hasZoomSelection: true,
  canCropImage: true,
  imageCropActive: false,
}

const imageCommandContext = (
  selectedNodes: readonly SceneNode[],
  options: {
    documentEditable?: boolean
    imageCropActive?: boolean
    activeImagePlacement?: ImageNode["placement"]
    activeImageFrameMask?: ImageNode["frameMask"]
    imageCropDraftChanged?: boolean
    cropFrameMaskDraftSupported?: boolean
    resizeFrameToImageSupported?: boolean
    sourceReadiness?: "ready" | "loading" | "unavailable"
    replacementDisabledReason?: string
  } = {}
): EditorCommandContext => {
  const documentEditable = options.documentEditable ?? true
  const imageCropActive = options.imageCropActive ?? false
  const selectedImage = selectedNodes.find(
    (node): node is ImageNode => node.type === "image"
  )
  const inspectorCapabilities = capabilitiesForNodes(selectedNodes, {
    documentEditable,
    activeImageCropNodeId:
      imageCropActive && selectedImage ? selectedImage.id : null,
    imageSourceStateByNodeId: Object.fromEntries(
      selectedNodes.flatMap((node) =>
        node.type === "image"
          ? [
              [
                node.id,
                {
                  src: node.src,
                  readiness: options.sourceReadiness ?? "ready",
                },
              ],
            ]
          : []
      )
    ),
    imageReplacementConstraintByNodeId:
      options.replacementDisabledReason && selectedImage
        ? {
            [selectedImage.id]: {
              reason: options.replacementDisabledReason,
            },
          }
        : undefined,
  })
  return {
    ...editableContext,
    reviewPending: !documentEditable,
    selectedNodeCount: selectedNodes.length,
    hasSelection: selectedNodes.length > 0,
    canCropImage: inspectorCapabilities.canEnterCrop,
    canTransformImage: inspectorCapabilities.canFlipImage,
    imageCropActive,
    image: deriveEditorImageCommandCapabilities({
      selectedNodes,
      inspectorCapabilities,
      documentEditable,
      imageCropActive,
      imageCropDraftChanged: options.imageCropDraftChanged,
      cropFrameMaskDraftSupported: options.cropFrameMaskDraftSupported,
      resizeFrameToImageSupported: options.resizeFrameToImageSupported,
      activeImagePlacement: options.activeImagePlacement,
      activeImageFrameMask: options.activeImageFrameMask,
    }),
  }
}

describe("editor command registry", () => {
  it("has no duplicate keyboard chords", () => {
    const chords = editorShortcuts.map(
      ({ code, primary, shift, mode }) =>
        `${mode ?? "always"}:${primary ? "primary" : "plain"}:${shift ? "shift" : "plain"}:${code}`
    )
    expect(new Set(chords).size).toBe(chords.length)
  })

  it("gives every registered command a stable human label", () => {
    expect(Object.keys(editorCommandRegistry)).toEqual([...editorCommandIds])
    for (const commandId of editorCommandIds) {
      expect(editorCommandLabel(commandId).trim()).not.toBe("")
    }
  })

  it("projects one serializable capability from the same enablement policy", () => {
    const projected = projectEditorCommandCapabilities(editableContext)

    expect(projected.map(({ id }) => id)).toEqual(editorCommandIds)
    expect(projected.find(({ id }) => id === "history.undo")).toEqual({
      id: "history.undo",
      label: "Undo",
      enabled: true,
    })
    expect(projected.find(({ id }) => id === "image.crop.apply")).toEqual({
      id: "image.crop.apply",
      label: "Apply crop",
      enabled: false,
    })
    expect(
      projectEditorCommandCapabilities({
        ...editableContext,
        reviewPending: true,
      }).find(({ id }) => id === "object.delete")
    ).toMatchObject({ enabled: false })
  })

  it("registers the complete accepted image action set", () => {
    expect(editorImageCommandIds).toEqual([
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
    ])
  })

  it("formats platform-correct shortcut labels", () => {
    expect(formatEditorShortcut("history.undo", "mac")).toBe("⌘Z")
    expect(formatEditorShortcut("history.undo", "windows")).toBe("Ctrl+Z")
    expect(formatEditorShortcut("image.flip-horizontal", "mac")).toBe("⇧H")
    expect(formatEditorShortcut("image.flip-horizontal", "windows")).toBe(
      "Shift+H"
    )
  })

  it("maps V to the select tool without treating it as a selection command", () => {
    expect(
      resolveEditorShortcut({
        code: "KeyV",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe("tool.select")
  })

  it("keeps navigation available and disables every mutation in review mode", () => {
    const reviewContext = { ...editableContext, reviewPending: true }

    expect(isEditorCommandEnabled("tool.select", reviewContext)).toBe(true)
    expect(isEditorCommandEnabled("canvas.fit", reviewContext)).toBe(true)
    expect(isEditorCommandEnabled("object.add-text", reviewContext)).toBe(false)
    expect(isEditorCommandEnabled("selection.nudge-left", reviewContext)).toBe(
      false
    )
    expect(isEditorCommandEnabled("history.undo", reviewContext)).toBe(false)
    expect(isEditorCommandEnabled("object.paste", reviewContext)).toBe(false)
    expect(isEditorCommandEnabled("image.crop", reviewContext)).toBe(false)

    for (const commandId of editorCommandIds.filter((id) =>
      id.startsWith("image.")
    )) {
      expect(isEditorCommandEnabled(commandId, reviewContext)).toBe(false)
    }
  })

  it("enables image crop entry and exit only in their matching mode", () => {
    expect(isEditorCommandEnabled("image.crop", editableContext)).toBe(true)
    expect(isEditorCommandEnabled("image.crop.apply", editableContext)).toBe(
      false
    )
    expect(isEditorCommandEnabled("image.crop.cancel", editableContext)).toBe(
      false
    )

    const activeCrop = { ...editableContext, imageCropActive: true }
    expect(isEditorCommandEnabled("image.crop", activeCrop)).toBe(false)
    expect(isEditorCommandEnabled("image.crop.apply", activeCrop)).toBe(true)
    expect(isEditorCommandEnabled("image.crop.cancel", activeCrop)).toBe(true)
    expect(isEditorCommandEnabled("image.flip-horizontal", activeCrop)).toBe(
      true
    )
    expect(isEditorCommandEnabled("image.flip-vertical", activeCrop)).toBe(true)
  })

  it("derives truthful no-op availability for a default ready image", () => {
    const context = imageCommandContext([image()])

    expect(isEditorCommandEnabled("image.insert", context)).toBe(true)
    expect(isEditorCommandEnabled("image.replace", context)).toBe(true)
    expect(isEditorCommandEnabled("image.crop", context)).toBe(true)
    expect(isEditorCommandEnabled("image.fit", context)).toBe(true)
    expect(isEditorCommandEnabled("image.fill", context)).toBe(false)
    expect(isEditorCommandEnabled("image.flip-horizontal", context)).toBe(true)
    expect(isEditorCommandEnabled("image.rotate-left", context)).toBe(true)
    expect(isEditorCommandEnabled("image.rotation.reset", context)).toBe(false)
    expect(isEditorCommandEnabled("image.reset-placement", context)).toBe(false)
    expect(isEditorCommandEnabled("image.resize-frame-to-image", context)).toBe(
      false
    )
    expect(isEditorCommandEnabled("image.frame.rectangle", context)).toBe(false)
    expect(
      isEditorCommandEnabled("image.frame.rounded-rectangle", context)
    ).toBe(true)
    expect(isEditorCommandEnabled("image.frame.ellipse", context)).toBe(true)
  })

  it("enables reset and rotation recovery only for a changed placement", () => {
    const node = image({
      placement: {
        mode: "manual",
        focalX: 0.2,
        focalY: 0.7,
        zoom: 1.4,
        rotation: 90,
        flipX: true,
        flipY: false,
      },
      frameMask: { shape: "ellipse" },
    })
    const context = imageCommandContext([node])

    expect(isEditorCommandEnabled("image.fit", context)).toBe(true)
    expect(isEditorCommandEnabled("image.fill", context)).toBe(true)
    expect(isEditorCommandEnabled("image.rotation.reset", context)).toBe(true)
    expect(isEditorCommandEnabled("image.reset-placement", context)).toBe(true)
    expect(isEditorCommandEnabled("image.frame.rectangle", context)).toBe(true)
    expect(isEditorCommandEnabled("image.frame.ellipse", context)).toBe(false)
  })

  it("supports shared multi-image transforms without exposing single-image actions", () => {
    const first = image()
    const second = image({
      id: "supporting-image",
      name: "Supporting image",
      placement: { ...image().placement, mode: "fit" },
    })
    const context = imageCommandContext([first, second])

    expect(isEditorCommandEnabled("image.replace", context)).toBe(false)
    expect(isEditorCommandEnabled("image.crop", context)).toBe(false)
    expect(isEditorCommandEnabled("image.fit", context)).toBe(true)
    expect(isEditorCommandEnabled("image.fill", context)).toBe(true)
    expect(isEditorCommandEnabled("image.flip-vertical", context)).toBe(true)
    expect(isEditorCommandEnabled("image.rotate-right", context)).toBe(true)
  })

  it("keeps replace available for an unavailable source but disables pixel transforms", () => {
    const context = imageCommandContext([image()], {
      sourceReadiness: "unavailable",
    })

    expect(isEditorCommandEnabled("image.replace", context)).toBe(true)
    expect(isEditorCommandEnabled("image.crop", context)).toBe(false)
    expect(isEditorCommandEnabled("image.fit", context)).toBe(false)
    expect(isEditorCommandEnabled("image.flip-horizontal", context)).toBe(false)
    expect(isEditorCommandEnabled("image.frame.ellipse", context)).toBe(false)
  })

  it("disables bound-image replacement and projects the binding reason", () => {
    const reason =
      "“Hero image” gets its image from the “Client portrait” shared asset field. Change the field value in Fields or unbind Source."
    const context = imageCommandContext([image()], {
      replacementDisabledReason: reason,
    })

    expect(isEditorCommandEnabled("image.replace", context)).toBe(false)
    expect(
      projectEditorCommandCapabilities(context).find(
        ({ id }) => id === "image.replace"
      )
    ).toEqual({
      id: "image.replace",
      label: "Replace image…",
      enabled: false,
      reason,
    })
  })

  it("uses the active crop draft for command-specific availability", () => {
    const node = image()
    const context = imageCommandContext([node], {
      imageCropActive: true,
      activeImagePlacement: {
        ...node.placement,
        mode: "fit",
        rotation: -90,
      },
      activeImageFrameMask: { shape: "ellipse" },
      imageCropDraftChanged: true,
    })

    expect(isEditorCommandEnabled("image.insert", context)).toBe(false)
    expect(isEditorCommandEnabled("image.replace", context)).toBe(false)
    expect(isEditorCommandEnabled("image.crop", context)).toBe(false)
    expect(isEditorCommandEnabled("image.crop.apply", context)).toBe(true)
    expect(isEditorCommandEnabled("image.crop.cancel", context)).toBe(true)
    expect(isEditorCommandEnabled("image.fit", context)).toBe(false)
    expect(isEditorCommandEnabled("image.fill", context)).toBe(true)
    expect(isEditorCommandEnabled("image.rotation.reset", context)).toBe(true)
    expect(isEditorCommandEnabled("image.frame.rectangle", context)).toBe(false)
    expect(isEditorCommandEnabled("image.frame.ellipse", context)).toBe(false)
    expect(context.image?.cropDraftChanged).toBe(true)
  })

  it("enables crop-time frame commands only after frame masks join the draft", () => {
    const node = image()
    const context = imageCommandContext([node], {
      imageCropActive: true,
      activeImageFrameMask: { shape: "ellipse" },
      cropFrameMaskDraftSupported: true,
    })

    expect(isEditorCommandEnabled("image.frame.rectangle", context)).toBe(true)
    expect(isEditorCommandEnabled("image.frame.ellipse", context)).toBe(false)
  })

  it("exposes resize frame to image only for a supported ready crop session", () => {
    expect(
      isEditorCommandEnabled(
        "image.resize-frame-to-image",
        imageCommandContext([image()], {
          imageCropActive: true,
          resizeFrameToImageSupported: true,
        })
      )
    ).toBe(true)
    expect(
      isEditorCommandEnabled(
        "image.resize-frame-to-image",
        imageCommandContext([image()], { imageCropActive: true })
      )
    ).toBe(false)
    expect(
      isEditorCommandEnabled(
        "image.resize-frame-to-image",
        imageCommandContext([image()], {
          resizeFrameToImageSupported: true,
        })
      )
    ).toBe(false)
    expect(
      isEditorCommandEnabled(
        "image.resize-frame-to-image",
        imageCommandContext([image()], {
          imageCropActive: true,
          resizeFrameToImageSupported: true,
          sourceReadiness: "unavailable",
        })
      )
    ).toBe(false)
    expect(
      isEditorCommandEnabled(
        "image.resize-frame-to-image",
        imageCommandContext([image(), image({ id: "second-image" })], {
          imageCropActive: true,
          resizeFrameToImageSupported: true,
        })
      )
    ).toBe(false)
  })

  it("routes mode-aware crop shortcuts through registered command IDs", () => {
    const inactive = imageCommandContext([image()])
    const active = imageCommandContext([image()], { imageCropActive: true })
    const enter = {
      code: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }
    const escape = { ...enter, code: "Escape" }
    const undo = { ...enter, code: "KeyZ", metaKey: true }

    expect(resolveEditorShortcut(enter, inactive)).toBe("image.crop")
    expect(resolveEditorShortcut(enter, active)).toBe("image.crop.apply")
    expect(resolveEditorShortcut(escape, active)).toBe("image.crop.cancel")
    expect(resolveEditorShortcut(escape, inactive)).toBeNull()
    expect(resolveEditorShortcut(undo, active)).toBe("image.crop.cancel")
    expect(resolveEditorShortcut(undo, inactive)).toBe("history.undo")
  })

  it("uses the product labels agreed by the image UX contract", () => {
    expect(editorCommandLabel("image.fit")).toBe("Fit image")
    expect(editorCommandLabel("image.fill")).toBe("Fill frame")
    expect(editorCommandLabel("image.rotate-left")).toBe(
      "Rotate image 90° left"
    )
    expect(editorCommandLabel("image.rotation.reset")).toBe(
      "Reset image rotation"
    )
    expect(editorCommandLabel("image.reset-placement")).toBe("Reset crop")
    expect(editorCommandLabel("image.resize-frame-to-image")).toBe(
      "Resize frame to image"
    )
    expect(editorCommandLabel("image.replace")).toBe("Replace image…")
    expect(editorCommandHistoryLabel("image.frame.ellipse")).toBe(
      "Change image frame"
    )
    expect(editorCommandHistoryLabel("image.crop.apply")).toBe("Crop image")
    expect(editorCommandHistoryLabel("image.resize-frame-to-image")).toBe(
      "Resize frame to image"
    )
  })

  it("creates one typed placement draft per editable selected image", () => {
    const first = image()
    const second = image({
      id: "supporting-image",
      name: "Supporting image",
      placement: { ...image().placement, mode: "manual", rotation: 170 },
    })
    const locked = image({
      id: "locked-image",
      name: "Locked image",
      locked: true,
    })

    expect(
      createImagePlacementCommandDrafts("image.rotate-right", [
        first,
        second,
        locked,
      ])
    ).toEqual([
      {
        type: "set_image_placement",
        nodeId: first.id,
        placement: { ...first.placement, rotation: 90 },
      },
      {
        type: "set_image_placement",
        nodeId: second.id,
        placement: { ...second.placement, rotation: -100 },
      },
    ])
  })

  it("creates deterministic fit, flip, rotation-reset, and crop-reset drafts", () => {
    const node = image({
      placement: {
        mode: "manual",
        focalX: 0.1,
        focalY: 0.8,
        zoom: 2,
        rotation: -90,
        flipX: true,
        flipY: true,
      },
    })

    expect(
      createImagePlacementCommandDrafts("image.fit", [node])[0]
    ).toMatchObject({ placement: { ...node.placement, mode: "fit" } })
    expect(
      createImagePlacementCommandDrafts("image.flip-horizontal", [node])[0]
    ).toMatchObject({ placement: { flipX: false, flipY: true } })
    expect(
      createImagePlacementCommandDrafts("image.rotation.reset", [node])[0]
    ).toMatchObject({ placement: { rotation: 0 } })
    expect(
      createImagePlacementCommandDrafts("image.reset-placement", [node])[0]
    ).toMatchObject({
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
    })
    expect(createImagePlacementCommandDrafts("image.fill", [image()])).toEqual(
      []
    )
  })

  it("creates typed frame drafts with a stable rounded-frame default", () => {
    const rectangle = image()
    const ellipse = image({
      id: "ellipse-image",
      name: "Ellipse image",
      frameMask: { shape: "ellipse" },
    })

    expect(
      createImageFrameCommandDrafts("image.frame.rounded-rectangle", [
        rectangle,
        ellipse,
      ])
    ).toEqual([
      {
        type: "set_image_frame_mask",
        nodeId: rectangle.id,
        frameMask: { shape: "rounded_rectangle", radius: 0.12 },
      },
      {
        type: "set_image_frame_mask",
        nodeId: ellipse.id,
        frameMask: { shape: "rounded_rectangle", radius: 0.12 },
      },
    ])
    expect(
      createImageFrameCommandDrafts("image.frame.ellipse", [ellipse])
    ).toEqual([])
  })

  it("routes image actions through the shared enablement gate", () => {
    const calls: string[] = []
    const record =
      (commandId: (typeof editorImageCommandIds)[number]) => () => {
        calls.push(commandId)
      }
    const handlers = {
      "image.insert": record("image.insert"),
      "image.replace": record("image.replace"),
      "image.crop": record("image.crop"),
      "image.crop.apply": record("image.crop.apply"),
      "image.crop.cancel": record("image.crop.cancel"),
      "image.fit": record("image.fit"),
      "image.fill": record("image.fill"),
      "image.flip-horizontal": record("image.flip-horizontal"),
      "image.flip-vertical": record("image.flip-vertical"),
      "image.rotate-left": record("image.rotate-left"),
      "image.rotate-right": record("image.rotate-right"),
      "image.rotation.reset": record("image.rotation.reset"),
      "image.reset-placement": record("image.reset-placement"),
      "image.frame.rectangle": record("image.frame.rectangle"),
      "image.frame.rounded-rectangle": record("image.frame.rounded-rectangle"),
      "image.frame.ellipse": record("image.frame.ellipse"),
    } satisfies EditorImageCommandHandlers
    const context = imageCommandContext([image()])

    expect(dispatchEditorImageCommand("image.fit", context, handlers)).toBe(
      true
    )
    expect(dispatchEditorImageCommand("image.fill", context, handlers)).toBe(
      false
    )
    expect(calls).toEqual(["image.fit"])

    const supportedCropContext = imageCommandContext([image()], {
      imageCropActive: true,
      resizeFrameToImageSupported: true,
    })
    expect(
      dispatchEditorImageCommand(
        "image.resize-frame-to-image",
        supportedCropContext,
        handlers
      )
    ).toBe(false)
    expect(calls).toEqual(["image.fit"])

    const supportedHandlers: EditorImageCommandHandlers = {
      ...handlers,
      "image.resize-frame-to-image": record("image.resize-frame-to-image"),
    }
    expect(
      dispatchEditorImageCommand(
        "image.resize-frame-to-image",
        supportedCropContext,
        supportedHandlers
      )
    ).toBe(true)
    expect(calls).toEqual(["image.fit", "image.resize-frame-to-image"])
  })

  it("maps image flip shortcuts without colliding with plain tool keys", () => {
    expect(
      resolveEditorShortcut({
        code: "KeyH",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      })
    ).toBe("image.flip-horizontal")
    expect(
      resolveEditorShortcut({
        code: "KeyV",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      })
    ).toBe("image.flip-vertical")
  })
})
