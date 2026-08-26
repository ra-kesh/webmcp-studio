const COOKIE_NAME = "webmcp_demo_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24
const SESSION_ID_PATTERN = /^demo-session-[A-Za-z0-9-]{1,96}$/

const cookieValue = (request: Request, name: string) => {
  const header = request.headers.get("Cookie")
  if (!header) return null
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=")
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() !== name) continue
    const value = pair.slice(separator + 1).trim()
    return value || null
  }
  return null
}

const bearerValue = (request: Request) => {
  const authorization = request.headers.get("Authorization")
  if (!authorization?.startsWith("Bearer ")) return null
  const value = authorization.slice("Bearer ".length).trim()
  return SESSION_ID_PATTERN.test(value) ? value : null
}

const sessionCookie = (request: Request, id: string) => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
}

export type DemoSession = {
  id: string
  workspaceId: string
  expiresAt: string
  isNew: boolean
  respond: (response: Response) => Response
}

async function createDemoSession(
  db: D1Database,
  request: Request
): Promise<DemoSession> {
  const now = new Date()
  const id = `demo-session-${crypto.randomUUID()}`
  const workspaceId = `workspace-${crypto.randomUUID()}`
  const createdAt = now.toISOString()
  const expiresAt = new Date(
    now.getTime() + SESSION_TTL_SECONDS * 1000
  ).toISOString()
  await db.batch([
    db
      .prepare(
        "INSERT INTO workspaces (id, name, kind, created_at) VALUES (?1, ?2, 'demo', ?3)"
      )
      .bind(workspaceId, "WebMCP Studio Demo", createdAt),
    db
      .prepare(
        `INSERT INTO demo_sessions (id, workspace_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(id, workspaceId, expiresAt, createdAt),
  ])
  const cookie = sessionCookie(request, id)
  return {
    id,
    workspaceId,
    expiresAt,
    isNew: true,
    respond: (response) => {
      response.headers.append("Set-Cookie", cookie)
      return response
    },
  }
}

export async function resolveDemoSession(
  db: D1Database,
  request: Request
): Promise<DemoSession> {
  const cookieId = cookieValue(request, COOKIE_NAME)
  const existingId =
    (cookieId && SESSION_ID_PATTERN.test(cookieId) ? cookieId : null) ??
    bearerValue(request)
  if (existingId) {
    const existing = await db
      .prepare(
        `SELECT id, workspace_id, expires_at
         FROM demo_sessions
         WHERE id = ?1 AND expires_at > ?2`
      )
      .bind(existingId, new Date().toISOString())
      .first<{ id: string; workspace_id: string; expires_at: string }>()
    if (existing) {
      return {
        id: existing.id,
        workspaceId: existing.workspace_id,
        expiresAt: existing.expires_at,
        isNew: false,
        respond: (response) => response,
      }
    }
  }
  return createDemoSession(db, request)
}

export const resetDemoSession = (db: D1Database, request: Request) =>
  createDemoSession(db, request)

export const databaseDocumentId = (workspaceId: string, documentId: string) =>
  `${workspaceId}:${documentId}`

export const databaseTemplateId = (workspaceId: string, templateId: string) =>
  `${workspaceId}:${templateId}`
