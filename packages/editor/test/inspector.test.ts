import { applyCommand, northstarSeed, type Document, type SceneNode } from "@webmcp/document"
import { initialMaskPaintAdmission } from "@webmcp/document/internal/page-paint-plan"
import { describe, expect, it } from "vitest"
import {
  capabilitiesForNodes,
  createInspectorSelectionModel,
  deriveInspectorMaskCapabilities,
  type InspectorCapabilityContext,
  parseInspectorNumber,
} from "../src/inspector"

const title = northstarSeed.nodes.find(
  (node): node is Extract<SceneNode, { type: "text" }> =>
    node.id === "cover-title" && node.type === "text"
)!

const addInspectorMaskFixtures = (
  document: Document,
  count: number,
  size: number
) => {
  const page = document.pages.find((candidate) => candidate.id === "cover")!
  const template = document.nodes.find((node) => node.id === "cover-panel")!
  for (let index = 0; index < count; index += 1) {
    const sourceId = `inspector-source-${index}`
    const contentId = `inspector-content-${index}`
    document.nodes.push(
      { ...structuredClone(template), id: sourceId, x: 0, y: 0, width: size, height: size },
      { ...structuredClone(template), id: contentId, x: 0, y: 0, width: size, height: size }
    )
    page.nodeIds.push(sourceId, contentId)
    document.groups.push({
      id: `inspector-mask-${index}`,
      pageId: page.id,
      name: `Inspector mask ${index}`,
      role: "mask",
      nodeIds: [sourceId, contentId],
      mask: { type: "vector", sourceNodeIds: [sourceId] },
    })
  }
}

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

