import { createContext, useContext, useEffect, useState } from "react"
import type { PropsWithChildren } from "react"
import type { LibraryPreviewDescriptor } from "@webmcp/document"
import {
  LibraryPreviewController,
  type LibraryPreviewState,
} from "./library-preview-controller"

type LibraryPreviewControllerPort = Pick<
  LibraryPreviewController,
  "subscribe" | "getSnapshot" | "retain" | "retry"
>

const deferredState: LibraryPreviewState = Object.freeze({
  status: "deferred",
})

const inactiveController: LibraryPreviewControllerPort = {
  subscribe: () => () => {},
  getSnapshot: (_descriptor: LibraryPreviewDescriptor) => deferredState,
  retain: (_descriptor: LibraryPreviewDescriptor) => () => {},
  retry: (_descriptor: LibraryPreviewDescriptor) => {},
}

const LibraryPreviewContext =
  createContext<LibraryPreviewControllerPort | null>(null)

export type LibraryPreviewProviderProps = PropsWithChildren<{
  createController?: () => LibraryPreviewController
}>

export function LibraryPreviewProvider({
  children,
  createController,
}: LibraryPreviewProviderProps) {
  const [controller] = useState(
    () => createController?.() ?? new LibraryPreviewController()
  )
  const [lifecycle] = useState(() => ({ generation: 0 }))

  useEffect(() => {
    const generation = ++lifecycle.generation
    return () => {
      globalThis.queueMicrotask(() => {
        if (lifecycle.generation === generation) controller.dispose()
      })
    }
  }, [controller, lifecycle])

  return (
    <LibraryPreviewContext.Provider value={controller}>
      {children}
    </LibraryPreviewContext.Provider>
  )
}

export function useLibraryPreviewController() {
  return useContext(LibraryPreviewContext) ?? inactiveController
}
