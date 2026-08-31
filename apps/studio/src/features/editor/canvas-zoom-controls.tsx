"use client"

import { Check, Focus, Scan, ZoomIn, ZoomOut } from "lucide-react"

import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"

const zoomPresets = [0.25, 0.5, 1, 2] as const

function ZoomIconButton({
  label,
  shortcut,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  shortcut?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={label}
          className={cn(
            "size-11 rounded-md min-[1280px]:size-7 [&_svg]:size-3.5",
            className
          )}
          size="icon-sm"
          variant="ghost"
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        {shortcut ? (
          <span className="ml-2 text-background/60">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function CanvasZoomControls({
  zoom,
  hasSelection,
  onZoomChange,
  onFit,
  onZoomToSelection,
  className,
}: {
  zoom: number
  hasSelection: boolean
  onZoomChange: (zoom: number) => void
  onFit: () => void
  onZoomToSelection: () => void
  className?: string
}) {
  const zoomPercent = Math.round(zoom * 100)

  return (
    <TooltipProvider delayDuration={350}>
      <div
        aria-label="Canvas zoom controls"
        className={cn(
          "flex h-12 max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-lg border bg-editor-floating p-1 shadow-md ring-1 ring-black/3 backdrop-blur-md min-[1280px]:h-9",
          className
        )}
        data-canvas-zoom-controls="true"
        role="toolbar"
      >
        <ZoomIconButton
          label="Zoom out"
          shortcut="⌘−"
          onClick={() => onZoomChange(zoom / 1.2)}
        >
          <ZoomOut />
        </ZoomIconButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              aria-label={`Canvas zoom: ${zoomPercent}%`}
              className="h-11 min-w-14 rounded-md px-2 text-[11px] font-medium tabular-nums min-[1280px]:h-7 min-[1280px]:min-w-12"
              size="sm"
              variant="ghost"
            >
              {zoomPercent}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="w-56"
            side="top"
            sideOffset={8}
          >
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Zoom</span>
              <span className="font-normal text-muted-foreground tabular-nums">
                {zoomPercent}%
              </span>
            </DropdownMenuLabel>
            <div className="px-2 py-2">
              <Slider
                aria-label="Canvas zoom"
                aria-valuetext={`${zoomPercent}%`}
                min={10}
                max={400}
                step={1}
                value={[zoom * 100]}
                onValueChange={([value]) => onZoomChange(value / 100)}
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onZoomChange(zoom * 1.2)}>
              <ZoomIn />
              Zoom in
              <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onZoomChange(zoom / 1.2)}>
              <ZoomOut />
              Zoom out
              <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onFit}>
              <Scan />
              Fit page
              <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!hasSelection}
              onSelect={onZoomToSelection}
            >
              <Focus />
              Zoom to selection
              <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {zoomPresets.map((preset) => (
              <DropdownMenuItem
                key={preset}
                className="pl-7"
                onSelect={() => onZoomChange(preset)}
              >
                {Math.abs(zoom - preset) < 0.005 ? (
                  <Check className="absolute left-2 size-3.5" />
                ) : null}
                {Math.round(preset * 100)}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ZoomIconButton
          label="Zoom in"
          shortcut="⌘+"
          onClick={() => onZoomChange(zoom * 1.2)}
        >
          <ZoomIn />
        </ZoomIconButton>

        <Separator className="mx-0.5 h-4" orientation="vertical" />

        <ZoomIconButton label="Fit page" shortcut="⇧1" onClick={onFit}>
          <Scan />
        </ZoomIconButton>
        <ZoomIconButton
          label="Zoom to selection"
          shortcut="⇧2"
          className="hidden min-[480px]:inline-flex"
          disabled={!hasSelection}
          onClick={onZoomToSelection}
        >
          <Focus />
        </ZoomIconButton>
      </div>
    </TooltipProvider>
  )
}
