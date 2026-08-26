import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { materializeTemplateVersion } from "@webmcp/document"
import { z } from "zod"
import {
  databaseTemplateId,
  resolveDemoSession,
} from "../../../server/demo-session"
import { getTemplateVersion } from "../../../server/template-repository"

const renderRequestSchema = z.object({
  templateId: z.string().min(1),
  version: z.number().int().positive().optional(),
  modifications: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
  response: z.object({
    type: z.literal("url"),
    outputs: z
      .array(
        z.object({
          outputId: z.string().min(1),
          format: z.enum(["png", "pdf"]),
        })
      )
      .min(1)
      .max(12),
  }),
})

const MAX_REQUEST_BYTES = 256_000

type RenderArtifact = {
  id: string
  outputId: string
  pageId: string | null
  format: "png" | "pdf"
  key: string
  width: number | null
  height: number | null
  bytes: number
  checksum: string
}

type ExistingJobRow = {
  id: string
  template_id: string
  template_public_id: string
  template_version: number
  status: "queued" | "rendering" | "completed" | "failed"
  request_hash: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

type ExistingArtifactRow = {
  id: string
  output_id: string
  page_id: string | null
  format: "png" | "pdf"
  width: number | null
  height: number | null
  bytes: number
  checksum: string
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

async function requestHash(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value))
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function existingRenderResponse(job: ExistingJobRow) {
  const outputs = await env.DB.prepare(
    `SELECT id, output_id, page_id, format, width, height, bytes, checksum
     FROM render_outputs WHERE render_job_id = ?1 ORDER BY created_at, id`
  )
    .bind(job.id)
    .all<ExistingArtifactRow>()
  const responseBody = {
    id: job.id,
    status: job.status,
    templateId: job.template_public_id,
    version: job.template_version,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    error: job.error_code
      ? { code: job.error_code, message: job.error_message }
      : null,
    statusUrl: `/v1/renders/${job.id}`,
    artifacts: outputs.results.map((artifact) => ({
      id: artifact.id,
      outputId: artifact.output_id,
      pageId: artifact.page_id,
      format: artifact.format,
      width: artifact.width,
      height: artifact.height,
      bytes: artifact.bytes,
      checksum: artifact.checksum,
      downloadUrl: `/v1/renders/${job.id}/outputs/${artifact.id}`,
    })),
  }
  return Response.json(responseBody, {
    status:
      job.status === "completed" ? 200 : job.status === "failed" ? 502 : 202,
  })
}

async function invokeRenderer(
  document: ReturnType<typeof materializeTemplateVersion>,
  renderId: string,
  outputId: string,
  format: "png" | "pdf",
  pageId?: string
): Promise<RenderArtifact> {
  const response = await env.RENDERER.fetch(
    new Request(
      format === "pdf"
        ? "https://renderer.internal/render/pdf"
        : "https://renderer.internal/render",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          format === "pdf"
            ? { renderId, outputId, document }
            : { renderId, outputId, pageId, document }
        ),
      }
    )
  )
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 240)
    throw new Error(detail || `Renderer returned ${response.status}`)
  }
  const key = response.headers.get("X-Render-Key")
  if (!key) throw new Error("Renderer did not return an artifact key")
  await response.body?.cancel()
  const page = pageId
    ? document.pages.find((candidate) => candidate.id === pageId)
    : undefined
  return {
    id: `render-output-${crypto.randomUUID()}`,
    outputId,
    pageId: pageId ?? null,
    format,
    key,
    width: page?.width ?? null,
    height: page?.height ?? null,
    bytes: Number(response.headers.get("X-Bytes") ?? 0),
    checksum: response.headers.get("X-Checksum") ?? key,
  }
}

