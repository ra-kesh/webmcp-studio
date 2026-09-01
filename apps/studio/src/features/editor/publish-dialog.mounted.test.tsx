// @vitest-environment jsdom

import { webcrypto } from "node:crypto"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { quotationStarter } from "./quotation-starter"
import { IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON } from "./image-replacement-output-admission"
import { PublishDialog } from "./publish-dialog"

describe("PublishDialog output admission", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

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

  const renderDialog = async (outputDisabledReason: string | null) => {
    await act(async () => {
      root.render(
        <PublishDialog
          open
          onOpenChange={vi.fn()}
          document={quotationStarter.document}
          documentSnapshotId="snapshot-publish-admission"
          templateId="template-publish-admission"
          pendingChangeSet={false}
          outputDisabledReason={outputDisabledReason}
          publishError={null}
          publishSyncStatus="idle"
          onPublish={vi.fn()}
          onCancelPublish={vi.fn(() => false)}
        />
      )
    })
  }

  const findPublishButton = () => {
    const button = [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent.includes("Publish version")
    )
    if (!button) throw new Error("Publish button was not rendered.")
    return button
  }

  it("keeps an already-open publish surface disabled until replacement settles", async () => {
    await renderDialog(IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON)

    expect(document.body.textContent).toContain(
      IMAGE_REPLACEMENT_OUTPUT_DISABLED_REASON
    )
    const publishButton = findPublishButton()
    expect(publishButton).toBeInstanceOf(HTMLButtonElement)
    expect(publishButton.disabled).toBe(true)

    await renderDialog(null)
    const recoveredButton = findPublishButton()
    expect(recoveredButton).toBeInstanceOf(HTMLButtonElement)
    expect(recoveredButton.disabled).toBe(false)
  })
})
