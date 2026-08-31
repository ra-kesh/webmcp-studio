"use client"

import {
  Crop,
  Ellipsis,
  FlipHorizontal2,
  FlipVertical2,
  ImageUp,
  RotateCcw,
  RotateCw,
  Scan,
  Square,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import type { SceneNode } from "@webmcp/document"
import { editorCommandLabel } from "@webmcp/editor/commands"
import type { EditorImageCommandId } from "@webmcp/editor/commands"
import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { Separator } from "@webmcp/ui/components/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"

type ImageNode = Extract<SceneNode, { type: "image" }>

export const selectedImageMoreActions = [
  { id: "image.rotate-left", icon: RotateCcw },
  { id: "image.rotate-right", icon: RotateCw },
  {
    id: "image.rotation.reset",
    icon: Scan,
  },
  {
    id: "image.reset-placement",
    icon: Square,
  },
] as const satisfies ReadonlyArray<{
  id: EditorImageCommandId
  icon: typeof Scan
}>

export const selectedImageCompactOverflowActionIds = [
  "image.fit",
  "image.fill",
  "image.flip-horizontal",
  "image.flip-vertical",
] as const satisfies readonly EditorImageCommandId[]

export const selectedImageFrameActionIds = [
  "image.frame.rectangle",
  "image.frame.rounded-rectangle",
  "image.frame.ellipse",
] as const satisfies readonly EditorImageCommandId[]

type ToolbarIconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children"
> & {
  label: string
  children: ReactNode
}

function ToolbarIconButton({
  label,
  children,
  className,
  ...props
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          className={cn(
            "size-11 rounded-lg min-[1280px]:size-7 min-[1280px]:rounded-md [&_svg]:size-3.5",
            className
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function SelectedImageToolbar({
  image,
  onRunCommand,
  isCommandEnabled,
  className,
}: {
  image: ImageNode
  onRunCommand: (commandId: EditorImageCommandId) => void
  isCommandEnabled: (commandId: EditorImageCommandId) => boolean
  className?: string
}) {
  const run = (commandId: EditorImageCommandId) => () => onRunCommand(commandId)

  return (
    <TooltipProvider delayDuration={350}>
      <div
        aria-label={`Image actions for ${image.name}`}
        className={cn(
          "flex h-12 max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-xl border bg-editor-floating p-0.5 shadow-md ring-1 ring-black/3 backdrop-blur-md min-[1280px]:h-9 min-[1280px]:rounded-lg min-[1280px]:p-1",
          className
        )}
        data-selected-image-toolbar="true"
        role="toolbar"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 rounded-lg px-2.5 text-xs min-[1280px]:h-7 min-[1280px]:rounded-md min-[1280px]:px-2 min-[1280px]:text-[11px]"
          data-command-id="image.crop"
          disabled={!isCommandEnabled("image.crop")}
          onClick={run("image.crop")}
        >
          <Crop data-icon="inline-start" />
          {editorCommandLabel("image.crop")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 rounded-lg px-2.5 text-xs min-[1280px]:h-7 min-[1280px]:rounded-md min-[1280px]:px-2 min-[1280px]:text-[11px]"
          data-command-id="image.replace"
          disabled={!isCommandEnabled("image.replace")}
          onClick={run("image.replace")}
        >
          <ImageUp data-icon="inline-start" />
          {editorCommandLabel("image.replace")}
        </Button>
        <Separator className="mx-0.5 h-5" orientation="vertical" />
        <div
          aria-label="Image sizing"
          className="hidden rounded-lg bg-muted p-0.5 min-[480px]:flex min-[1280px]:rounded-md"
          role="group"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={image.placement.mode === "fit"}
            className="h-10 rounded-md px-2 text-[11px] aria-pressed:bg-background aria-pressed:shadow-xs min-[1280px]:h-7 min-[1280px]:rounded-[5px]"
            data-command-id="image.fit"
            disabled={!isCommandEnabled("image.fit")}
            onClick={run("image.fit")}
          >
            {editorCommandLabel("image.fit")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={image.placement.mode === "fill"}
            className="h-10 rounded-md px-2 text-[11px] aria-pressed:bg-background aria-pressed:shadow-xs min-[1280px]:h-7 min-[1280px]:rounded-[5px]"
            data-command-id="image.fill"
            disabled={!isCommandEnabled("image.fill")}
            onClick={run("image.fill")}
          >
            {editorCommandLabel("image.fill")}
          </Button>
        </div>
        <Separator
          className="mx-0.5 hidden h-5 min-[480px]:block"
          orientation="vertical"
        />
        <div className="hidden items-center gap-1 min-[560px]:flex">
          <ToolbarIconButton
            label={editorCommandLabel("image.flip-horizontal")}
            aria-pressed={image.placement.flipX}
            data-command-id="image.flip-horizontal"
            disabled={!isCommandEnabled("image.flip-horizontal")}
            onClick={run("image.flip-horizontal")}
          >
            <FlipHorizontal2 />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={editorCommandLabel("image.flip-vertical")}
            aria-pressed={image.placement.flipY}
            data-command-id="image.flip-vertical"
            disabled={!isCommandEnabled("image.flip-vertical")}
            onClick={run("image.flip-vertical")}
          >
            <FlipVertical2 />
          </ToolbarIconButton>
        </div>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="More image actions"
                  className="size-11 rounded-lg min-[1280px]:size-7 min-[1280px]:rounded-md [&_svg]:size-3.5"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              More image actions
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>Image</DropdownMenuLabel>
            <DropdownMenuItem
              className="min-h-11 min-[480px]:hidden min-[1280px]:min-h-0"
              data-command-id="image.fit"
              disabled={!isCommandEnabled("image.fit")}
              onSelect={run("image.fit")}
            >
              {editorCommandLabel("image.fit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 min-[480px]:hidden min-[1280px]:min-h-0"
              data-command-id="image.fill"
              disabled={!isCommandEnabled("image.fill")}
              onSelect={run("image.fill")}
            >
              {editorCommandLabel("image.fill")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 min-[560px]:hidden min-[1280px]:min-h-0"
              data-command-id="image.flip-horizontal"
              disabled={!isCommandEnabled("image.flip-horizontal")}
              onSelect={run("image.flip-horizontal")}
            >
              <FlipHorizontal2 />
              {editorCommandLabel("image.flip-horizontal")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 min-[560px]:hidden min-[1280px]:min-h-0"
              data-command-id="image.flip-vertical"
              disabled={!isCommandEnabled("image.flip-vertical")}
              onSelect={run("image.flip-vertical")}
            >
              <FlipVertical2 />
              {editorCommandLabel("image.flip-vertical")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {selectedImageMoreActions.map((action) => {
              const Icon = action.icon
              return (
                <DropdownMenuItem
                  key={action.id}
                  className="min-h-11 min-[1280px]:min-h-0"
                  data-command-id={action.id}
                  disabled={!isCommandEnabled(action.id)}
                  onSelect={run(action.id)}
                >
                  <Icon />
                  {editorCommandLabel(action.id)}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 min-[1280px]:min-h-0"
              data-command-id="image.frame.rectangle"
              disabled={!isCommandEnabled("image.frame.rectangle")}
              onSelect={run("image.frame.rectangle")}
            >
              <Square />
              {editorCommandLabel("image.frame.rectangle")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 min-[1280px]:min-h-0"
              data-command-id="image.frame.rounded-rectangle"
              disabled={!isCommandEnabled("image.frame.rounded-rectangle")}
              onSelect={run("image.frame.rounded-rectangle")}
            >
              <span className="size-4 rounded-[4px] border border-current" />
              {editorCommandLabel("image.frame.rounded-rectangle")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 min-[1280px]:min-h-0"
              data-command-id="image.frame.ellipse"
              disabled={!isCommandEnabled("image.frame.ellipse")}
              onSelect={run("image.frame.ellipse")}
            >
              <span className="size-4 rounded-full border border-current" />
              {editorCommandLabel("image.frame.ellipse")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  )
}
