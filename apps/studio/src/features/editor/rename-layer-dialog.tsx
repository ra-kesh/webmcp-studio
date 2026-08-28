import { useEffect, useState } from "react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { Input } from "@webmcp/ui/components/input"
import { Label } from "@webmcp/ui/components/label"

export type RenameLayerTarget = Readonly<{
  nodeId: string
  name: string
}>

export function RenameLayerDialog({
  target,
  onOpenChange,
  onRename,
}: {
  target: RenameLayerTarget | null
  onOpenChange: (open: boolean) => void
  onRename: (nodeId: string, name: string) => boolean
}) {
  const [name, setName] = useState("")

  useEffect(() => {
    setName(target?.name ?? "")
  }, [target])

  const submit = () => {
    if (!target || !name.trim()) return
    if (onRename(target.nodeId, name.trim())) onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename layer</DialogTitle>
          <DialogDescription>
            Give this layer a clear name for the Layers panel and automation
            API.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="rename-layer-name">Layer name</Label>
            <Input
              id="rename-layer-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