describe("mask command capabilities", () => {
  it("uses the backmost selected eligible layer as one explicit source", () => {
    const document = structuredClone(northstarSeed)
    document.groups = []
    const capabilities = deriveInspectorMaskCapabilities({
      document,
      pageId: "cover",
      selectedNodeIds: ["cover-title", "cover-panel"],
    })

    expect(capabilities.create).toEqual({
      enabled: true,
      disabledReason: null,
    })
    expect(capabilities.createSourceNodeIds).toEqual(["cover-panel"])

    const created = applyCommand(document, {
      id: "inspector-noncontiguous-parity",
      type: "create_mask_group",
      actor: "human",
      at: "2026-08-31T17:00:00.000Z",
      expectedRevision: document.revision,
      pageId: "cover",
      groupId: "inspector-parity-mask",
      name: "Inspector parity mask",
      nodeIds: ["cover-title", "cover-panel"],
      sourceNodeIds: ["cover-panel"],
      maskType: "vector",
    })
    const compacted = created.pages.find((page) => page.id === "cover")!.nodeIds
    expect(compacted.indexOf("cover-title")).toBe(
      compacted.indexOf("cover-panel") + 1
    )
  })

  it("gives the exact active composite count reason after front-edge compaction", () => {
    const document = structuredClone(northstarSeed)
    document.groups = []
    addInspectorMaskFixtures(
      document,
      initialMaskPaintAdmission.maxActiveCompositesPerPage,
      1
    )
    expect(
      deriveInspectorMaskCapabilities({
        document,
        pageId: "cover",
        selectedNodeIds: ["cover-title", "cover-panel"],
      }).create.disabledReason
    ).toBe("This page already has 32 active mask composites. Release a mask before creating another.")
  })

  it("gives the exact summed 2x page area reason after front-edge compaction", () => {
    const document = structuredClone(northstarSeed)
    document.groups = []
    addInspectorMaskFixtures(document, 4, 2_000)
    expect(
      deriveInspectorMaskCapabilities({
        document,
        pageId: "cover",
        selectedNodeIds: ["cover-title", "cover-panel"],
      }).create.disabledReason
    ).toBe("The selected mask would exceed the page's summed 2x composite area budget. Reduce its bounds or release another mask.")
  })

  it("disables create when the selected composite fails the shared 2x contract", () => {
    const document = structuredClone(northstarSeed)
    document.groups = []
    const title = document.nodes.find((node) => node.id === "cover-title")!
    title.width = 3_000
    title.height = 2_000
    title.x = 0
    title.y = 0

    expect(
      deriveInspectorMaskCapabilities({
        document,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create
    ).toEqual({
      enabled: false,
      disabledReason:
        "The selected mask exceeds the Gate M2 composite bounds at 2x. Reduce or move the selected layers.",
    })
  })

  it("reports the exact 512-content create limit", () => {
    const document = structuredClone(northstarSeed)
    document.groups = []
    const source = document.nodes.find((node) => node.id === "cover-panel")!
    const content = Array.from({ length: 513 }, (_, index) => ({
      ...structuredClone(source),
      id: `mask-content-${index}`,
      name: `Mask content ${index}`,
    }))
    document.nodes = [source, ...content]
    document.pages[0]!.nodeIds = document.nodes.map((node) => node.id)

    expect(
      deriveInspectorMaskCapabilities({
        document,
        pageId: "cover",
        selectedNodeIds: document.pages[0]!.nodeIds,
      }).create.disabledReason
    ).toBe("A mask can contain at most 512 content layers. Select 513 layers or fewer.")
  })

  it("rejects stroked, bound, nested, and component-owned source structure truthfully", () => {
    const stroked = structuredClone(northstarSeed)
    stroked.groups = []
    const panel = stroked.nodes.find((node) => node.id === "cover-panel")
    if (panel?.type !== "rect") throw new Error("Fixture panel is missing")
    panel.strokeWidth = 1
    expect(
      deriveInspectorMaskCapabilities({
        document: stroked,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe("Vector mask sources must not have a stroke.")

    const bound = structuredClone(northstarSeed)
    bound.groups = []
    bound.bindings.push({
      id: "binding-mask-source",
      fieldId: bound.fields[0]!.id,
      nodeId: "cover-panel",
      property: "visible",
    })
    expect(
      deriveInspectorMaskCapabilities({
        document: bound,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe("A field-bound layer cannot be a mask source. Unbind it first.")

    const nested = structuredClone(northstarSeed)
    nested.groups = [
      {
        id: "nested-parent",
        pageId: "cover",
        name: "Nested",
        role: "organize",
        nodeIds: ["cover-panel", "cover-title"],
      },
    ]
    expect(
      deriveInspectorMaskCapabilities({
        document: nested,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe("Nested mask groups are not available in this version.")
  })

  it("rejects mixed parents and both kinds of component ownership", () => {
    const mixedParents = structuredClone(northstarSeed)
    mixedParents.groups = [
      {
        id: "partial-parent",
        pageId: "cover",
        name: "Partial parent",
        role: "organize",
        nodeIds: ["cover-title"],
      },
    ]
    expect(
      deriveInspectorMaskCapabilities({
        document: mixedParents,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe("Select top-level layers that share the same parent.")

    const componentSource = structuredClone(northstarSeed)
    componentSource.groups = [
      {
        id: "component-source-group",
        pageId: "cover",
        name: "Component source",
        role: "organize",
        nodeIds: ["cover-panel", "cover-title"],
      },
    ]
    componentSource.components = [
      {
        id: "component-source",
        name: "Component source",
        sourceGroupId: "component-source-group",
        defaultVariantId: "component-source-default",
        variants: [
          {
            id: "component-source-default",
            name: "Default",
            overrides: {},
          },
        ],
      },
    ]
    expect(
      deriveInspectorMaskCapabilities({
        document: componentSource,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe(
      "Mask structure cannot be changed inside a component or instance. Detach the instance or use layers outside the component."
    )

    const componentInstance = structuredClone(northstarSeed)
    componentInstance.componentInstances = [
      {
        id: "component-instance",
        name: "Component instance",
        componentId: "component-source",
        variantId: "component-source-default",
        rootGroupId: "component-instance-group",
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        nodeMappings: [
          {
            sourceNodeId: "source-panel",
            instanceNodeId: "cover-panel",
          },
          {
            sourceNodeId: "source-title",
            instanceNodeId: "cover-title",
          },
        ],
        groupMappings: [],
        overrides: {},
      },
    ]
    expect(
      deriveInspectorMaskCapabilities({
        document: componentInstance,
        pageId: "cover",
        selectedNodeIds: ["cover-panel", "cover-title"],
      }).create.disabledReason
    ).toBe(
      "Mask structure cannot be changed inside a component or instance. Detach the instance or use layers outside the component."
    )
  })

  it("projects vector as selected and keeps alpha and luminance reasons exact", () => {
    const document = structuredClone(northstarSeed)
    document.groups = [
      {
        id: "cover-mask",
        pageId: "cover",
        name: "Cover mask",
        role: "mask",
        nodeIds: ["cover-panel", "cover-title"],
        mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
      },
    ]
    const capabilities = deriveInspectorMaskCapabilities({
      document,
      pageId: "cover",
      selectedNodeIds: ["cover-panel", "cover-title"],
      selectedGroupId: "cover-mask",
    })

    expect(capabilities.type).toBe("vector")
    expect(capabilities.setVector.disabledReason).toBe(
      "This mask already uses Vector."
    )
    expect(capabilities.setAlpha.disabledReason).toContain(
      "image and text readiness"
    )
    expect(capabilities.setLuminance.disabledReason).toContain("color-space")
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
