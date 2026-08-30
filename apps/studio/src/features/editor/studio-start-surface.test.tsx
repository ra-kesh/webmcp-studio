// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { StudioStartSurface } from "./studio-start-surface"
import type { StudioStartSurfaceProps } from "./studio-start-surface"
import { projectStudioStartModel } from "./studio-start-model"
import type { CurrentDraftEnvelope } from "./current-draft-repository"

vi.mock("./recent-documents", () => ({
  RecentDocuments: ({
    initialFocusRequested,
    onOpen,
  }: {
    initialFocusRequested?: boolean
    onOpen: (documentId: string) => boolean | Promise<boolean>
  }) => (
    <section
      aria-label="Studio document library"
      data-initial-focus={initialFocusRequested || undefined}
    >
      <button type="button" onClick={() => void onOpen("recent-document-id")}>
        Open recent document
      </button>
    </section>
  ),
}))

vi.mock("../../content/library/library-template-browser", () => ({
  LibraryTemplateBrowser: ({
    actionsEnabled,
    actionError,
    onCreate,
  }: {
    actionsEnabled?: boolean
    actionError?: string | null
    onCreate: (intent: {
      itemKind: "template"
      id: string
      version: number
    }) => void
  }) => (
    <section aria-label="Shared template browser">
      <h2>Start from a template</h2>
      {actionError ? <p>{actionError}</p> : null}
      <button
        disabled={!actionsEnabled}
        type="button"
        onClick={() =>
          onCreate({
            itemKind: "template",
            id: "editorial-one-pager",
            version: 1,
          })
        }
      >
        Create from template
      </button>
    </section>
  ),
}))

const emptyModel = projectStudioStartModel({ status: "empty" })

if (emptyModel.status !== "ready") {
  throw new Error("An empty draft repository must project a ready start model.")
}

const defaultProps: StudioStartSurfaceProps = {
  model: emptyModel,
  hasQuotationSource: false,
  onCreateBlank: vi.fn(),
  onCreateFromTemplate: vi.fn(),
  onImportFile: vi.fn(() => true),
  onOpenDocument: vi.fn(() => true),
  onOpenSample: vi.fn(),
}

const renderSurface = (overrides: Partial<StudioStartSurfaceProps> = {}) =>
  renderToStaticMarkup(<StudioStartSurface {...defaultProps} {...overrides} />)

const currentModel = () => {
  const document = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  const envelope: CurrentDraftEnvelope = {
    schemaVersion: 1,
    document,
    sourceContext: {
      quotationSource: null,
      quotationTemplateId: "editorial-olive",
      designTemplate: { id: "editorial-one-pager", version: 1 },
    },
  }
  const model = projectStudioStartModel({
    status: "current",
    envelope,
    source: "envelope",
    migrated: false,
    warnings: [],
  })
  if (model.status !== "ready") {
    throw new Error("A valid current draft must project a ready start model.")
  }
  return model
}

function buttonNamed(name: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.includes(name)
  )
}

