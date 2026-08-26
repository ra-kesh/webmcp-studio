import { describe, expect, it } from "vitest"
import {
  databaseDocumentId,
  databaseTemplateId,
  resolveDemoSession,
} from "./demo-session"

type BoundStatement = {
  query: string
  values: unknown[]
}

const fakeDatabase = (existing?: {
  id: string
  workspace_id: string
  expires_at: string
}) => {
  const prepared: BoundStatement[] = []
  const db = {
    prepare(query: string) {
      const statement: BoundStatement = { query, values: [] }
      prepared.push(statement)
      const api = {
        bind(...values: unknown[]) {
          statement.values = values
          return api
        },
        async first() {
          return existing ?? null
        },
      }
      return api
    },
    async batch() {
      return []
    },
  } as unknown as D1Database
  return { db, prepared }
}

describe("demo sessions", () => {
  it("namespaces public document and template IDs by workspace", () => {
    expect(databaseDocumentId("workspace-a", "document-1")).toBe(
      "workspace-a:document-1"
    )
    expect(databaseTemplateId("workspace-b", "proposal")).toBe(
      "workspace-b:proposal"
    )
  })

  it("creates an opaque localhost session cookie", async () => {
    const { db, prepared } = fakeDatabase()
    const request = new Request("http://localhost/v1/studio/templates")
    const session = await resolveDemoSession(db, request)
    const response = session.respond(Response.json({ ok: true }))
    const cookie = response.headers.get("Set-Cookie")

    expect(session.isNew).toBe(true)
    expect(session.id).toMatch(/^demo-session-/)
    expect(session.workspaceId).toMatch(/^workspace-/)
    expect(cookie).toContain("webmcp_demo_session=demo-session-")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).not.toContain("Secure")
    expect(prepared).toHaveLength(2)
  })

  it("reuses a live session without replacing its cookie", async () => {
    const { db } = fakeDatabase({
      id: "demo-session-existing",
      workspace_id: "workspace-existing",
      expires_at: "2026-08-27T10:00:00.000Z",
    })
    const request = new Request("https://studio.example/v1/studio/renders", {
      headers: { Cookie: "webmcp_demo_session=demo-session-existing" },
    })
    const session = await resolveDemoSession(db, request)
    const response = session.respond(Response.json({ ok: true }))

    expect(session).toMatchObject({
      id: "demo-session-existing",
      workspaceId: "workspace-existing",
      isNew: false,
    })
    expect(response.headers.get("Set-Cookie")).toBeNull()
  })

  it("accepts the opaque session ID as a short-lived bearer token", async () => {
    const { db } = fakeDatabase({
      id: "demo-session-api",
      workspace_id: "workspace-api",
      expires_at: "2026-08-27T10:00:00.000Z",
    })
    const request = new Request("https://studio.example/v1/studio/render", {
      headers: { Authorization: "Bearer demo-session-api" },
    })

    await expect(resolveDemoSession(db, request)).resolves.toMatchObject({
      id: "demo-session-api",
      workspaceId: "workspace-api",
      isNew: false,
    })
  })
})
