import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import type { Document } from "@webmcp/document"
import type { CanvasAdapter, CanvasNodeChange, Selection } from "@webmcp/editor"

export type FabricArtboardHandle = {
  exportPng: () => string | null
}

export const FabricArtboard = forwardRef<
  FabricArtboardHandle,
  {
    document: Document
    pageId: string
    selection: Selection | null
    zoom: number
    interactive?: boolean
    onSelectionChange: (selection: Selection | null) => void
    onNodesChange: (changes: CanvasNodeChange[]) => void
  }
>(function FabricArtboard(
  {
    document,
    pageId,
    selection,
    zoom,
    interactive = true,
    onSelectionChange,
    onNodesChange,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const adapterRef = useRef<CanvasAdapter | null>(null)
  const callbacksRef = useRef({ onSelectionChange, onNodesChange })
  const [ready, setReady] = useState(false)
  callbacksRef.current = { onSelectionChange, onNodesChange }

  const page = document.pages.find((candidate) => candidate.id === pageId)

  useImperativeHandle(
    ref,
    () => ({ exportPng: () => adapterRef.current?.exportPng() ?? null }),
    []
  )

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    let active = true
    let adapter: CanvasAdapter | null = null

    void import("@webmcp/editor/fabric").then(({ FabricCanvasAdapter }) => {
      if (!active) return
      adapter = new FabricCanvasAdapter({
        onSelectionChange: (nextSelection) =>
          callbacksRef.current.onSelectionChange(nextSelection),
        onNodesChange: (changes) => callbacksRef.current.onNodesChange(changes),
      })
      adapter.mount(element)
      adapterRef.current = adapter
      setReady(true)
    })

    return () => {
      active = false
      adapterRef.current = null
      if (adapter) void adapter.unmount()
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    void adapterRef.current?.sync(document, pageId)
  }, [document, pageId, ready])

  useEffect(() => {
    if (!ready) return
    adapterRef.current?.select(selection)
  }, [ready, selection])

  if (!page) return null

  return (
    <div
      className={`relative shrink-0 shadow-[0_24px_70px_rgba(35,31,25,0.18)] ring-1 ring-black/10 ${interactive ? "" : "pointer-events-none"}`}
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left bg-white"
        style={{
          width: page.width,
          height: page.height,
          transform: `scale(${zoom})`,
        }}
      >
        <canvas ref={canvasRef} />
      </div>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-xs text-muted-foreground">
          Preparing canvas…
        </div>
      ) : null}
    </div>
  )
})
