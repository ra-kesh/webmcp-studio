import { expect, test } from "@playwright/test"

type RenderHistoryResponse = {
  data: Array<{ id: string; artifacts: Array<{ id: string }> }>
}

test("duplicate HTTP render selections cannot create a job or artifact", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()

  const beforeResponse = await page.request.get("/v1/studio/renders/?limit=100")
  expect(beforeResponse.ok()).toBe(true)
  const before = (await beforeResponse.json()) as RenderHistoryResponse

  const response = await page.request.post("/v1/studio/render", {
    data: {
      templateId: "duplicate-selection-probe",
      modifications: {},
      response: {
        type: "url",
        outputs: [
          { outputId: "proposal", format: "pdf" },
          { outputId: "proposal", format: "pdf" },
        ],
      },
    },
  })

  expect(response.status()).toBe(400)
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "invalid_render_request" },
  })

  const afterResponse = await page.request.get("/v1/studio/renders/?limit=100")
  expect(afterResponse.ok()).toBe(true)
  const after = (await afterResponse.json()) as RenderHistoryResponse
  expect(after).toEqual(before)
})