describe("StudioStartSurface", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("shows explicit first-run choices and teaches the canonical product model", () => {
    const html = renderSurface()

    expect(html).toContain("What are you making?")
    expect(html).toContain("How Studio files work")
    expect(html).toContain("Document")
    expect(html).toContain("Outputs")
    expect(html).toContain("Pages")
    expect(html).toContain("Start from a template")
    expect(html).toContain("Blank document")
    expect(html).toContain("Import Studio JSON")
    expect(html).toContain("Northstar sample proposal")
    expect(html).toContain("Open sample")
    expect(html).not.toContain("Current browser draft")
    expect(html).toContain("Studio document library")
    expect(html).not.toContain("Apply to this design")
  })

  it("renders the retained document library instead of the obsolete one-card adapter", () => {
    const html = renderSurface({ model: currentModel() })

    expect(html).toContain("Studio document library")
    expect(html).toContain("Open recent document")
    expect(html).not.toContain("Current browser draft")
    expect(html).not.toContain('aria-labelledby="current-draft-heading"')
  })

  it("opens an exact library document and dispatches the selected template", async () => {
    const onOpenDocument = vi.fn(() => true)
    const onCreateFromTemplate = vi.fn()
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          hasQuotationSource
          model={currentModel()}
          onOpenDocument={onOpenDocument}
          onCreateFromTemplate={onCreateFromTemplate}
        />
      )
    })

    expect(document.activeElement).toBe(
      document.body.querySelector("#studio-start-heading")
    )

    await act(async () => buttonNamed("Open recent document")?.click())
    expect(onOpenDocument).toHaveBeenCalledWith("recent-document-id")

    await act(async () => buttonNamed("Create from template")?.click())
    expect(onCreateFromTemplate).toHaveBeenCalledWith({
      itemKind: "template",
      id: "editorial-one-pager",
      version: 1,
    })
  })

  it("delegates return focus to the retained document library", async () => {
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          initialFocus="document-library"
          model={currentModel()}
        />
      )
    })

    expect(
      document.body
        .querySelector('[aria-label="Studio document library"]')
        ?.getAttribute("data-initial-focus")
    ).toBe("true")
  })

  it("keeps a routed document notice visible until its owner dismisses it", async () => {
    const onDismissActionError = vi.fn()
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          actionError="The document “document-a” could not be found."
          model={currentModel()}
          onDismissActionError={onDismissActionError}
        />
      )
    })

    expect(document.body.textContent).toContain(
      "The document “document-a” could not be found."
    )
    await act(async () => buttonNamed("Dismiss")?.click())
    expect(onDismissActionError).toHaveBeenCalledTimes(1)
  })

  it("requires explicit session-only acknowledgement when browser saving fails", async () => {
    const onCreateBlank = vi.fn()
    const unavailableModel = {
      ...emptyModel,
      durable: false,
      storageWarning: "Browser storage is full.",
    }
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          model={unavailableModel}
          onCreateBlank={onCreateBlank}
        />
      )
    })

    const blank = buttonNamed("Blank document")
    expect(document.body.textContent).toContain("Browser saving is unavailable")
    expect(document.body.textContent).toContain("Browser storage is full.")
    expect(blank?.disabled).toBe(true)

    await act(async () => buttonNamed("Use this session")?.click())
    expect(blank?.disabled).toBe(false)
    await act(async () => {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve())
      )
    })
    expect(document.activeElement).toBe(blank)
    await act(async () => blank?.click())
    expect(onCreateBlank).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Session-only mode")
  })

  it("resets the import input, restores focus, and permits the same file again", async () => {
    const onImportFile = vi.fn(async () => true)
    await act(async () => {
      root.render(
        <StudioStartSurface {...defaultProps} onImportFile={onImportFile} />
      )
    })

    const input =
      document.body.querySelector<HTMLInputElement>('input[type="file"]')
    const importButton = buttonNamed("Import Studio JSON")
    if (!input || !importButton) throw new Error("Expected the import controls")
    const file = new File(["{}"], "document.json", {
      type: "application/json",
    })

    for (let index = 0; index < 2; index += 1) {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      })
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }))
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      })
      expect(input.value).toBe("")
      expect(document.activeElement).toBe(importButton)
    }

    expect(onImportFile).toHaveBeenCalledTimes(2)
    expect(onImportFile).toHaveBeenNthCalledWith(1, file)
    expect(onImportFile).toHaveBeenNthCalledWith(2, file)
  })

  it("locks every competing start action while an import is settling", async () => {
    let resolveImport: ((accepted: boolean) => void) | undefined
    const importResult = new Promise<boolean>((resolve) => {
      resolveImport = resolve
    })
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          onImportFile={() => importResult}
        />
      )
    })
    const input =
      document.body.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Expected the import input")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["{}"], "document.json")],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
    })

    expect(buttonNamed("Blank document")?.disabled).toBe(true)
    expect(buttonNamed("Create from template")?.disabled).toBe(true)
    expect(buttonNamed("Open sample")?.disabled).toBe(true)

    await act(async () => resolveImport?.(true))
    expect(buttonNamed("Blank document")?.disabled).toBe(false)
  })

  it("keeps import and controller failures in persistent alert regions", async () => {
    await act(async () => {
      root.render(
        <StudioStartSurface
          {...defaultProps}
          actionError="The current draft could not be flushed."
          onImportFile={async () => {
            throw new Error("The selected file is malformed.")
          }}
        />
      )
    })
    expect(document.body.textContent).toContain(
      "The current draft could not be flushed."
    )

    const input =
      document.body.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Expected the import input")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["{"], "broken.json")],
    })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(document.body.textContent).toContain(
      "The selected file is malformed."
    )
    expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(2)
  })
})
