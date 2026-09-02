import { createRemoteJWKSet, jwtVerify } from "jose"
import { withApiPrincipalAudit } from "./api-boundary"
import { readDemoSession, resolveDemoSession } from "./demo-session"

export type StudioPrincipal = {
  id: string
  budgetKey: string
  workspaceId: string
  expiresAt: string
  mode: "local_demo" | "public_demo" | "cloudflare_access"
  respond: (response: Response) => Response
}

export class StudioAccessError extends Error {
  readonly code:
    | "studio_access_closed"
    | "studio_access_not_configured"
    | "studio_authentication_required"
    | "studio_authentication_invalid"
    | "studio_rate_limited"
  readonly status: 401 | 403 | 429 | 503
  readonly retryAfterSeconds?: number

  constructor(
    code: StudioAccessError["code"],
    status: StudioAccessError["status"],
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message)
    this.name = "StudioAccessError"
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const API_RATE_WINDOW_MS = 60_000
const API_PRINCIPAL_REQUESTS_PER_WINDOW = 300
const API_ADDRESS_REQUESTS_PER_WINDOW = 600
const DEMO_SESSION_RATE_WINDOW_MS = 60 * 60_000
const DEMO_SESSIONS_PER_ADDRESS_WINDOW = 12

type StudioAccessEnvironment = {
  STUDIO_ACCESS_MODE?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_POLICY_AUD?: string
}

export const studioAccessMode = (env: Env) =>
  (env as unknown as StudioAccessEnvironment).STUDIO_ACCESS_MODE

export const isPublicDemoMode = (env: Env) =>
  studioAccessMode(env) === "public_demo"

const enforceApiRate = async (
  env: Env,
  key: string,
  limit: number
): Promise<void> => {
  const decision = await env.RENDER_ADMISSION.getByName(
    `api-rate:${key}`
  ).admitApiRequest({
    now: Date.now(),
    limit,
    windowMs: API_RATE_WINDOW_MS,
  })
  if (!decision.admitted) {
    throw new StudioAccessError(
      "studio_rate_limited",
      429,
      "Studio API request rate exceeded",
      decision.retryAfterSeconds
    )
  }
}

export const admitPublicDemoSessionCreation = async (
  env: Env,
  request: Request
) => {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown"
  const decision = await env.RENDER_ADMISSION.getByName(
    `demo-session:${address}`
  ).admitApiRequest({
    now: Date.now(),
    limit: DEMO_SESSIONS_PER_ADDRESS_WINDOW,
    windowMs: DEMO_SESSION_RATE_WINDOW_MS,
  })
  if (!decision.admitted) {
    throw new StudioAccessError(
      "studio_rate_limited",
      429,
      "Too many demo sessions were started from this address",
      decision.retryAfterSeconds
    )
  }
}

export const isLocalStudioRequest = (request: Request) => {
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
  const studioEnv = env as unknown as StudioAccessEnvironment
  const teamDomain = (studioEnv.ACCESS_TEAM_DOMAIN ?? "")
    .trim()
    .replace(/\/$/, "")
  const audience = (studioEnv.ACCESS_POLICY_AUD ?? "").trim()
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
  if (isLocalStudioRequest(request)) {
    const session = await resolveDemoSession(env.DB, request)
    await enforceApiRate(
      env,
      `principal:${session.workspaceId}`,
      API_PRINCIPAL_REQUESTS_PER_WINDOW
    )
    return {
      id: session.id,
      budgetKey: session.workspaceId,
      workspaceId: session.workspaceId,
      expiresAt: session.expiresAt,
      mode: "local_demo",
      respond: (response) =>
        withApiPrincipalAudit(
          session.respond(response),
          session.id,
          session.workspaceId
        ),
    }
  }

  await enforceApiRate(
    env,
    `address:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
    API_ADDRESS_REQUESTS_PER_WINDOW
  )

  const accessMode = studioAccessMode(env)
  if (accessMode === "public_demo") {
    const session = await readDemoSession(env.DB, request)
    if (!session) {
      throw new StudioAccessError(
        "studio_authentication_required",
        401,
        "Start a demo session to use this Studio deployment"
      )
    }
    await enforceApiRate(
      env,
      `principal:${session.workspaceId}`,
      API_PRINCIPAL_REQUESTS_PER_WINDOW
    )
    return {
      id: session.id,
      budgetKey: session.workspaceId,
      workspaceId: session.workspaceId,
      expiresAt: session.expiresAt,
      mode: "public_demo",
      respond: (response) =>
        withApiPrincipalAudit(
          session.respond(response),
          session.id,
          session.workspaceId
        ),
    }
  }
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
  await enforceApiRate(
    env,
    `principal:${principalHash}`,
    API_PRINCIPAL_REQUESTS_PER_WINDOW
  )
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
    respond: (response) =>
      withApiPrincipalAudit(response, `access-${principalHash}`, workspaceId),
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
    {
      status: error.status,
      headers: error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined,
    }
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
