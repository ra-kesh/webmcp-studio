// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewDocumentDialog } from "./new-document-dialog"
import type { StarterDocumentMetadata } from "./quotation-starter"

const starterMetadata: StarterDocumentMetadata = {
  id: "starter",
  name: "Northstar sample",
  pageCount: 6,
  outputCount: 1,
  outputs: [
    {
      id: "proposal",
      name: "Proposal",
      kind: "proposal",
      pageCount: 6,
      exportFormats: ["pdf", "png"],
    },
  ],
  fieldCount: 4,
  bindingCount: 4,
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function buttonNamed(name: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.includes(name)
  )
}

describe("NewDocumentDialog", () => {
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

  it("creates the edited preset through the canonical blank-document callback", async () => {
    const onCreateBlank = vi.fn(() => true)
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={onCreateBlank}
          onOpenChange={onOpenChange}
          onRestoreDemo={() => true}
          starterMetadata={starterMetadata}
        />
      )
    })

    await act(async () => buttonNamed("Square social")?.click())
    const name =
      document.body.querySelector<HTMLInputElement>("#new-document-name")
    if (!name) throw new Error("Expected the document-name input")
    await act(async () => setInputValue(name, " Campaign tile "))
    await act(async () => buttonNamed("Create document")?.click())

    expect(onCreateBlank).toHaveBeenCalledWith({
      name: "Campaign tile",
      width: 1080,
      height: 1080,
      kind: "square",
      exportFormats: ["png", "pdf"],
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps invalid dimensions in the dialog and explains the field error", async () => {
    const onCreateBlank = vi.fn(() => true)
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={onCreateBlank}
          onOpenChange={onOpenChange}
          onRestoreDemo={() => true}
          starterMetadata={starterMetadata}
        />
      )
    })

    const width = document.body.querySelector<HTMLInputElement>(
      "#new-document-width"
    )
    if (!width) throw new Error("Expected the document-width input")
    await act(async () => setInputValue(width, "10.5"))
    await act(async () => buttonNamed("Create document")?.click())

    expect(onCreateBlank).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      "Width must be a whole number of pixels."
    )
    expect(width.getAttribute("aria-invalid")).toBe("true")
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
    })
    expect(document.activeElement).toBe(width)
  })

  it("does not close when a guarded create or sample restore is rejected", async () => {
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={() => false}
          onOpenChange={onOpenChange}
          onRestoreDemo={async () => false}
          starterMetadata={starterMetadata}
        />
      )
    })

    await act(async () => buttonNamed("Create document")?.click())
    expect(document.body.textContent).toContain(
      "The document cannot be created while editing is unavailable."
    )
    await act(async () => buttonNamed("Open sample")?.click())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      "The sample cannot be opened while editing is unavailable."
    )
  })

  it("submits on form submit and preserves the selected preset after renaming", async () => {
    const onCreateBlank = vi.fn(() => true)
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={onCreateBlank}
          onOpenChange={vi.fn()}
          onRestoreDemo={() => true}
          starterMetadata={starterMetadata}
        />
      )
    })
    const portrait = buttonNamed("Portrait document")
    const name =
      document.body.querySelector<HTMLInputElement>("#new-document-name")
    const form = document.body.querySelector<HTMLFormElement>("form")
    if (!name || !form) throw new Error("Expected the creation form")
    expect(form.getAttribute("aria-label")).toBe("New document settings")
    expect(name.name).toBe("documentName")
    await act(async () => setInputValue(name, "Named portrait"))
    expect(portrait?.getAttribute("aria-pressed")).toBe("true")
    await act(async () => buttonNamed("Social story")?.click())
    expect(name.value).toBe("Named portrait")
    expect(buttonNamed("Social story")?.getAttribute("aria-pressed")).toBe(
      "true"
    )
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    })
    expect(onCreateBlank).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Named portrait",
        width: 1080,
        height: 1920,
        kind: "custom",
      })
    )
  })

  it("shows an inline failure when sample restoration rejects", async () => {
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={() => true}
          onOpenChange={vi.fn()}
          onRestoreDemo={async () => {
            throw new Error("Sample service is unavailable.")
          }}
          starterMetadata={starterMetadata}
        />
      )
    })
    await act(async () => buttonNamed("Open sample")?.click())
    expect(document.body.textContent).toContain(
      "Sample service is unavailable."
    )
  })

  it("cancels without creating or restoring a document", async () => {
    const onCreateBlank = vi.fn(() => true)
    const onRestoreDemo = vi.fn(() => true)
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={onCreateBlank}
          onOpenChange={onOpenChange}
          onRestoreDemo={onRestoreDemo}
          starterMetadata={starterMetadata}
        />
      )
    })
    await act(async () => buttonNamed("Cancel")?.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreateBlank).not.toHaveBeenCalled()
    expect(onRestoreDemo).not.toHaveBeenCalled()
  })

  it("blocks competing blank creation while sample restoration is pending", async () => {
    let resolveRestore: ((result: boolean) => void) | undefined
    const restore = new Promise<boolean>((resolve) => {
      resolveRestore = resolve
    })
    const onCreateBlank = vi.fn(() => true)
    await act(async () => {
      root.render(
        <NewDocumentDialog
          open
          onCreateBlank={onCreateBlank}
          onOpenChange={vi.fn()}
          onRestoreDemo={() => restore}
          starterMetadata={starterMetadata}
        />
      )
    })
    await act(async () => buttonNamed("Open sample")?.click())
    const create = buttonNamed("Create document")
    const name =
      document.body.querySelector<HTMLInputElement>("#new-document-name")
    expect(create?.disabled).toBe(true)
    expect(name?.disabled).toBe(true)
    await act(async () => create?.click())
    expect(onCreateBlank).not.toHaveBeenCalled()
    await act(async () => resolveRestore?.(true))
  })
})
