import { createFileRoute } from "@tanstack/react-router"
import { StudioShell } from "@/features/studio-shell"

export const Route = createFileRoute("/")({ component: App })

function App() {
  return <StudioShell />
}
