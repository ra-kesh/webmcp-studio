import { createFileRoute } from "@tanstack/react-router"
import {
  buildComponentPublicationJourney,
  componentRenderConformanceDocument,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  type Document,
} from "@webmcp/document"
import {
  maskRenderConformanceNodes,
  maskRenderConformanceDocument,
  maskRenderConformanceHiddenSourceNodes,
  maskRenderConformanceHiddenSourcePlan,
  maskRenderConformancePage,
  maskRenderConformancePlan,
} from "@webmcp/document/internal/mask-render-conformance"
import {
  createFabricSyncObject,
  createFabricVectorMaskPaint,
} from "@webmcp/editor/fabric"
import { Artboard, PagePaintPlanView } from "@webmcp/render-view"
import { Canvas as FabricCanvas } from "fabric"
import { useEffect, useRef, useState } from "react"
import { FabricArtboard } from "../features/editor/fabric-artboard"
import { waitForRenderViewDocumentFonts } from "../features/editor/render-conformance-readiness"

const componentJourneyDocument =
  buildComponentPublicationJourney().published.document

type MaskConformanceState = "visible" | "hidden-source"

export const Route = createFileRoute("/render-conformance")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    page: typeof search.page === "string" ? search.page : undefined,
    maskState:
      search.maskState === "hidden-source"
        ? "hidden-source"
        : ("visible" as MaskConformanceState),
    corpus:
      search.corpus === "resources" ||
      search.corpus === "components" ||
      search.corpus === "component-journey" ||
      search.corpus === "mask"
        ? search.corpus
        : "golden",
  }),
  component: RenderConformanceHarness,
})

function RenderConformanceHarness() {
  const { corpus, maskState, page: requestedPageId } = Route.useSearch()
  if (corpus === "mask") {
    return <MaskRenderConformanceHarness maskState={maskState} />
  }
  const document =
    corpus === "resources"
      ? textDesignSystemConformanceDocument
      : corpus === "components"
        ? componentRenderConformanceDocument
        : corpus === "component-journey"
          ? componentJourneyDocument
          : renderConformanceDocument
  const pages = requestedPageId
    ? document.pages.filter((page) => page.id === requestedPageId)
    : document.pages

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
          __html: JSON.stringify(document).replaceAll("<", "\\u003c"),
        }}
      />
      {pages.map((page) => (
        <RenderConformancePair
          key={page.id}
          document={document}
          pageId={page.id}
        />
      ))}
    </main>
  )
}

const maskConformanceNodesById = new Map(
  maskRenderConformanceNodes.map((node) => [node.id, node])
)
const hiddenSourceMaskConformanceNodesById = new Map(
  maskRenderConformanceHiddenSourceNodes.map((node) => [node.id, node])
)

const maskConformancePaintByState = {
  visible: {
    nodes: maskRenderConformanceNodes,
    nodesById: maskConformanceNodesById,
    plan: maskRenderConformancePlan,
  },
  "hidden-source": {
    nodes: maskRenderConformanceHiddenSourceNodes,
    nodesById: hiddenSourceMaskConformanceNodesById,
    plan: maskRenderConformanceHiddenSourcePlan,
  },
} satisfies Record<
  MaskConformanceState,
  {
    nodes: readonly (typeof maskRenderConformanceNodes)[number][]
    nodesById: ReadonlyMap<string, (typeof maskRenderConformanceNodes)[number]>
    plan: typeof maskRenderConformancePlan
  }
>

