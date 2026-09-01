import { FlipHorizontal2, FlipVertical2, RotateCwSquare } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import type { PositionTransformAction } from "./position-transform"

export function PositionTransformControls({
  disabled = false,
  flipX,
  flipY,
  onTransform,
}: {
  disabled?: boolean
  flipX?: boolean
  flipY?: boolean
  onTransform: (action: PositionTransformAction) => void
}) {
  return (
    <div
      aria-label="Transform layer"
      className="flex h-8 items-center justify-end gap-0.5"
      role="toolbar"
    >
      <Button
        aria-label="Flip horizontally"
        aria-pressed={flipX}
        disabled={disabled}
        size="icon-xs"
        title="Flip horizontally"
        variant="ghost"
        onClick={() => onTransform("flip-horizontal")}
      >
        <FlipHorizontal2 />
      </Button>
      <Button
        aria-label="Flip vertically"
        aria-pressed={flipY}
        disabled={disabled}
        size="icon-xs"
        title="Flip vertically"
        variant="ghost"
        onClick={() => onTransform("flip-vertical")}
      >
        <FlipVertical2 />
      </Button>
      <Button
        aria-label="Rotate 90° clockwise"
        disabled={disabled}
        size="icon-xs"
        title="Rotate 90° clockwise"
        variant="ghost"
        onClick={() => onTransform("rotate-90")}
      >
        <RotateCwSquare />
      </Button>
    </div>
  )
}
