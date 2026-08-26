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
        "flex h-(--studio-contextbar-height) shrink-0 items-center border-b bg-background px-3",
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
          "!h-full w-full justify-start rounded-none p-0 px-3 [&_[data-slot=tabs-trigger]]:!h-full [&_[data-slot=tabs-trigger]]:after:bottom-0",
          className
        )}
        {...props}
      />
    </EditorPanelHeader>
  )
}

export { EditorPanelHeader, EditorPanelTabsList }
