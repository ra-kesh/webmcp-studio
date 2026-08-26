import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
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

const SELECTION_COLOR = "#18181b"

const round = (value: number) => Math.round(value * 10) / 10

export function fabricObjectToNodePatch(
  object: FabricObject
): Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation"> {
  const position = object.getXY()
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
  const image = await FabricImage.fromURL(
    node.src,
    { crossOrigin: "anonymous" },
    sharedOptions(node)
  )
  const naturalWidth = image.width || node.width
  const naturalHeight = image.height || node.height
  image.set({
    scaleX: node.width / naturalWidth,
    scaleY: node.height / naturalHeight,
  })
  return image
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
  } else if (node.type === "image" && object instanceof FabricImage) {
    const naturalWidth = object.width || node.width
    const naturalHeight = object.height || node.height
    delete options.width
    delete options.height
    options.scaleX = node.width / naturalWidth
    options.scaleY = node.height / naturalHeight
  }

  object.set(options)
  object.setCoords()
}

export class FabricCanvasAdapter implements CanvasAdapter {
  private canvas: Canvas | null = null
  private pageId: string | null = null
  private generation = 0
  private syncing = false
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
    this.canvas.on("text:editing:exited", this.onTextEditingExited)
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
    canvas.off("text:editing:exited", this.onTextEditingExited)
    await canvas.dispose()
  }

  async sync(document: Document, pageId: string) {
    const canvas = this.canvas
    const page = document.pages.find((candidate) => candidate.id === pageId)
    if (!canvas || !page) return
    const generation = ++this.generation
    const previousSelection = this.getSelection()?.nodeIds ?? []
    this.syncing = true

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
    if (!this.syncing) this.events.onSelectionChange(null)
  }

  private onObjectModified = ({ target }: ModifiedEvent) => {
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
