// @vitest-environment jsdom

import { act, Suspense } from "react"
import type { ComponentType } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { Document } from "@webmcp/document"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  Selection,
} from "@webmcp/editor"

import { FabricArtboard } from "./fabric-artboard"
import type { FabricArtboardRuntimeOptions } from "./fabric-artboard"
import { createLazyEditorInteraction } from "./lazy-editor-interaction"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void
  const promise = new Promise<TValue>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

const resolvedImage = renderConformanceDocument.nodes.find(
  (node) => node.id === "image-cover" && node.type === "image"
)
if (!resolvedImage || resolvedImage.type !== "image") {
  throw new Error("Expected the conformance image fixture")
}
const image = resolvedImage
const resolvedPage = renderConformanceDocument.pages.find((candidate) =>
  candidate.nodeIds.includes(image.id)
)
if (!resolvedPage) throw new Error("Expected the conformance image page")
const page = resolvedPage
const resolvedText = renderConformanceDocument.nodes.find(
  (node) => node.type === "text" && page.nodeIds.includes(node.id)
)
if (!resolvedText || resolvedText.type !== "text") {
  throw new Error("Expected a conformance text fixture on the image page")
}
const text = resolvedText

const fixtureDocument: Document = {
  ...renderConformanceDocument,
  pages: [{ ...page, nodeIds: [image.id, text.id] }],
  nodes: [image, text],
  groups: [],
}

const adapterModule = (adapter: CanvasAdapter) => {
  function FabricCanvasAdapter(_events: CanvasAdapterEvents) {
    return adapter
  }
  return {
    FabricCanvasAdapter: FabricCanvasAdapter as unknown as new (
      events: CanvasAdapterEvents
    ) => CanvasAdapter,
  }
}

const fakeAdapter = (sceneMarker: HTMLElement): CanvasAdapter => ({
  mount: vi.fn((canvas) => {
    canvas.parentElement?.appendChild(sceneMarker)
  }),
  unmount: vi.fn(async () => {
    sceneMarker.remove()
  }),
  requestRender: vi.fn(),
  setMutationAdmission: vi.fn(),
  sync: vi.fn(async () => undefined),
  setViewportZoom: vi.fn(),
  previewNodePatch: vi.fn(() => false),
  restoreNodePreview: vi.fn(() => false),
  setSnapTargets: vi.fn(),
  select: vi.fn(),
  getSelection: vi.fn(() => null),
  enterTextEditing: vi.fn(() => true),
  commitTextEditing: vi.fn(() => false),
  cancelTextEditing: vi.fn(() => false),
  applyTextEditingStyle: vi.fn(() => false),
  applyTextEditingParagraphStyle: vi.fn(() => false),
  cancelTransform: vi.fn(() => false),
  setImageCropMode: vi.fn(() => false),
  previewImageCropDraft: vi.fn(() => false),
  nudgeImageCrop: vi.fn(() => false),
  getImageNaturalSize: vi.fn(() => null),
  getImageSourceReadiness: vi.fn(() => null),
  retryImageSource: vi.fn(async () => null),
  exportPng: vi.fn(() => null),
})

type Trigger = "image-selection" | "direct-text-edit"
type InteractionProps = Readonly<{ label: string }>

function TestEditor({
  active,
  Interaction,
  loadAdapter,
  trigger,
}: {
  active: boolean
  Interaction: ComponentType<InteractionProps>
  loadAdapter: NonNullable<FabricArtboardRuntimeOptions["loadAdapter"]>
  trigger: Trigger
}) {
  const node = trigger === "image-selection" ? image : text
  const selection: Selection | null = active
    ? { pageId: page.id, nodeIds: [node.id] }
    : null

  return (
    <Suspense
      fallback={<p data-route-fallback="true">Preparing the editor…</p>}
    >
      <FabricArtboard
        document={fixtureDocument}
        documentSyncIdentity="fixture-document-v1"
        pageId={page.id}
        selection={selection}
        textEditingNodeId={
          active && trigger === "direct-text-edit" ? text.id : null
        }
        zoom={1}
        onNodesChange={() => false}
        onSelectionChange={() => undefined}
        runtimeOptions={{ loadAdapter }}
      />
      {active ? (
        <Interaction
          label={
            trigger === "image-selection" ? "Image actions" : "Text formatting"
          }
        />
      ) : null}
      <aside data-inspector="true">
        {active
          ? `${node.name} · x ${node.x} · y ${node.y} · w ${node.width} · h ${node.height}`
          : "Nothing selected"}
      </aside>
    </Suspense>
  )
}

describe("lazy editor interaction ownership", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it.each<Trigger>(["image-selection", "direct-text-edit"])(
    "keeps renderer pixels and lifecycle mounted while %s chrome loads",
    async (trigger) => {
      const interactionModule = deferred<{
        default: ComponentType<InteractionProps>
      }>()
      const Interaction = createLazyEditorInteraction(
        () => interactionModule.promise
      )
      const sceneMarker = document.createElement("div")
      sceneMarker.dataset.fabricScene = "painted"
      const adapter = fakeAdapter(sceneMarker)
      const loadAdapter = vi.fn(async () => adapterModule(adapter))

      await act(async () => {
        root.render(
          <TestEditor
            active={false}
            Interaction={Interaction}
            loadAdapter={loadAdapter}
            trigger={trigger}
          />
        )
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(adapter.sync).toHaveBeenCalledOnce()
        expect(sceneMarker.isConnected).toBe(true)
      })

      await act(async () => {
        root.render(
          <TestEditor
            active
            Interaction={Interaction}
            loadAdapter={loadAdapter}
            trigger={trigger}
          />
        )
        await Promise.resolve()
      })

      const selectedNode = trigger === "image-selection" ? image : text
      const selection = { pageId: page.id, nodeIds: [selectedNode.id] }
      expect(host.querySelector("[data-route-fallback]")).toBeNull()
      expect(host.querySelector("[data-fabric-scene='painted']")).toBe(
        sceneMarker
      )
      expect(
        host.querySelector("[data-node-outline='selection']")
      ).not.toBeNull()
      expect(host.querySelector("[data-inspector]")?.textContent).toContain(
        selectedNode.name
      )
      expect(adapter.mount).toHaveBeenCalledOnce()
      expect(adapter.unmount).not.toHaveBeenCalled()
      expect(adapter.sync).toHaveBeenCalledOnce()
      expect(adapter.select).toHaveBeenLastCalledWith(selection)
      if (trigger === "direct-text-edit") {
        await vi.waitFor(() =>
          expect(adapter.enterTextEditing).toHaveBeenCalledWith(
            text.id,
            undefined
          )
        )
      }

      await act(async () => {
        interactionModule.resolve({
          default: ({ label }) => (
            <div data-editor-interaction="ready">{label}</div>
          ),
        })
        await interactionModule.promise
        await Promise.resolve()
      })

      expect(host.querySelector("[data-route-fallback]")).toBeNull()
      expect(host.querySelector("[data-editor-interaction]")?.textContent).toBe(
        trigger === "image-selection" ? "Image actions" : "Text formatting"
      )
      expect(sceneMarker.isConnected).toBe(true)
      expect(adapter.mount).toHaveBeenCalledOnce()
      expect(adapter.unmount).not.toHaveBeenCalled()
      expect(adapter.sync).toHaveBeenCalledOnce()
    }
  )
})