function MaskRenderConformanceHarness({
  maskState,
}: {
  maskState: MaskConformanceState
}) {
  const paint = maskConformancePaintByState[maskState]
  const [renderViewState, setRenderViewState] =
    useState<ConformanceState>("preparing")
  const [fabricState, setFabricState] = useState<ConformanceState>("preparing")

  useEffect(() => {
    let active = true
    void waitForPaintedFrame()
      .then(() => active && setRenderViewState("ready"))
      .catch(() => active && setRenderViewState("error"))
    return () => {
      active = false
    }
  }, [])

  return (
    <main
      data-render-conformance-harness="mask-m0"
      style={{
        display: "grid",
        gridTemplateColumns: "auto auto",
        gap: 24,
        minWidth: "max-content",
        padding: 48,
        background: "#d4d4d4",
      }}
    >
      <script
        data-conformance-document="v3"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(maskRenderConformanceDocument).replaceAll(
            "<",
            "\\u003c"
          ),
        }}
      />
      <div
        data-conformance-capture="render-view:mask-conformance-page"
        data-conformance-state={renderViewState}
        style={{
          width: maskRenderConformancePage.width,
          height: maskRenderConformancePage.height,
          overflow: "hidden",
        }}
      >
        <PagePaintPlanView
          background={maskRenderConformancePage.background}
          height={maskRenderConformancePage.height}
          nodesById={paint.nodesById}
          plan={paint.plan}
          width={maskRenderConformancePage.width}
        />
      </div>
      <MaskFabricCapture
        nodesById={paint.nodesById}
        onStateChange={setFabricState}
        plan={paint.plan}
        state={fabricState}
      />
    </main>
  )
}

function MaskFabricCapture({
  nodesById,
  plan,
  state,
  onStateChange,
}: {
  nodesById: ReadonlyMap<string, (typeof maskRenderConformanceNodes)[number]>
  plan: typeof maskRenderConformancePlan
  state: ConformanceState
  onStateChange: (state: ConformanceState) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    let active = true
    const canvas = new FabricCanvas(element, {
      width: maskRenderConformancePage.width,
      height: maskRenderConformancePage.height,
      backgroundColor: maskRenderConformancePage.background,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
      selection: false,
    })
    try {
      for (const entry of plan.entries) {
        if (entry.kind === "node") {
          const node = nodesById.get(entry.nodeId)
          if (!node) {
            throw new Error(`Unsupported mask conformance node ${entry.nodeId}`)
          }
          canvas.add(createFabricSyncObject(node))
          continue
        }
        const result = createFabricVectorMaskPaint(entry, nodesById, (node) => {
          if (node.type === "image") {
            throw new Error("The M0 retained mask fixture has no image content")
          }
          return createFabricSyncObject(node)
        })
        if (result.kind === "composite") canvas.add(result.object)
        else result.objects.forEach((object) => canvas.add(object))
      }
      canvas.renderAll()
      void waitForPaintedFrame()
        .then(() => active && onStateChange("ready"))
        .catch(() => active && onStateChange("error"))
    } catch {
      onStateChange("error")
    }
    return () => {
      active = false
      void canvas.dispose()
    }
  }, [nodesById, onStateChange, plan])

  return (
    <div
      data-conformance-capture="fabric:mask-conformance-page"
      data-conformance-state={state}
      style={{
        width: maskRenderConformancePage.width,
        height: maskRenderConformancePage.height,
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} data-fabric-mask-conformance="true" />
    </div>
  )
}

function RenderConformancePair({
  document,
  pageId,
}: {
  document: Document
  pageId: string
}) {
  const page = document.pages.find((candidate) => candidate.id === pageId)!
  const renderViewRef = useRef<HTMLDivElement>(null)
  const [renderViewState, setRenderViewState] =
    useState<ConformanceState>("preparing")
  const [fabricState, setFabricState] = useState<ConformanceState>("preparing")

  useEffect(() => {
    const element = renderViewRef.current
    if (!element) return
    let active = true
    void waitForRenderViewCapture(element, document, pageId)
      .then(() => active && setRenderViewState("ready"))
      .catch(() => active && setRenderViewState("error"))
    return () => {
      active = false
    }
  }, [document, pageId])

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
          document={document}
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
          document={document}
          interactive={false}
          pageId={page.id}
          selection={null}
          zoom={1}
          onNodesChange={() => false}
          onRuntimeStateChange={(state) => {
            if (state.status !== "ready") {
              setFabricState(state.status)
              return
            }
            void waitForPaintedFrame()
              .then(() => setFabricState("ready"))
              .catch(() => setFabricState("error"))
          }}
          onSelectionChange={() => undefined}
        />
      </div>
    </section>
  )
}

type ConformanceState = "preparing" | "ready" | "error"

function waitForPaintedFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

async function waitForRenderViewCapture(
  element: HTMLElement,
  canonicalDocument: Document,
  pageId: string
) {
  await waitForRenderViewDocumentFonts(
    canonicalDocument,
    pageId,
    document.fonts
  )
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
