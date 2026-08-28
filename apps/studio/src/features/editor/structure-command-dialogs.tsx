import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
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

export type StructureCommandDialogState =
  | Readonly<{ kind: "rename-page"; id: string; name: string }>
  | Readonly<{ kind: "rename-output"; id: string; name: string }>
  | Readonly<{ kind: "add-output" }>
  | Readonly<{
      kind: "delete-page" | "delete-output"
      id: string
      name: string
      childCount: number
    }>

const numericDimension = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

export function StructureCommandDialogs({
  state,
  onOpenChange,
  onRenamePage,
  onRenameOutput,
  onAddOutput,
  onDeletePage,
  onDeleteOutput,
}: {
  state: StructureCommandDialogState | null
  onOpenChange: (open: boolean) => void
  onRenamePage: (pageId: string, name: string) => void
  onRenameOutput: (outputId: string, name: string) => void
  onAddOutput: (options: {
    name: string
    width: number
    height: number
  }) => void
  onDeletePage: (pageId: string) => void
  onDeleteOutput: (outputId: string) => void
}) {
  const [name, setName] = useState("")
  const [width, setWidth] = useState(1080)
  const [height, setHeight] = useState(1080)

  useEffect(() => {
    if (state?.kind === "rename-page" || state?.kind === "rename-output") {
      setName(state.name)
    } else if (state?.kind === "add-output") {
      setName("New output")
      setWidth(1080)
      setHeight(1080)
    }
  }, [state])

  const renameState =
    state?.kind === "rename-page" || state?.kind === "rename-output"
      ? state
      : null
  const deleteState =
    state?.kind === "delete-page" || state?.kind === "delete-output"
      ? state
      : null

  return (
    <>
      <Dialog
        open={Boolean(renameState)}
        onOpenChange={(open) => !open && onOpenChange(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Rename {renameState?.kind === "rename-output" ? "output" : "page"}
            </DialogTitle>
            <DialogDescription>
              This name appears in the editor, exports, and automation API.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!renameState || !name.trim()) return
              if (renameState.kind === "rename-page") {
                onRenamePage(renameState.id, name.trim())
              } else {
                onRenameOutput(renameState.id, name.trim())
              }
              onOpenChange(false)
            }}
          >
            <Input
              aria-label={
                renameState?.kind === "rename-output"
                  ? "Output name"
                  : "Page name"
              }
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={state?.kind === "add-output"}
        onOpenChange={(open) => !open && onOpenChange(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New output</DialogTitle>
            <DialogDescription>
              Create an output with one blank page. More pages can be added
              afterward.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim() || width < 1 || height < 1) return
              onAddOutput({ name: name.trim(), width, height })
              onOpenChange(false)
            }}
          >
            <Input
              aria-label="Output name"
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-xs">
                Width
                <Input
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={width}
                  onChange={(event) =>
                    setWidth(numericDimension(event.target.value))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                Height
                <Input
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={height}
                  onChange={(event) =>
                    setHeight(numericDimension(event.target.value))
                  }
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || width < 1 || height < 1}
              >
                Create output
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteState)}
        onOpenChange={(open) => !open && onOpenChange(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteState?.kind === "delete-output" ? "output" : "page"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteState?.kind === "delete-output"
                ? `“${deleteState.name}” and its ${deleteState.childCount} page${deleteState.childCount === 1 ? "" : "s"} will be removed. You can undo this action from the editor history.`
                : `“${deleteState?.name}” and its ${deleteState?.childCount ?? 0} object${deleteState?.childCount === 1 ? "" : "s"} will be removed. You can undo this action from the editor history.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteState) return
                if (deleteState.kind === "delete-output") {
                  onDeleteOutput(deleteState.id)
                } else {
                  onDeletePage(deleteState.id)
                }
                onOpenChange(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