export const Route = createFileRoute("/v1/studio/render")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const contentLength = Number(request.headers.get("content-length") ?? 0)
        if (!contentLength) {
          return json(
            { error: { code: "content_length_required" } },
            { status: 411 }
          )
        }
        if (contentLength > MAX_REQUEST_BYTES) {
          return json(
            {
              error: {
                code: "request_too_large",
                maxBytes: MAX_REQUEST_BYTES,
              },
            },
            { status: 413 }
          )
        }
        const parsed = renderRequestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return json(
            {
              error: {
                code: "invalid_render_request",
                details: parsed.error.flatten(),
              },
            },
            { status: 400 }
          )
        }
        const idempotencyKey = request.headers.get("Idempotency-Key")?.trim()
        if (
          idempotencyKey &&
          (idempotencyKey.length > 128 ||
            !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))
        ) {
          return json(
            { error: { code: "invalid_idempotency_key" } },
            { status: 400 }
          )
        }
        const normalizedRequestHash = idempotencyKey
          ? await requestHash(parsed.data)
          : null
        if (idempotencyKey) {
          const existing = await env.DB.prepare(
            `SELECT jobs.id, jobs.template_id, templates.public_id AS template_public_id,
                    jobs.template_version, jobs.status, jobs.request_hash,
                    jobs.error_code, jobs.error_message, jobs.created_at,
                    jobs.completed_at
             FROM render_jobs jobs
             JOIN templates ON templates.id = jobs.template_id
             WHERE jobs.workspace_id = ?1 AND jobs.idempotency_key = ?2`
          )
            .bind(session.workspaceId, idempotencyKey)
            .first<ExistingJobRow>()
          if (existing) {
            if (existing.request_hash !== normalizedRequestHash) {
              return json(
                { error: { code: "idempotency_key_reused" } },
                { status: 409 }
              )
            }
            return session.respond(await existingRenderResponse(existing))
          }
        }
        const version = await getTemplateVersion(
          env.DB,
          session.workspaceId,
          parsed.data.templateId,
          parsed.data.version
        )
        if (!version) {
          return json(
            { error: { code: "template_not_found" } },
            { status: 404 }
          )
        }

        let document: ReturnType<typeof materializeTemplateVersion>
        try {
          document = materializeTemplateVersion(
            version,
            parsed.data.modifications
          )
        } catch (error) {
          return json(
            {
              error: {
                code: "invalid_modification",
                message:
                  error instanceof Error
                    ? error.message
                    : "Template values are invalid",
              },
            },
            { status: 422 }
          )
        }

        for (const selection of parsed.data.response.outputs) {
          const output = document.outputs.find(
            (candidate) => candidate.id === selection.outputId
          )
          if (!output) {
            return json(
              {
                error: {
                  code: "unknown_output",
                  outputId: selection.outputId,
                },
              },
              { status: 422 }
            )
          }
          if (!output.exportFormats.includes(selection.format)) {
            return json(
              {
                error: {
                  code: "unsupported_format",
                  outputId: output.id,
                  format: selection.format,
                },
              },
              { status: 422 }
            )
          }
        }

        const renderId = `render-${crypto.randomUUID()}`
        const createdAt = new Date().toISOString()
        try {
          await env.DB.prepare(
            `INSERT INTO render_jobs
             (id, workspace_id, template_id, template_version, status, request_json,
              idempotency_key, request_hash, created_at, started_at)
             VALUES (?1, ?2, ?3, ?4, 'rendering', ?5, ?6, ?7, ?8, ?8)`
          )
            .bind(
              renderId,
              session.workspaceId,
              databaseTemplateId(session.workspaceId, version.templateId),
              version.version,
              JSON.stringify(parsed.data),
              idempotencyKey ?? null,
              normalizedRequestHash,
              createdAt
            )
            .run()
        } catch (error) {
          if (!idempotencyKey) throw error
          const existing = await env.DB.prepare(
            `SELECT jobs.id, jobs.template_id, templates.public_id AS template_public_id,
                    jobs.template_version, jobs.status, jobs.request_hash,
                    jobs.error_code, jobs.error_message, jobs.created_at,
                    jobs.completed_at
             FROM render_jobs jobs
             JOIN templates ON templates.id = jobs.template_id
             WHERE jobs.workspace_id = ?1 AND jobs.idempotency_key = ?2`
          )
            .bind(session.workspaceId, idempotencyKey)
            .first<ExistingJobRow>()
          if (!existing || existing.request_hash !== normalizedRequestHash) {
            return json(
              { error: { code: "idempotency_key_reused" } },
              { status: 409 }
            )
          }
          return session.respond(await existingRenderResponse(existing))
        }

        const artifacts: RenderArtifact[] = []
        try {
          for (const selection of parsed.data.response.outputs) {
            const output = document.outputs.find(
              (candidate) => candidate.id === selection.outputId
            )!
            if (selection.format === "pdf") {
              artifacts.push(
                await invokeRenderer(
                  document,
                  renderId,
                  output.id,
                  selection.format
                )
              )
            } else {
              for (const pageId of output.pageIds) {
                artifacts.push(
                  await invokeRenderer(
                    document,
                    renderId,
                    output.id,
                    selection.format,
                    pageId
                  )
                )
              }
            }
          }
          const completedAt = new Date().toISOString()
          await env.DB.batch([
            ...artifacts.map((artifact) =>
              env.DB.prepare(
                `INSERT INTO render_outputs
                 (id, render_job_id, output_id, page_id, format, r2_key, width, height, bytes, checksum, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
              ).bind(
                artifact.id,
                renderId,
                artifact.outputId,
                artifact.pageId,
                artifact.format,
                artifact.key,
                artifact.width,
                artifact.height,
                artifact.bytes,
                artifact.checksum,
                completedAt
              )
            ),
            env.DB.prepare(
              "UPDATE render_jobs SET status = 'completed', completed_at = ?2 WHERE id = ?1"
            ).bind(renderId, completedAt),
          ])
          return json(
            {
              id: renderId,
              status: "completed",
              templateId: version.templateId,
              version: version.version,
              createdAt,
              completedAt,
              artifacts: artifacts.map((artifact) => ({
                id: artifact.id,
                outputId: artifact.outputId,
                pageId: artifact.pageId,
                format: artifact.format,
                width: artifact.width,
                height: artifact.height,
                bytes: artifact.bytes,
                checksum: artifact.checksum,
                downloadUrl: `/v1/renders/${renderId}/outputs/${artifact.id}`,
              })),
            },
            { status: 201 }
          )
        } catch (error) {
          await Promise.allSettled(
            artifacts.map((artifact) => env.RENDERS.delete(artifact.key))
          )
          const message =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Renderer failed"
          await env.DB.prepare(
            `UPDATE render_jobs
             SET status = 'failed', error_code = 'renderer_failed', error_message = ?2, completed_at = ?3
             WHERE id = ?1`
          )
            .bind(renderId, message, new Date().toISOString())
            .run()
          return json(
            {
              id: renderId,
              status: "failed",
              error: { code: "renderer_failed", message },
              statusUrl: `/v1/renders/${renderId}`,
            },
            { status: 502 }
          )
        }
      },
    },
  },
})
