import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  Line,
  Path,
  Rect,
  Textbox,
  type ModifiedEvent,
} from "fabric"
import type { Document, SceneNode } from "@webmcp/document"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  CanvasNodeChange,
  Selection,
} from "./index"
import { calculateSnap, type SnapGuide } from "./snapping"

const SELECTION_COLOR = "#18181b"
const GUIDE_COLOR = "#2563eb"

const round = (value: number) => Math.round(value * 10) / 10

function snapBoundsForObject(object: FabricObject) {
  if (
    !(object instanceof ActiveSelection) &&
    Math.abs(object.angle % 360) < 0.01
  ) {
    return {
      left: object.left ?? 0,
      top: object.top ?? 0,
      width: (object.width || 1) * Math.abs(object.scaleX),
      height: (object.height || 1) * Math.abs(object.scaleY),
    }
  }
  return object.getBoundingRect()
}

export function fabricObjectToNodePatch(
  object: FabricObject
): Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation"> {
  const position = object.group
    ? object.getXY()
    : { x: object.left ?? 0, y: object.top ?? 0 }
  return {
    x: round(position.x),
    y: round(position.y),
    width: Math.max(1, round((object.width || 1) * Math.abs(object.scaleX))),
    height: Math.max(1, round((object.height || 1) * Math.abs(object.scaleY))),
    rotation: round(object.angle),
  }
}

function sharedOptions(node: SceneNode) {
  return {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    originX: "left" as const,
    originY: "top" as const,
    selectable: true,
    evented: true,
    hasControls: !node.locked,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    lockScalingX: node.locked,
    lockScalingY: node.locked,
    lockRotation: node.locked,
    borderColor: SELECTION_COLOR,
    borderScaleFactor: 2,
    cornerColor: "#ffffff",
    cornerStrokeColor: SELECTION_COLOR,
    cornerStyle: "circle" as const,
    cornerSize: 22,
    transparentCorners: false,
    padding: 5,
    objectCaching: true,
  }
}

