import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const documentStorageKey = "webmcp-studio:northstar-document:v2"

type StoredDocument = {
  id: string
  revision: number
  nodes: Array<Record<string, unknown> & { id: string; name: string }>
  [key: string]: unknown
}

async function readStoredDocument(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (key) => Boolean(localStorage.getItem(key)),
        documentStorageKey
      )
    )
    .toBe(true)
  return page.evaluate((key) => {
    const value = localStorage.getItem(key)
    if (!value) throw new Error("Stored document fixture is unavailable")
    return JSON.parse(value) as StoredDocument
  }, documentStorageKey)
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()
})

test("aggregate-invalid imports report the relationship and preserve current work", async ({
  page,
}) => {
  const document = await readStoredDocument(page)
  document.nodes.push({
    ...document.nodes[0],
    id: "orphan-import-node",
    name: "Orphan import node",
  })

  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "invalid-relationships.studio.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(document)),
    })

  await page.getByRole("button", { name: "More studio actions" }).click()
  await expect(page.getByRole("menu")).toContainText("Orphan import node")
  await page.keyboard.press("Escape")
  await expect(page.getByText("Cover", { exact: true }).first()).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Quotation pages" }).getByRole("button", {
      name: /^Open page/,
    })
  ).toHaveCount(6)
})

test("invalid publish requests never create an immutable template version", async ({
  page,
}) => {
  const beforeResponse = await page.request.get("/v1/studio/templates/")
  expect(beforeResponse.ok()).toBe(true)
  const before = (await beforeResponse.json()) as { data: unknown[] }

  const document = await readStoredDocument(page)
  document.nodes.push({
    ...document.nodes[0],
    id: "orphan-publish-node",
    name: "Orphan publish node",
  })
  const publishRequest = {
    id: "invalid-template-version",
    templateId: `invalid-template-${crypto.randomUUID()}`,
    version: 1,
    publishedAt: new Date().toISOString(),
    document,
  }

  const invalidAggregate = await page.request.post("/v1/studio/templates/", {
    data: publishRequest,
  })
  expect(invalidAggregate.status()).toBe(422)
  expect(await invalidAggregate.json()).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({
        code: "publish_validation_failed",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "orphan_node" }),
        ]),
      }),
    })
  )

  const unknownKey = await page.request.post("/v1/studio/templates/", {
    data: {
      ...publishRequest,
      document: await readStoredDocument(page),
      manifest: {},
    },
  })
  expect(unknownKey.status()).toBe(400)
  expect(await unknownKey.json()).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({ code: "invalid_publish_request" }),
    })
  )

  const afterResponse = await page.request.get("/v1/studio/templates/")
  expect(afterResponse.ok()).toBe(true)
  const after = (await afterResponse.json()) as { data: unknown[] }
  expect(after.data).toEqual(before.data)
})

test("a valid publish derives and returns the immutable manifest", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Publish version 1" })
  await expect(dialog).toContainText("Validation passed")
  await dialog.getByRole("button", { name: "Publish version 1" }).click()
  await expect(
    page.getByRole("dialog", { name: "Version 1 is published" })
  ).toContainText("Immutable")

  const response = await page.request.get("/v1/studio/templates/")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as {
    data: Array<{
      latestVersion: number
      parameterCount: number
      outputs: Array<{ pages: unknown[] }>
    }>
  }
  expect(payload.data).toHaveLength(1)
  expect(payload.data[0]).toMatchObject({
    latestVersion: 1,
    parameterCount: 1,
  })
  expect(payload.data[0]?.outputs[0]?.pages).toHaveLength(6)
})
