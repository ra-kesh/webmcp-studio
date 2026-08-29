import { createFileRoute } from "@tanstack/react-router"
import { renderConformanceDocument } from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import { useEffect, useRef, useState } from "react"
import { FabricArtboard } from "../features/editor/fabric-artboard"

export const Route = createFileRoute("/render-conformance")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    page: typeof search.page === "string" ? search.page : undefined,
  }),
  component: RenderConformanceHarness,
})

function RenderConformanceHarness() {
  const { page: requestedPageId } = Route.useSearch()
  const pages = requestedPageId
    ? renderConformanceDocument.pages.filter(
        (page) => page.id === requestedPageId
      )
    : renderConformanceDocument.pages

  return (
    <main
      data-render-conformance-harness="v3"
      style={{
        display: "grid",
        gap: 48,
        minWidth: "max-content",
        padding: 48,
        background: "#d4d4d4",
      }}
    >
      <script
        data-conformance-document="v3"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(renderConformanceDocument).replaceAll(
            "<",
            "\\u003c"
          ),
        }}
      />
      {pages.map((page) => (
        <RenderConformancePair key={page.id} pageId={page.id} />
      ))}
    </main>
  )
}

function RenderConformancePair({ pageId }: { pageId: string }) {
  const page = renderConformanceDocument.pages.find(
    (candidate) => candidate.id === pageId
  )!
  const renderViewRef = useRef<HTMLDivElement>(null)
  const [renderViewState, setRenderViewState] =
    useState<ConformanceState>("preparing")
  const [fabricState, setFabricState] = useState<ConformanceState>("preparing")

  useEffect(() => {
    const element = renderViewRef.current
    if (!element) return
    let active = true
    void waitForRenderViewCapture(element)
      .then(() => active && setRenderViewState("ready"))
      .catch(() => active && setRenderViewState("error"))
    return () => {
      active = false
    }
  }, [])

  return (
    <section
      style={{ display: "grid", gap: 24, gridTemplateColumns: "auto auto" }}
    >
      <div
        ref={renderViewRef}
        data-conformance-capture={`render-view:${page.id}`}
        data-conformance-state={renderViewState}
        style={{
          width: page.width,
          height: page.height,
          overflow: "hidden",
        }}
      >
        <Artboard
          document={renderConformanceDocument}
          pageId={page.id}
          showImageRecoveryActions={false}
        />
      </div>
      <div
        data-conformance-capture={`fabric:${page.id}`}
        data-conformance-state={fabricState}
        style={{
          width: page.width,
          height: page.height,
          overflow: "hidden",
        }}
      >
        <FabricArtboard
          document={renderConformanceDocument}
          interactive={false}
          pageId={page.id}
          selection={null}
          zoom={1}
          onNodesChange={() => false}
          onRuntimeStateChange={(state) => setFabricState(state)}
          onSelectionChange={() => undefined}
        />
      </div>
    </section>
  )
}

type ConformanceState = "preparing" | "ready" | "error"

async function waitForRenderViewCapture(element: HTMLElement) {
  await document.fonts.ready
  await Promise.all(
    [...element.querySelectorAll("img")].map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true })
          image.addEventListener("error", () => reject(new Error("image")), {
            once: true,
          })
        })
      }
      if (!image.naturalWidth) throw new Error("Image unavailable")
      await image.decode()
    })
  )
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}
