import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"
const recoveryStorageKey = "webmcp-studio:draft-recovery:v1"

async function readDraft(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), documentStorageKey)
}

async function seedUnreadableDraft(
  page: Page,
  makeRaw: (validRaw: string) => string
) {
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect.poll(() => readDraft(page)).not.toBeNull()
  const validRaw = await readDraft(page)
  if (!validRaw) throw new Error("Studio did not create its local draft")
  const raw = makeRaw(validRaw)
  await page.evaluate(
    ({ documentKey, recoveryKey, value }) => {
      localStorage.setItem(documentKey, value)
      localStorage.removeItem(recoveryKey)
    },
    {
      documentKey: documentStorageKey,
      recoveryKey: recoveryStorageKey,
      value: raw,
    }
  )
  await page.reload()
  return raw
}

async function expectQuarantinedBytes(
  page: Page,
  raw: string,
  expectedKind: "malformed_json" | "schema_invalid" | "aggregate_invalid"
) {
  const dialog = page.getByRole("dialog", { name: "Draft recovery required" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(
    "Studio will not save the starter or any edits over them"
  )

  await page.waitForTimeout(750)

  const stored = await page.evaluate(
    ({ documentKey, recoveryKey }) => ({
      draft: localStorage.getItem(documentKey),
      recovery: localStorage.getItem(recoveryKey),
    }),
    { documentKey: documentStorageKey, recoveryKey: recoveryStorageKey }
  )
  expect(stored.draft).toBe(raw)
  expect(stored.recovery).not.toBeNull()
  expect(JSON.parse(stored.recovery ?? "null")).toMatchObject({
    schemaVersion: 1,
    sourceStorageKey: documentStorageKey,
    failure: { kind: expectedKind },
    raw,
  })
}

test("malformed draft bytes survive debounce, download, failed retry, and reload", async ({
  page,
}) => {
  const raw = await seedUnreadableDraft(
    page,
    () => '{\n  "schemaVersion": 1,\n  "unfinished": true'
  )
  await expectQuarantinedBytes(page, raw, "malformed_json")

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download original" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^webmcp-studio-unreadable-draft-.+\.json$/
  )

  await page.getByRole("button", { name: "Try recovery again" }).click()
  await expect(
    page
      .getByRole("dialog", { name: "Draft recovery required" })
      .getByRole("status")
  ).toContainText("Nothing was changed")
  await expect(
    page.getByRole("dialog", { name: "Draft recovery required" })
  ).toBeVisible()
  expect(await readDraft(page)).toBe(raw)

  await page.reload()
  await expectQuarantinedBytes(page, raw, "malformed_json")
})

test("schema-invalid draft stays quarantined in compact layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 820 })
  const raw = await seedUnreadableDraft(page, () =>
    JSON.stringify({ schemaVersion: 1, id: "partial-document" })
  )
  await expectQuarantinedBytes(page, raw, "schema_invalid")

  const dialog = page.getByRole("dialog", { name: "Draft recovery required" })
  await expect(dialog).toContainText("Incompatible draft schema")
  await expect(
    dialog.getByRole("button", { name: "Download original" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Try recovery again" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Reset to starter" })
  ).toBeVisible()
})

test("relationship-invalid draft is replaced only after explicit reset", async ({
  page,
}) => {
  const raw = await seedUnreadableDraft(page, (validRaw) => {
    const document = JSON.parse(validRaw) as {
      nodes: Array<Record<string, unknown> & { id: string }>
    }
    document.nodes.push({
      ...document.nodes[0],
      id: "orphan-local-draft-node",
    })
    return JSON.stringify(document)
  })
  await expectQuarantinedBytes(page, raw, "aggregate_invalid")

  await page.getByRole("button", { name: "Reset to starter" }).click()
  await expect(
    page.getByRole("dialog", { name: "Draft recovery required" })
  ).toBeHidden()
  await page.waitForTimeout(750)

  const stored = await page.evaluate(
    ({ documentKey, recoveryKey }) => ({
      draft: localStorage.getItem(documentKey),
      recovery: localStorage.getItem(recoveryKey),
    }),
    { documentKey: documentStorageKey, recoveryKey: recoveryStorageKey }
  )
  expect(stored.recovery).toBeNull()
  expect(stored.draft).not.toBe(raw)
  const resetDocument = JSON.parse(stored.draft ?? "null") as {
    outputs: Array<{ pageIds: string[] }>
  }
  expect(resetDocument.outputs[0]?.pageIds).toHaveLength(6)
})

test("valid custom grouping survives reload byte-for-byte", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect.poll(() => readDraft(page)).not.toBeNull()
  const initialRaw = await readDraft(page)
  if (!initialRaw) throw new Error("Studio did not create its local draft")
  const document = JSON.parse(initialRaw) as {
    groups: Array<{
      id: string
      name: string
      parentGroupId?: string
    }>
  }
  const firstGroup = document.groups.at(0)
  if (!firstGroup) throw new Error("The starter has no semantic groups")
  const originalId = firstGroup.id
  firstGroup.id = "custom-coincidental-group"
  firstGroup.name = "My deliberately preserved group"
  for (const group of document.groups) {
    if (group.parentGroupId === originalId) {
      group.parentGroupId = firstGroup.id
    }
  }
  const customRaw = JSON.stringify(document)

  await page.evaluate(
    ({ documentKey, recoveryKey, value }) => {
      localStorage.setItem(documentKey, value)
      localStorage.removeItem(recoveryKey)
    },
    {
      documentKey: documentStorageKey,
      recoveryKey: recoveryStorageKey,
      value: customRaw,
    }
  )
  await page.reload()
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Draft recovery required" })
  ).toBeHidden()
  await page.waitForTimeout(750)

  expect(await readDraft(page)).toBe(customRaw)
})
