import * as React from "react"

import { TabsList } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"

function EditorPanelHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="editor-panel-header"
      className={cn(
        "flex h-(--studio-contextbar-height) shrink-0 items-center border-b border-border/80 bg-background px-2.5",
        className
      )}
      {...props}
    />
  )
}

function EditorPanelTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsList>) {
  return (
    <EditorPanelHeader className="p-0">
      <TabsList
        variant="line"
        className={cn(
          "!h-full w-full justify-start gap-0.5 rounded-none p-0 px-2 [&_[data-slot=tabs-trigger]]:!h-full [&_[data-slot=tabs-trigger]]:after:bottom-0 [&_[data-slot=tabs-trigger]]:focus-visible:border-studio-accent [&_[data-slot=tabs-trigger]]:focus-visible:ring-studio-accent/35 [&_[data-slot=tabs-trigger]]:focus-visible:ring-inset",
          className
        )}
        {...props}
      />
    </EditorPanelHeader>
  )
}

function EditorPanelSectionHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="editor-panel-section-header"
      className={cn(
        "flex min-h-8 shrink-0 items-center gap-2 border-b border-border/70 px-2.5 text-[11px] font-medium",
        className
      )}
      {...props}
    />
  )
}

export { EditorPanelHeader, EditorPanelSectionHeader, EditorPanelTabsList }
