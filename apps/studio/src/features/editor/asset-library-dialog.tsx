import { ImageIcon } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@webmcp/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { studioAssets, type StudioAsset } from "./asset-catalog"

export function AssetLibraryDialog({
  open,
  onOpenChange,
  onInsert,
  onUpload,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onInsert(asset: StudioAsset): void
  onUpload(): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Asset library</DialogTitle>
          <DialogDescription className="text-xs">
            Search original, renderer-safe artwork or add an image from your
            device.
          </DialogDescription>
        </DialogHeader>
        <Command className="min-h-0 rounded-none bg-background p-0">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <CommandInput
              autoFocus
              className="text-xs"
              placeholder="Search botanicals, textures, architecture…"
            />
            <Button
              className="shrink-0"
              size="sm"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                onUpload()
              }}
            >
              <ImageIcon data-icon="inline-start" />
              Upload
            </Button>
          </div>
          <CommandList className="max-h-[min(560px,calc(100dvh-12rem))] p-3">
            <CommandEmpty className="py-16 text-xs text-muted-foreground">
              No assets match that search.
            </CommandEmpty>
            <CommandGroup
              heading={`${studioAssets.length} original assets`}
              className="p-0 **:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pb-2 **:[[cmdk-group-items]]:grid **:[[cmdk-group-items]]:grid-cols-2 **:[[cmdk-group-items]]:gap-2 sm:**:[[cmdk-group-items]]:grid-cols-3"
            >
              {studioAssets.map((asset) => (
                <CommandItem
                  key={asset.id}
                  value={`${asset.name} ${asset.description} ${asset.tags.join(" ")}`}
                  className="group/asset block overflow-hidden rounded-lg border p-0 data-selected:border-foreground/25 data-selected:bg-muted [&>svg:last-child]:hidden"
                  onSelect={() => {
                    onInsert(asset)
                    onOpenChange(false)
                  }}
                >
                  <div className="aspect-4/3 overflow-hidden bg-muted">
                    <img
                      alt=""
                      className="size-full object-cover transition-transform duration-200 group-data-selected/asset:scale-[1.02]"
                      src={asset.src}
                    />
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="truncate text-xs font-medium">{asset.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {asset.description}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
