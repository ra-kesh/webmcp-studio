import { describe, expect, it } from "vitest"
import { renderRequestHash, renderRequestSchema } from "./render-job-contract"

const request = {
  templateId: "template-proposal",
  version: 3,
  modifications: { title: "A proposal", approved: true },
  response: {
    type: "url" as const,
    outputs: [{ outputId: "proposal", format: "pdf" as const }],
  },
}

describe("durable render request identity", () => {
  it("rejects duplicate semantic artifacts before a job is persisted", () => {
    const result = renderRequestSchema.safeParse({
      ...request,
      response: {
        type: "url",
        outputs: [
          { outputId: "proposal", format: "pdf" },
          { outputId: "proposal", format: "pdf" },
        ],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(["response", "outputs", 1])
  })

  it("hashes equivalent object key order to the same idempotency identity", async () => {
    const reordered = {
      response: request.response,
      modifications: { approved: true, title: "A proposal" },
      version: 3,
      templateId: "template-proposal",
    }

    await expect(renderRequestHash(request)).resolves.toBe(
      await renderRequestHash(reordered)
    )
  })

  it("changes identity when an output selection changes", async () => {
    const changed = {
      ...request,
      response: {
        type: "url" as const,
        outputs: [{ outputId: "proposal", format: "png" as const }],
      },
    }

    expect(await renderRequestHash(changed)).not.toBe(
      await renderRequestHash(request)
    )
  })
})
