import { createContext, useContext } from "react"
import type { MultiArtboardRenderRegistry } from "./multi-artboard-render-registry"

export const MultiArtboardRenderRegistryContext =
  createContext<MultiArtboardRenderRegistry | null>(null)

export function useMultiArtboardRenderRegistry() {
  return useContext(MultiArtboardRenderRegistryContext)
}
