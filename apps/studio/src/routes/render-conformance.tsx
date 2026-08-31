import { createFileRoute } from "@tanstack/react-router"
import {
  buildComponentPublicationJourney,
  componentRenderConformanceDocument,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  type Document,
} from "@webmcp/document"
import {
  alphaImageMaskRenderConformanceDocument,
  alphaImageMaskRenderConformanceHiddenSourceDocument,
  alphaTextMaskRenderConformanceDocument,
  luminanceAllHiddenRenderConformanceDocument,
  luminanceImageTextRenderConformanceDocument,
  luminanceOneHiddenRenderConformanceDocument,
  luminanceOverlapRenderConformanceDocument,
  luminancePrimaryCoefficientRenderConformanceDocument,
  luminanceSecondaryCoefficientRenderConformanceDocument,
  maskRenderConformanceDocument,
  maskRenderConformanceHiddenSourceNodes,
  maskRenderConformancePage,
  multiAlphaMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceAllHiddenDocument,
  multiVectorMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceOneHiddenDocument,
  nestedAlphaLuminanceAllHiddenRenderConformanceDocument,
  nestedLuminanceVectorOneHiddenRenderConformanceDocument,
  nestedVectorAlphaRenderConformanceDocument,
} from "@webmcp/document/internal/mask-render-conformance"
import { Artboard } from "@webmcp/render-view"
import { useEffect, useRef, useState } from "react"
import { FabricArtboard } from "../features/editor/fabric-artboard"
import { waitForRenderViewDocumentFonts } from "../features/editor/render-conformance-readiness"

const componentJourneyDocument =
  buildComponentPublicationJourney().published.document

type MaskConformanceState =
  | "visible"
  | "hidden-source"
  | "alpha-image"
  | "alpha-image-hidden"
  | "alpha-text"
  | "multi-vector"
  | "multi-vector-one-hidden"
  | "multi-vector-all-hidden"
  | "multi-alpha"
  | "luminance-primary"
  | "luminance-secondary"
  | "luminance-overlap"
  | "luminance-image-text"
  | "luminance-one-hidden"
  | "luminance-all-hidden"
  | "nested-vector-alpha"
  | "nested-luminance-vector-one-hidden"
  | "nested-alpha-luminance-all-hidden"

export const Route = createFileRoute("/render-conformance")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    page: typeof search.page === "string" ? search.page : undefined,
    maskState: (
      [
        "visible",
        "hidden-source",
        "alpha-image",
        "alpha-image-hidden",
        "alpha-text",
        "multi-vector",
        "multi-vector-one-hidden",
        "multi-vector-all-hidden",
        "multi-alpha",
        "luminance-primary",
        "luminance-secondary",
        "luminance-overlap",
        "luminance-image-text",
        "luminance-one-hidden",
        "luminance-all-hidden",
        "nested-vector-alpha",
        "nested-luminance-vector-one-hidden",
        "nested-alpha-luminance-all-hidden",
      ] as const
    ).includes(search.maskState as MaskConformanceState)
      ? (search.maskState as MaskConformanceState)
      : "visible",
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

const hiddenSourceMaskConformanceDocument: Document = {
  ...maskRenderConformanceDocument,
  nodes: maskRenderConformanceHiddenSourceNodes,
}

const maskConformanceDocuments: Readonly<
  Record<MaskConformanceState, Document>
> = {
  visible: maskRenderConformanceDocument,
  "hidden-source": hiddenSourceMaskConformanceDocument,
  "alpha-image": alphaImageMaskRenderConformanceDocument,
  "alpha-image-hidden": alphaImageMaskRenderConformanceHiddenSourceDocument,
  "alpha-text": alphaTextMaskRenderConformanceDocument,
  "multi-vector": multiVectorMaskRenderConformanceDocument,
  "multi-vector-one-hidden": multiVectorMaskRenderConformanceOneHiddenDocument,
  "multi-vector-all-hidden": multiVectorMaskRenderConformanceAllHiddenDocument,
  "multi-alpha": multiAlphaMaskRenderConformanceDocument,
  "luminance-primary": luminancePrimaryCoefficientRenderConformanceDocument,
  "luminance-secondary": luminanceSecondaryCoefficientRenderConformanceDocument,
  "luminance-overlap": luminanceOverlapRenderConformanceDocument,
  "luminance-image-text": luminanceImageTextRenderConformanceDocument,
  "luminance-one-hidden": luminanceOneHiddenRenderConformanceDocument,
  "luminance-all-hidden": luminanceAllHiddenRenderConformanceDocument,
  "nested-vector-alpha": nestedVectorAlphaRenderConformanceDocument,
  "nested-luminance-vector-one-hidden":
    nestedLuminanceVectorOneHiddenRenderConformanceDocument,
  "nested-alpha-luminance-all-hidden":
    nestedAlphaLuminanceAllHiddenRenderConformanceDocument,
}

function MaskRenderConformanceHarness({
  maskState,
}: {
  maskState: MaskConformanceState
}) {
  const document = maskConformanceDocuments[maskState]

  return (
    <main
      data-render-conformance-harness="mask-m4c-production"
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
          __html: JSON.stringify(document).replaceAll("<", "\\u003c"),
        }}
      />
      <RenderConformancePair
        document={document}
        pageId={maskRenderConformancePage.id}
      />
    </main>
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
