import { createFileRoute } from "@tanstack/react-router"
import { StudioShell } from "../../features/studio-shell"

export const Route = createFileRoute("/_studio/")({
  component: StudioLibraryRoute,
})

function StudioLibraryRoute() {
  return <StudioShell />
}
