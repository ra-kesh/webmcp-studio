import { describe, expect, it } from "vitest"
import { JsonBodyError, readJsonBody } from "../src"

const request = (body: BodyInit | null, headers: HeadersInit = {}) =>
  new Request("https://worker.test/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  })

const expectBodyError = async (
  promise: Promise<unknown>,
  code: JsonBodyError["code"],
  status: JsonBodyError["status"]
) => {
  await expect(promise).rejects.toMatchObject({ code, status })
}

describe("bounded JSON request reader", () => {
  it("parses JSON and accepts a JSON charset parameter", async () => {
    await expect(
      readJsonBody(request('{"ok":true}'), { maxBytes: 32 })
    ).resolves.toEqual({ ok: true })
    await expect(
      readJsonBody(
        request("{}", { "Content-Type": "application/json; charset=utf-8" }),
        { maxBytes: 32 }
      )
    ).resolves.toEqual({})
  })

  it("rejects an empty body before JSON parsing", async () => {
    await expectBodyError(
      readJsonBody(request(""), { maxBytes: 32 }),
      "empty_json_body",
      400
    )
  })

  it("rejects malformed and truncated JSON with one stable error", async () => {
    for (const body of ["{", '{"value":']) {
      await expectBodyError(
        readJsonBody(request(body), { maxBytes: 32 }),
        "invalid_json",
        400
      )
    }
  })

  it("rejects invalid UTF-8", async () => {
    await expectBodyError(
      readJsonBody(request(new Uint8Array([0xc3, 0x28])), { maxBytes: 32 }),
      "invalid_json",
      400
    )
  })

  it("rejects missing and lookalike JSON media types as a bad request", async () => {
    for (const contentType of [null, "text/plain", "application/jsonp"]) {
      const headers = new Headers()
      if (contentType) headers.set("Content-Type", contentType)
      await expectBodyError(
        readJsonBody(
          new Request("https://worker.test/", {
            method: "POST",
            headers,
            body: "{}",
          }),
          { maxBytes: 32 }
        ),
        "unsupported_media_type",
        400
      )
    }
  })

  it("rejects invalid, unsafe, and mismatched Content-Length values", async () => {
    for (const value of ["-1", "+2", "2.0", "abc", "9007199254740992"]) {
      await expectBodyError(
        readJsonBody(request("{}", { "Content-Length": value }), {
          maxBytes: 128,
        }),
        "invalid_content_length",
        400
      )
    }
    await expectBodyError(
      readJsonBody(request("{}", { "Content-Length": "99" }), {
        maxBytes: 128,
      }),
      "invalid_content_length",
      400
    )
    await expectBodyError(
      readJsonBody(request("{}", { "Content-Length": "0" }), {
        maxBytes: 128,
      }),
      "invalid_content_length",
      400
    )
  })

  it("rejects an over-limit declared length without reading the body", async () => {
    await expectBodyError(
      readJsonBody(request("{}", { "Content-Length": "33" }), {
        maxBytes: 32,
      }),
      "request_too_large",
      413
    )
  })

  it("caps the streamed bytes even when Content-Length is absent", async () => {
    const headerless = request('{"value":"too long"}')
    headerless.headers.delete("content-length")
    await expectBodyError(
      readJsonBody(headerless, { maxBytes: 8 }),
      "request_too_large",
      413
    )
  })

  it("reads and caps a headerless body before applying a required-length policy", async () => {
    const small = request("{}")
    small.headers.delete("content-length")
    await expectBodyError(
      readJsonBody(small, { maxBytes: 32, requireContentLength: true }),
      "content_length_required",
      411
    )

    const oversized = request('{"value":"too long"}')
    oversized.headers.delete("content-length")
    await expectBodyError(
      readJsonBody(oversized, {
        maxBytes: 8,
        requireContentLength: true,
      }),
      "request_too_large",
      413
    )
  })

  it("cancels an over-limit stream and keeps the 413 if cancellation fails", async () => {
    let cancelCalls = 0
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9))
      },
      cancel() {
        cancelCalls += 1
        throw new Error("hostile cancel")
      },
    })
    const streamedRequest = new Request("https://worker.test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expectBodyError(
      readJsonBody(streamedRequest, { maxBytes: 8 }),
      "request_too_large",
      413
    )
    expect(cancelCalls).toBe(1)
  })

  it("classifies a stream read failure without leaking the underlying error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("secret transport detail"))
      },
    })
    const streamedRequest = new Request("https://worker.test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expectBodyError(
      readJsonBody(streamedRequest, { maxBytes: 32 }),
      "request_body_unreadable",
      400
    )
  })
})
