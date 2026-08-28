import { createRemoteJWKSet, jwtVerify } from "jose"
import { resolveDemoSession } from "./demo-session"

export type StudioPrincipal = {
  id: string
  budgetKey: string
  workspaceId: string
  expiresAt: string
  mode: "local_demo" | "cloudflare_access"
  respond: (response: Response) => Response
}

export class StudioAccessError extends Error {
  readonly code:
    | "studio_access_closed"
    | "studio_access_not_configured"
    | "studio_authentication_required"
    | "studio_authentication_invalid"
  readonly status: 401 | 403 | 503

  constructor(
    code: StudioAccessError["code"],
    status: StudioAccessError["status"],
    message: string
  ) {
    super(message)
    this.name = "StudioAccessError"
    this.code = code
    this.status = status
  }
}

const isLocalRequest = (request: Request) => {
  const hostname = new URL(request.url).hostname
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  )
}

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

const accessConfig = (env: Env) => {
  const teamDomain = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/$/, "")
  const audience = env.ACCESS_POLICY_AUD.trim()
  if (
    !teamDomain ||
    !audience ||
    !/^https:\/\/[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(teamDomain)
  ) {
    throw new StudioAccessError(
      "studio_access_not_configured",
      503,
      "Cloudflare Access is not configured for this deployment"
    )
  }
  return { teamDomain, audience }
}

export async function resolveStudioPrincipal(
  env: Env,
  request: Request
): Promise<StudioPrincipal> {
  if (isLocalRequest(request)) {
    const session = await resolveDemoSession(env.DB, request)
    return {
      id: session.id,
      budgetKey: session.workspaceId,
      workspaceId: session.workspaceId,
      expiresAt: session.expiresAt,
      mode: "local_demo",
      respond: session.respond,
    }
  }

  const accessMode = (env as unknown as { STUDIO_ACCESS_MODE?: string })
    .STUDIO_ACCESS_MODE
  if (accessMode !== "cloudflare_access") {
    throw new StudioAccessError(
      "studio_access_closed",
      503,
      "This Studio deployment is closed until production authentication is configured"
    )
  }

  const { teamDomain, audience } = accessConfig(env)
  const token = request.headers.get("cf-access-jwt-assertion")
  if (!token) {
    throw new StudioAccessError(
      "studio_authentication_required",
      401,
      "A valid Cloudflare Access session is required"
    )
  }

  let identity: string
  let expiresAt: string
  try {
    const jwks = createRemoteJWKSet(
      new URL(`${teamDomain}/cdn-cgi/access/certs`)
    )
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience,
      algorithms: ["RS256"],
    })
    if (payload.type !== "app") throw new Error("Unexpected Access token type")
    const subject =
      typeof payload.sub === "string" && payload.sub
        ? payload.sub
        : typeof payload.common_name === "string" && payload.common_name
          ? payload.common_name
          : null
    if (!subject) throw new Error("Access token has no stable principal")
    if (typeof payload.exp !== "number") {
      throw new Error("Access token has no expiry")
    }
    identity = `${payload.iss}:${subject}`
    expiresAt = new Date(payload.exp * 1_000).toISOString()
  } catch {
    throw new StudioAccessError(
      "studio_authentication_invalid",
      403,
      "The Cloudflare Access session could not be verified"
    )
  }

  const principalHash = await sha256Hex(identity)
  const workspaceId = `workspace-access-${principalHash}`
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, kind, created_at)
     VALUES (?1, ?2, 'personal', ?3)`
  )
    .bind(workspaceId, "WebMCP Studio", new Date().toISOString())
    .run()
  return {
    id: `access-${principalHash}`,
    budgetKey: principalHash,
    workspaceId,
    expiresAt,
    mode: "cloudflare_access",
    respond: (response) => response,
  }
}

export const studioAccessErrorResponse = (
  error: StudioAccessError,
  nested = true
) =>
  Response.json(
    nested
      ? { error: { code: error.code, message: error.message } }
      : { error: error.code, message: error.message },
    { status: error.status }
  )

export async function requireStudioPrincipal(
  env: Env,
  request: Request
): Promise<StudioPrincipal | Response> {
  try {
    return await resolveStudioPrincipal(env, request)
  } catch (error) {
    if (error instanceof StudioAccessError) {
      return studioAccessErrorResponse(error)
    }
    throw error
  }
}
