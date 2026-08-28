import { northstarSeed, type SceneNode } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  capabilitiesForNodes,
  createInspectorSelectionModel,
  type InspectorCapabilityContext,
  parseInspectorNumber,
} from "../src/inspector"

const title = northstarSeed.nodes.find(
  (node): node is Extract<SceneNode, { type: "text" }> =>
    node.id === "cover-title" && node.type === "text"
)!

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

const ready = (...nodes: readonly ImageNode[]): InspectorCapabilityContext => ({
  imageSourceStateByNodeId: Object.fromEntries(
    nodes.map((node) => [
      node.id,
      { src: node.src, readiness: "ready" as const },
    ])
  ),
})

const imageCapabilities = {
  text: false,
  fill: false,
  stroke: false,
  cornerRadius: false,
  image: true,
}

describe("inspector selection model", () => {
  it("derives truthful empty and single-selection capabilities", () => {
    expect(createInspectorSelectionModel([])).toMatchObject({
      mode: "none",
      count: 0,
      editableCount: 0,
      allLocked: false,
    })

    expect(createInspectorSelectionModel([title])).toMatchObject({
      mode: "single",
      editableCount: 1,
      lockedCount: 0,
      capabilities: {
        text: true,
        fill: false,
        stroke: false,
        cornerRadius: false,
        image: false,
        canEnterCrop: false,
        canReplaceImage: false,
        replaceImageDisabledReason: null,
        canFlipImage: false,
        canApplyFrameMask: false,
        hasMissingSource: false,
      },
      values: {
        width: { kind: "value", value: title.width },
        opacity: { kind: "value", value: title.opacity },
      },
    })
  })

  it("represents mixed values and mixed locks explicitly", () => {
    const other = {
      ...title,
      id: "other-title",
      x: title.x + 40,
      locked: true,
    }
    expect(createInspectorSelectionModel([title, other])).toMatchObject({
      mode: "multiple",
      count: 2,
      editableCount: 1,
      lockedCount: 1,
      allLocked: false,
      someLocked: true,
      nodeType: { kind: "value", value: "text" },
      values: {
        x: { kind: "mixed" },
        width: { kind: "value", value: title.width },
        locked: { kind: "mixed" },
      },
    })
  })

  it("derives only properties shared by every selected type", () => {
    const rectangle = northstarSeed.nodes.find(
      (node): node is Extract<SceneNode, { type: "rect" }> =>
        node.type === "rect"
    )!
    expect(capabilitiesForNodes([rectangle])).toMatchObject({
      fill: true,
      stroke: true,
      cornerRadius: true,
    })
    expect(capabilitiesForNodes([title, rectangle])).toEqual({
      text: false,
      fill: false,
      stroke: false,
      cornerRadius: false,
      image: false,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
  })

  it("enables single-image actions only after the source is positively ready", () => {
    const node = image()

    expect(capabilitiesForNodes([node])).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: true,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
    expect(capabilitiesForNodes([node], ready(node))).toEqual({
      ...imageCapabilities,
      canEnterCrop: true,
      canReplaceImage: true,
      replaceImageDisabledReason: null,
      canFlipImage: true,
      canApplyFrameMask: true,
      hasMissingSource: false,
    })
  })

  it("disables replacement with the host's exact source-binding reason", () => {
    const node = image()
    const reason =
      "“Hero image” gets its image from the “Client portrait” shared asset field. Change the field value in Fields or unbind Source."

    expect(
      capabilitiesForNodes([node], {
        ...ready(node),
        imageReplacementConstraintByNodeId: {
          [node.id]: { reason },
        },
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: true,
      canReplaceImage: false,
      replaceImageDisabledReason: reason,
      canFlipImage: true,
      canApplyFrameMask: true,
      hasMissingSource: false,
    })
  })

  it("keeps crop and replace single-selection while allowing ready image batches", () => {
    const first = image()
    const second = image({ id: "supporting-image", name: "Supporting image" })

    expect(capabilitiesForNodes([first, second], ready(first, second))).toEqual(
      {
        ...imageCapabilities,
        canEnterCrop: false,
        canReplaceImage: false,
        replaceImageDisabledReason: null,
        canFlipImage: true,
        canApplyFrameMask: true,
        hasMissingSource: false,
      }
    )
  })

  it.each([
    {
      name: "locked",
      node: image({ locked: true }),
      context: ready(image({ locked: true })),
    },
    {
      name: "hidden",
      node: image({ visible: false }),
      context: ready(image({ visible: false })),
    },
    {
      name: "document read-only",
      node: image(),
      context: { ...ready(image()), documentEditable: false },
    },
  ])("disables image mutation for a $name selection", ({ node, context }) => {
    expect(capabilitiesForNodes([node], context)).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
  })

  it("requires every selected image to be visible, unlocked, and ready", () => {
    const first = image()
    const unavailable = image({
      id: "unavailable-image",
      name: "Unavailable image",
    })

    expect(
      capabilitiesForNodes([first, unavailable], {
        imageSourceStateByNodeId: {
          [first.id]: { src: first.src, readiness: "ready" },
          [unavailable.id]: {
            src: unavailable.src,
            readiness: "unavailable",
          },
        },
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: true,
    })
  })

  it.each([
    {
      name: "one image is locked",
      second: image({
        id: "locked-image",
        name: "Locked image",
        locked: true,
      }),
    },
    {
      name: "one image is hidden",
      second: image({
        id: "hidden-image",
        name: "Hidden image",
        visible: false,
      }),
    },
  ])("disables a multi-image mutation when $name", ({ second }) => {
    const first = image()
    expect(capabilitiesForNodes([first, second], ready(first, second))).toEqual(
      {
        ...imageCapabilities,
        canEnterCrop: false,
        canReplaceImage: false,
        replaceImageDisabledReason: null,
        canFlipImage: false,
        canApplyFrameMask: false,
        hasMissingSource: false,
      }
    )
  })

  it.each(["loading", "unavailable"] as const)(
    "does not expose pixel transforms for a %s source",
    (readiness) => {
      const node = image()
      expect(
        capabilitiesForNodes([node], {
          imageSourceStateByNodeId: {
            [node.id]: { src: node.src, readiness },
          },
        })
      ).toEqual({
        ...imageCapabilities,
        canEnterCrop: false,
        canReplaceImage: true,
        replaceImageDisabledReason: null,
        canFlipImage: false,
        canApplyFrameMask: false,
        hasMissingSource: readiness === "unavailable",
      })
    }
  )

  it("treats an empty source as unavailable even if runtime context says ready", () => {
    const node = image({ src: "" })
    expect(capabilitiesForNodes([node], ready(node))).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: true,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: true,
    })
  })

  it("rejects stale readiness observed for a previous source on the same node", () => {
    const node = image({ src: "https://example.com/replacement.jpg" })
    expect(
      capabilitiesForNodes([node], {
        imageSourceStateByNodeId: {
          [node.id]: {
            src: "https://example.com/previous.jpg",
            readiness: "ready",
          },
        },
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: true,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
  })

  it("lets the active crop target use transforms but blocks re-entry and replacement", () => {
    const node = image()
    expect(
      capabilitiesForNodes([node], {
        ...ready(node),
        activeImageCropNodeId: node.id,
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: true,
      canApplyFrameMask: true,
      hasMissingSource: false,
    })
  })

  it("blocks image mutations when another crop session owns edit mode", () => {
    const node = image()
    expect(
      capabilitiesForNodes([node], {
        ...ready(node),
        activeImageCropNodeId: "another-image",
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
  })

  it("blocks a multi-image action while one selected image owns crop mode", () => {
    const first = image()
    const second = image({ id: "supporting-image", name: "Supporting image" })
    expect(
      capabilitiesForNodes([first, second], {
        ...ready(first, second),
        activeImageCropNodeId: first.id,
      })
    ).toEqual({
      ...imageCapabilities,
      canEnterCrop: false,
      canReplaceImage: false,
      replaceImageDisabledReason: null,
      canFlipImage: false,
      canApplyFrameMask: false,
      hasMissingSource: false,
    })
  })

  it("projects explicit runtime context through the inspector selection model", () => {
    const node = image()
    expect(createInspectorSelectionModel([node], ready(node))).toMatchObject({
      mode: "single",
      capabilities: {
        image: true,
        canEnterCrop: true,
        canReplaceImage: true,
        replaceImageDisabledReason: null,
        canFlipImage: true,
        canApplyFrameMask: true,
        hasMissingSource: false,
      },
    })
  })
})

describe("inspector number parsing", () => {
  const width = { label: "Width", min: 1 }

  it("accepts absolute and relative finite values", () => {
    expect(parseInspectorNumber("240.5", 100, width)).toEqual({
      ok: true,
      value: 240.5,
    })
    expect(parseInspectorNumber("+20", 100, width)).toEqual({
      ok: true,
      value: 120,
    })
    expect(parseInspectorNumber("*2", 100, width)).toEqual({
      ok: true,
      value: 200,
    })
    expect(parseInspectorNumber("/4", 100, width)).toEqual({
      ok: true,
      value: 25,
    })
  })

  it("returns stable feedback instead of silently rejecting invalid drafts", () => {
    expect(parseInspectorNumber("-1", 100, width)).toEqual({
      ok: false,
      message: "Width must be at least 1.",
    })
    expect(parseInspectorNumber("nope", 100, width)).toEqual({
      ok: false,
      message: "Width must be a valid number.",
    })
    expect(parseInspectorNumber("/0", 100, width)).toEqual({
      ok: false,
      message: "Width must be a valid number.",
    })
  })
})
