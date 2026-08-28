import { useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import type { Document } from "@webmcp/document"
import { projectImageCropFrameResize } from "@webmcp/editor"
import type {
  ImageCropFrameHandle,
  ImageCropFrameResizeProjection,
} from "@webmcp/editor"

type ImageNode = Extract<Document["nodes"][number], { type: "image" }>

export type ImageCropFramePreview = Readonly<{
  nodeId: string
  frame: ImageCropFrameResizeProjection["frame"]
  placement: ImageCropFrameResizeProjection["placement"]
  frameMask: ImageCropFrameResizeProjection["frameMask"]
}>

type ActiveFrameResize = Readonly<{
  pointerId: number
  handle: ImageCropFrameHandle
  start: Readonly<{ x: number; y: number }>
  node: ImageNode
  naturalSize: Readonly<{ width: number; height: number }>
}>

const handlePositions: ReadonlyArray<
  Readonly<{
    handle: ImageCropFrameHandle
    x: number
    y: number
  }>
> = [
  { handle: "nw", x: 0, y: 0 },
  { handle: "n", x: 0.5, y: 0 },
  { handle: "ne", x: 1, y: 0 },
  { handle: "e", x: 1, y: 0.5 },
  { handle: "se", x: 1, y: 1 },
  { handle: "s", x: 0.5, y: 1 },
  { handle: "sw", x: 0, y: 1 },
  { handle: "w", x: 0, y: 0.5 },
]

export function imageCropFrameHandleCursor(
  handle: ImageCropFrameHandle,
  rotation: number
) {
  const baseAngle: Record<ImageCropFrameHandle, number> = {
    e: 0,
    se: 45,
    s: 90,
    sw: 135,
    w: 180,
    nw: 225,
    n: 270,
    ne: 315,
  }
  const angle = (((baseAngle[handle] + rotation) % 180) + 180) % 180
  if (angle < 22.5 || angle >= 157.5) return "ew-resize"
  if (angle < 67.5) return "nwse-resize"
  if (angle < 112.5) return "ns-resize"
  return "nesw-resize"
}

export function ImageCropFrameOverlay({
  node,
  zoom,
  getNaturalSize,
  onPreview,
}: {
  node: ImageNode
  zoom: number
  getNaturalSize: () => Readonly<{ width: number; height: number }> | null
  onPreview: (preview: ImageCropFramePreview) => void
}) {
  const activeResizeRef = useRef<ActiveFrameResize | null>(null)

  const previewResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeResizeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    try {
      const projection = projectImageCropFrameResize({
        handle: active.handle,
        frame: active.node,
        naturalSize: active.naturalSize,
        placement: active.node.placement,
        frameMask: active.node.frameMask,
        screenDelta: {
          x: event.clientX - active.start.x,
          y: event.clientY - active.start.y,
        },
        cameraZoom: zoom,
        preserveAspectRatio: event.shiftKey,
        symmetric: event.altKey,
      })
      onPreview({ nodeId: active.node.id, ...projection })
    } catch {
      // The last valid draft remains visible when schema limits prevent a
      // smaller frame from preserving the current source transform.
    }
  }

  const cancelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeResizeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    activeResizeRef.current = null
    onPreview({
      nodeId: active.node.id,
      frame: active.node,
      placement: active.node.placement,
      frameMask: active.node.frameMask,
    })
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30"
      data-image-crop-frame-handles="true"
      style={{
        left: node.x * zoom,
        top: node.y * zoom,
        width: node.width * zoom,
        height: node.height * zoom,
        transform: `rotate(${node.rotation}deg)`,
        transformOrigin: "top left",
      }}
    >
      {handlePositions.map(({ handle, x, y }) => (
        <div
          key={handle}
          className="pointer-events-auto absolute size-6 -translate-x-1/2 -translate-y-1/2 touch-none border-0 bg-transparent p-0"
          data-crop-frame-handle={handle}
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            cursor: imageCropFrameHandleCursor(handle, node.rotation),
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || activeResizeRef.current) return
            const naturalSize = getNaturalSize()
            if (!naturalSize) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            activeResizeRef.current = {
              pointerId: event.pointerId,
              handle,
              start: { x: event.clientX, y: event.clientY },
              node,
              naturalSize,
            }
          }}
          onPointerMove={(event) => {
            if (activeResizeRef.current?.pointerId !== event.pointerId) return
            event.preventDefault()
            event.stopPropagation()
            previewResize(event)
          }}
          onPointerUp={(event) => {
            if (activeResizeRef.current?.pointerId !== event.pointerId) return
            event.preventDefault()
            event.stopPropagation()
            previewResize(event)
            activeResizeRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={cancelResize}
        >
          <span className="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[#0d99ff] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.85)]" />
        </div>
      ))}
    </div>
  )
}
