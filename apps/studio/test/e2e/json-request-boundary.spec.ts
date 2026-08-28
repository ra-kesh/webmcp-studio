import { createConnection } from "node:net"
import { expect, test } from "@playwright/test"

const routes = [
  { path: "/v1/studio/export-png", maxBytes: 8_000_000 },
  { path: "/v1/studio/export-pdf", maxBytes: 8_000_000 },
  { path: "/v1/studio/render", maxBytes: 256_000 },
  { path: "/v1/studio/templates/", maxBytes: 8_000_000 },
  { path: "/v1/studio/quotation-compositions", maxBytes: 2_000_000 },
] as const

type RawResponse = {
  status: number
  response: string
}

const sendRawRequest = (request: string): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 3000 })
    const chunks: Buffer[] = []
    let socketError: Error | null = null
    const timeout = setTimeout(() => {
      socket.destroy(new Error("Raw HTTP boundary probe timed out"))
    }, 30_000)
    socket.on("connect", () => socket.end(request))
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    socket.on("error", (error) => {
      clearTimeout(timeout)
      socketError = error
    })
    socket.on("close", () => {
      clearTimeout(timeout)
      const response = Buffer.concat(chunks).toString("utf8")
      const match = response.match(/^HTTP\/1\.[01] (\d{3})/)
      if (!match) {
        reject(
          socketError ??
            new Error(`Raw HTTP response has no status line: ${response}`)
        )
        return
      }
      resolve({ status: Number(match[1]), response })
    })
  })

const contentLengthRequest = (
  path: string,
  body: string,
  contentType = "application/json",
  declaredLength = Buffer.byteLength(body)
) =>
  [
    `POST ${path} HTTP/1.1`,
    "Host: localhost:3000",
    "Connection: close",
    `Content-Type: ${contentType}`,
    `Content-Length: ${declaredLength}`,
    "",
    body,
  ].join("\r\n")

const chunkedRequest = (path: string, body: string) =>
  [
    `POST ${path} HTTP/1.1`,
    "Host: localhost:3000",
    "Connection: close",
    "Content-Type: application/json",
    "Transfer-Encoding: chunked",
    "",
    Buffer.byteLength(body).toString(16),
    body,
    "0",
    "",
    "",
  ].join("\r\n")

test("every public JSON route rejects transport failures before persistent side effects", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.locator("canvas.upper-canvas")).toBeVisible()

  const beforeTemplatesResponse = await page.request.get(
    "/v1/studio/templates/"
  )
  const beforeRendersResponse = await page.request.get(
    "/v1/studio/renders/?limit=100"
  )
  expect(beforeTemplatesResponse.ok()).toBe(true)
  expect(beforeRendersResponse.ok()).toBe(true)
  const beforeTemplates = await beforeTemplatesResponse.json()
  const beforeRenders = await beforeRendersResponse.json()

  for (const route of routes) {
    const cases = [
      {
        name: "empty",
        request: contentLengthRequest(route.path, ""),
        status: 400,
        code: "empty_json_body",
      },
      {
        name: "malformed",
        request: contentLengthRequest(route.path, "{"),
        status: 400,
        code: "invalid_json",
      },
      {
        name: "truncated JSON",
        request: contentLengthRequest(route.path, '{"value":'),
        status: 400,
        code: "invalid_json",
      },
      {
        name: "wrong content type",
        request: contentLengthRequest(route.path, "{}", "text/plain"),
        status: 400,
        code: "unsupported_media_type",
      },
      {
        name: "mismatched content length",
        request: contentLengthRequest(route.path, "{}", "application/json", 3),
        status: 400,
      },
      {
        name: "invalid content length",
        request: [
          `POST ${route.path} HTTP/1.1`,
          "Host: localhost:3000",
          "Connection: close",
          "Content-Type: application/json",
          "Content-Length: nope",
          "",
          "{}",
        ].join("\r\n"),
        status: 400,
      },
      {
        name: "headerless chunked",
        request: chunkedRequest(route.path, "{}"),
        status: 411,
        code: "content_length_required",
      },
      {
        name: "headerless oversized chunked",
        request: chunkedRequest(route.path, `"${"x".repeat(route.maxBytes)}"`),
        status: 413,
        code: "request_too_large",
      },
    ]

    for (const boundaryCase of cases) {
      const result = await sendRawRequest(boundaryCase.request)
      expect(result.status, `${route.path}: ${boundaryCase.name}`).toBe(
        boundaryCase.status
      )
      expect(
        result.response,
        `${route.path}: leaked unhandled envelope`
      ).not.toContain('"unhandled":true')
      if (boundaryCase.code) {
        expect(
          result.response,
          `${route.path}: ${boundaryCase.name}`
        ).toContain(boundaryCase.code)
      }
    }
  }

  const afterTemplatesResponse = await page.request.get("/v1/studio/templates/")
  const afterRendersResponse = await page.request.get(
    "/v1/studio/renders/?limit=100"
  )
  expect(afterTemplatesResponse.ok()).toBe(true)
  expect(afterRendersResponse.ok()).toBe(true)
  expect(await afterTemplatesResponse.json()).toEqual(beforeTemplates)
  expect(await afterRendersResponse.json()).toEqual(beforeRenders)
})