function createSyncObject(node: Exclude<SceneNode, { type: "image" }>) {
  if (node.type === "rect") {
    return new Rect({
      ...sharedOptions(node),
      fill: node.fill,
      rx: node.radius,
      ry: node.radius,
      stroke: node.stroke,
      strokeWidth: node.stroke ? 1 : 0,
    })
  }

  if (node.type === "ellipse") {
    return new Ellipse({
      ...sharedOptions(node),
      fill: node.fill,
      rx: node.width / 2,
      ry: node.height / 2,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
  }

  if (node.type === "line") {
    return new Line([0, 0, node.width, node.height], {
      ...sharedOptions(node),
      fill: undefined,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
  }

  if (node.type === "icon") {
    const { width: _width, height: _height, ...options } = sharedOptions(node)
    const path = new Path(node.path, {
      ...options,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
    path.set({
      scaleX: node.width / (path.width || node.width),
      scaleY: node.height / (path.height || node.height),
    })
    return path
  }

  return new Textbox(node.text, {
    ...sharedOptions(node),
    fill: node.color,
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    textAlign: node.align,
    lineHeight: 1.18,
    splitByGrapheme: false,
    editable: !node.locked,
    strokeWidth: 0,
  })
}

async function createImageObject(node: Extract<SceneNode, { type: "image" }>) {
  const image = await FabricImage.fromURL(node.src, {
    crossOrigin: "anonymous",
  })
  return createImageGroup(node, image)
}

function imageFrame(node: Extract<SceneNode, { type: "image" }>) {
  return new Rect({
    left: 0,
    top: 0,
    width: node.width,
    height: node.height,
    originX: "left",
    originY: "top",
    fill: "rgba(0,0,0,0)",
    strokeWidth: 0,
    selectable: false,
    evented: false,
  })
}

function layoutImage(
  image: FabricImage,
  node: Extract<SceneNode, { type: "image" }>
) {
  const element = image.getElement()
  const naturalWidth =
    ("naturalWidth" in element ? element.naturalWidth : element.width) ||
    image.width ||
    1
  const naturalHeight =
    ("naturalHeight" in element ? element.naturalHeight : element.height) ||
    image.height ||
    1
  const focusX = Math.min(1, Math.max(0, node.cropX))
  const focusY = Math.min(1, Math.max(0, node.cropY))

  if (node.fit === "cover") {
    const scale = Math.max(
      node.width / naturalWidth,
      node.height / naturalHeight
    )
    const sourceWidth = node.width / scale
    const sourceHeight = node.height / scale
    image.set({
      left: 0,
      top: 0,
      width: sourceWidth,
      height: sourceHeight,
      cropX: (naturalWidth - sourceWidth) * focusX,
      cropY: (naturalHeight - sourceHeight) * focusY,
      scaleX: scale,
      scaleY: scale,
    })
  } else {
    const scale = Math.min(
      node.width / naturalWidth,
      node.height / naturalHeight
    )
    const renderedWidth = naturalWidth * scale
    const renderedHeight = naturalHeight * scale
    image.set({
      left: (node.width - renderedWidth) * focusX,
      top: (node.height - renderedHeight) * focusY,
      width: naturalWidth,
      height: naturalHeight,
      cropX: 0,
      cropY: 0,
      scaleX: scale,
      scaleY: scale,
    })
  }
  image.set({
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
  })
  image.setCoords()
}

function imageGroupOptions(node: Extract<SceneNode, { type: "image" }>) {
  const { width: _width, height: _height, ...options } = sharedOptions(node)
  return { ...options, scaleX: 1, scaleY: 1, subTargetCheck: false }
}

function createImageGroup(
  node: Extract<SceneNode, { type: "image" }>,
  image: FabricImage
) {
  layoutImage(image, node)
  return new Group([imageFrame(node), image], imageGroupOptions(node))
}

function syncImageGroup(
  group: Group,
  node: Extract<SceneNode, { type: "image" }>
) {
  const image = group
    .getObjects()
    .find((object): object is FabricImage => object instanceof FabricImage)
  if (!image) return
  layoutImage(image, node)
  group.removeAll()
  group.add(imageFrame(node), image)
  group.set(imageGroupOptions(node))
  group.setCoords()
}

function syncObjectFromNode(object: FabricObject, node: SceneNode) {
  const options: Record<string, unknown> = {
    ...sharedOptions(node),
    scaleX: 1,
    scaleY: 1,
  }

  if (node.type === "rect" && object instanceof Rect) {
    Object.assign(options, {
      fill: node.fill,
      rx: node.radius,
      ry: node.radius,
      stroke: node.stroke,
      strokeWidth: node.stroke ? 1 : 0,
    })
  } else if (node.type === "ellipse" && object instanceof Ellipse) {
    Object.assign(options, {
      fill: node.fill,
      rx: node.width / 2,
      ry: node.height / 2,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
  } else if (node.type === "line" && object instanceof Line) {
    Object.assign(options, {
      x1: 0,
      y1: 0,
      x2: node.width,
      y2: node.height,
      fill: undefined,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
  } else if (node.type === "icon" && object instanceof Path) {
    const naturalWidth = object.width || node.width
    const naturalHeight = object.height || node.height
    delete options.width
    delete options.height
    Object.assign(options, {
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      scaleX: node.width / naturalWidth,
      scaleY: node.height / naturalHeight,
    })
  } else if (node.type === "text" && object instanceof Textbox) {
    if (!object.isEditing) options.text = node.text
    Object.assign(options, {
      fill: node.color,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      textAlign: node.align,
      editable: !node.locked,
    })
  } else if (node.type === "image" && object instanceof Group) {
    syncImageGroup(object, node)
    return
  }

  object.set(options)
  object.setCoords()
}

export class FabricCanvasAdapter implements CanvasAdapter {
  private canvas: Canvas | null = null
  private pageId: string | null = null
  private generation = 0
  private syncing = false
  private activeGuides: SnapGuide[] = []
  private readonly objectByNodeId = new Map<string, FabricObject>()
  private readonly nodeIdByObject = new WeakMap<FabricObject, string>()

  constructor(private readonly events: CanvasAdapterEvents) {}

  mount(element: HTMLCanvasElement) {
    if (this.canvas) throw new Error("Fabric canvas is already mounted")
    this.canvas = new Canvas(element, {
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      selectionColor: "rgba(24, 24, 27, 0.06)",
      selectionBorderColor: SELECTION_COLOR,
      selectionLineWidth: 2,
      stopContextMenu: true,
      fireRightClick: true,
    })
    this.canvas.on("selection:created", this.onSelection)
    this.canvas.on("selection:updated", this.onSelection)
    this.canvas.on("selection:cleared", this.onSelectionCleared)
    this.canvas.on("object:modified", this.onObjectModified)
    this.canvas.on("object:moving", this.onObjectMoving)
    this.canvas.on("text:editing:exited", this.onTextEditingExited)
    this.canvas.on("after:render", this.onAfterRender)
    this.canvas.upperCanvasEl.setAttribute(
      "aria-label",
      "Interactive design canvas"
    )
    this.canvas.upperCanvasEl.setAttribute("role", "application")
  }

  async unmount() {
    this.generation += 1
    const canvas = this.canvas
    this.canvas = null
    this.pageId = null
    this.objectByNodeId.clear()
    if (!canvas) return
    canvas.off("selection:created", this.onSelection)
    canvas.off("selection:updated", this.onSelection)
    canvas.off("selection:cleared", this.onSelectionCleared)
    canvas.off("object:modified", this.onObjectModified)
    canvas.off("object:moving", this.onObjectMoving)
    canvas.off("text:editing:exited", this.onTextEditingExited)
    canvas.off("after:render", this.onAfterRender)
    await canvas.dispose()
  }

  async sync(document: Document, pageId: string) {
    const canvas = this.canvas
    const page = document.pages.find((candidate) => candidate.id === pageId)
    if (!canvas || !page) return
    const generation = ++this.generation
    const previousSelection = this.getSelection()?.nodeIds ?? []
    this.syncing = true
    this.activeGuides = []

    try {
      if (this.pageId !== pageId) {
        canvas.discardActiveObject()
        canvas.clear()
        this.objectByNodeId.clear()
        this.pageId = pageId
      }

      canvas.setDimensions({ width: page.width, height: page.height })
      canvas.backgroundColor = page.background

      const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
      const wanted = new Set(page.nodeIds)
      for (const [nodeId, object] of this.objectByNodeId) {
        if (!wanted.has(nodeId)) {
          canvas.remove(object)
          this.objectByNodeId.delete(nodeId)
        }
      }

      for (const [index, nodeId] of page.nodeIds.entries()) {
        const node = nodesById.get(nodeId)
        if (!node) continue
        let object = this.objectByNodeId.get(nodeId)

        if (object && node.type === "image") {
          const image =
            object instanceof Group
              ? object
                  .getObjects()
                  .find(
                    (child): child is FabricImage =>
                      child instanceof FabricImage
                  )
              : undefined
          if (!image || image.getSrc() !== node.src) {
            canvas.remove(object)
            this.objectByNodeId.delete(nodeId)
            object = undefined
          }
        }

        if (!object) {
          object =
            node.type === "image"
              ? await createImageObject(node)
              : createSyncObject(node)
          if (generation !== this.generation || !this.canvas) return
          this.objectByNodeId.set(node.id, object)
          this.nodeIdByObject.set(object, node.id)
          canvas.add(object)
        } else {
          syncObjectFromNode(object, node)
        }
        canvas.moveObjectTo(object, index)
      }

      const selectionObjects = previousSelection
        .map((nodeId) => this.objectByNodeId.get(nodeId))
        .filter((object): object is FabricObject => Boolean(object))
      if (selectionObjects.length === 1 && selectionObjects[0]) {
        canvas.setActiveObject(selectionObjects[0])
      } else if (selectionObjects.length > 1) {
        canvas.setActiveObject(
          new ActiveSelection(selectionObjects, { canvas })
        )
      }
      canvas.requestRenderAll()
    } finally {
      if (generation === this.generation) this.syncing = false
    }
  }

  select(selection: Selection | null) {
    const canvas = this.canvas
    if (!canvas) return
    this.syncing = true
    try {
      canvas.discardActiveObject()
      const objects = (selection?.nodeIds ?? [])
        .map((nodeId) => this.objectByNodeId.get(nodeId))
        .filter((object): object is FabricObject => Boolean(object))
      if (objects.length === 1 && objects[0]) {
        canvas.setActiveObject(objects[0])
      } else if (objects.length > 1) {
        canvas.setActiveObject(new ActiveSelection(objects, { canvas }))
      }
      canvas.requestRenderAll()
    } finally {
      this.syncing = false
    }
  }

  getSelection(): Selection | null {
    if (!this.canvas || !this.pageId) return null
    const nodeIds = this.canvas
      .getActiveObjects()
      .map((object) => this.nodeIdByObject.get(object))
      .filter((nodeId): nodeId is string => Boolean(nodeId))
    return nodeIds.length ? { pageId: this.pageId, nodeIds } : null
  }

  exportPng() {
    return (
      this.canvas?.toDataURL({
        format: "png",
        multiplier: 1,
        enableRetinaScaling: false,
      }) ?? null
    )
  }

  private onSelection = () => {
    if (!this.syncing) this.events.onSelectionChange(this.getSelection())
  }

  private onSelectionCleared = () => {
    this.clearGuides()
    if (!this.syncing) this.events.onSelectionChange(null)
  }

  private onObjectMoving = ({ target }: { target?: FabricObject }) => {
    const canvas = this.canvas
    if (this.syncing || !canvas || !target) return
    const movingObjects = new Set(
      target instanceof ActiveSelection ? target.getObjects() : [target]
    )
    const bounds = snapBoundsForObject(target)
    const peers = [...this.objectByNodeId.values()]
      .filter((object) => !movingObjects.has(object) && object.visible)
      .map(snapBoundsForObject)
    const snap = calculateSnap(
      {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      { width: canvas.getWidth(), height: canvas.getHeight() },
      peers
    )
    if (snap.deltaX || snap.deltaY) {
      target.set({
        left: (target.left ?? 0) + snap.deltaX,
        top: (target.top ?? 0) + snap.deltaY,
      })
      target.setCoords()
    }
    this.activeGuides = snap.guides
    canvas.requestRenderAll()
  }

  private onAfterRender = () => {
    const canvas = this.canvas
    if (!canvas || !this.activeGuides.length) return
    const context = canvas.contextTop
    context.save()
    context.strokeStyle = GUIDE_COLOR
    context.lineWidth = 2
    context.setLineDash([8, 6])
    for (const guide of this.activeGuides) {
      context.beginPath()
      if (guide.axis === "x") {
        context.moveTo(guide.value, 0)
        context.lineTo(guide.value, canvas.getHeight())
      } else {
        context.moveTo(0, guide.value)
        context.lineTo(canvas.getWidth(), guide.value)
      }
      context.stroke()
    }
    context.restore()
  }

  private clearGuides() {
    if (!this.activeGuides.length) return
    this.activeGuides = []
    this.canvas?.requestRenderAll()
  }

  private onObjectModified = ({ target }: ModifiedEvent) => {
    this.clearGuides()
    if (this.syncing || !target) return
    const targets =
      target instanceof ActiveSelection ? target.getObjects() : [target]
    const changes: CanvasNodeChange[] = []
    for (const object of targets) {
      const nodeId = this.nodeIdByObject.get(object)
      if (!nodeId) continue
      changes.push({ nodeId, patch: fabricObjectToNodePatch(object) })
    }
    if (changes.length) this.events.onNodesChange(changes)
  }

  private onTextEditingExited = ({ target }: { target: FabricObject }) => {
    if (this.syncing || !(target instanceof Textbox)) return
    const nodeId = this.nodeIdByObject.get(target)
    if (!nodeId) return
    this.events.onNodesChange([
      {
        nodeId,
        patch: {
          ...fabricObjectToNodePatch(target),
          text: target.text,
        },
      },
    ])
  }
}
