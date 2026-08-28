import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  assertRenderImageResourceAdmission,
  createRenderResourcePlan,
  materializeTemplateVersion,
  RenderImageResourceAdmissionError,
} from "@webmcp/document"
import type { RenderResourcePlan } from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { z } from "zod"
import { databaseTemplateId } from "../../../server/demo-session"
import { readStudioJsonBody } from "../../../server/json-request-policy"
import { MediaAssetRepository } from "../../../server/media-asset-repository"
import { MediaAssetError } from "../../../server/media-assets"
import {
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
  resolveRenderFieldAssetIdsForWorkspace,
} from "../../../server/render-field-assets"
import type { ManagedImageResourceExpectation } from "../../../server/render-field-assets"
import {
  RenderAdmissionError,
  renderAdmissionErrorResponse,
  reserveRenderCapacity,
} from "../../../server/render-admission-service"
import {
  RendererInvocationError,
  rendererInvocationErrorFromResponse,
} from "../../../server/renderer-invocation-error"
import {
  StudioAccessError,
  resolveStudioPrincipal,
  studioAccessErrorResponse,
} from "../../../server/studio-principal"
import { getTemplateVersion } from "../../../server/template-repository"

const renderRequestSchema = z
  .object({
    templateId: z.string().min(1),
    version: z.number().int().positive().optional(),
    modifications: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
    response: z
      .object({
        type: z.literal("url"),
        outputs: z
          .array(
            z
              .object({
                outputId: z.string().min(1),
                format: z.enum(["png", "pdf"]),
              })
              .strict()
          )
          .min(1)
          .max(12),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>()
    for (const [index, output] of request.response.outputs.entries()) {
      const key = `${output.outputId}:${output.format}`
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["response", "outputs", index],
          message: "Each output and format pair may be requested only once",
        })
      }
      seen.add(key)
    }
  })

const combinePlans = (plans: RenderResourcePlan[]): RenderResourcePlan => ({
  outputId: "render-batch",
  format: plans[0]?.format ?? "pdf",
  pageIds: plans.flatMap((plan) => plan.pageIds),
  pageCount: plans.reduce((total, plan) => total + plan.pageCount, 0),
  pixelArea: plans.reduce((total, plan) => total + plan.pixelArea, 0),
  estimatedStorageBytes: plans.reduce(
    (total, plan) => total + plan.estimatedStorageBytes,
    0
  ),
})

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
  expectedImageResources: readonly ManagedImageResourceExpectation[],
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
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(
          format === "pdf"
            ? { renderId, outputId, document, expectedImageResources }
            : {
                renderId,
                outputId,
                pageId,
                document,
                expectedImageResources,
              }
        ),
      }
    )
  )
  if (!response.ok) {
    throw await rendererInvocationErrorFromResponse(response)
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
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/render")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return jsonBodyErrorResponse(error, true)
          }
          throw error
        }
        const parsed = renderRequestSchema.safeParse(input)
        if (!parsed.success) {
          return Response.json(
            {
              error: {
                code: "invalid_render_request",
                details: parsed.error.flatten(),
              },
            },
            { status: 400 }
          )
        }
        let session
        try {
          session = await resolveStudioPrincipal(env, request)
        } catch (error) {
          if (error instanceof StudioAccessError) {
            return studioAccessErrorResponse(error)
          }
          throw error
        }
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
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
        let expectedImageResources: ManagedImageResourceExpectation[]
        try {
          const mediaAssets = new MediaAssetRepository(env.DB, env.ASSETS)
          const fieldAssets = await resolveRenderFieldAssetIdsForWorkspace(
            version,
            parsed.data.modifications,
            (assetId) =>
              mediaAssets.resolveRendererSource(session.workspaceId, assetId)
          )
          const materialized = await materializeManagedDocumentAssets(
            materializeTemplateVersion(version, fieldAssets.modifications),
            (assetId) =>
              mediaAssets.resolveRendererSource(session.workspaceId, assetId),
            fieldAssets.resources
          )
          document = materialized.document
          expectedImageResources = materialized.resources
          await assertRenderImageResourceAdmission(
            document,
            expectedImageResources
          )
        } catch (error) {
          const managedNodeFailure =
            error instanceof ManagedAssetMaterializationError ? error : null
          const managedAssetFailure =
            error instanceof MediaAssetError ? error : null
          const renderResourceFailure =
            error instanceof RenderImageResourceAdmissionError ? error : null
          return json(
            {
              error: {
                code: renderResourceFailure
                  ? "render_resource_admission_failed"
                  : managedNodeFailure
                    ? managedNodeFailure.code
                    : managedAssetFailure
                      ? "managed_asset_integrity_failed"
                      : "invalid_modification",
                message: renderResourceFailure
                  ? renderResourceFailure.message
                  : managedNodeFailure
                    ? managedNodeFailure.message
                    : managedAssetFailure
                      ? "A managed image failed resource integrity validation"
                      : error instanceof Error
                        ? error.message
                        : "Template values are invalid",
                ...(renderResourceFailure
                  ? {
                      resourceCode: renderResourceFailure.code,
                      assetId: renderResourceFailure.assetId,
                      nodeId: renderResourceFailure.nodeId,
                    }
                  : managedNodeFailure
                    ? {
                        assetId: managedNodeFailure.assetId,
                        nodeId: managedNodeFailure.nodeId,
                      }
                    : {}),
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

        let resourcePlan: RenderResourcePlan
        try {
          resourcePlan = combinePlans(
            parsed.data.response.outputs.map((selection) =>
              createRenderResourcePlan(document, {
                outputId: selection.outputId,
                format: selection.format,
              })
            )
          )
        } catch (error) {
          return json(
            {
              error: {
                code: "render_policy_rejected",
                message:
                  error instanceof Error
                    ? error.message
                    : "The materialized document is not render-safe",
              },
            },
            { status: 422 }
          )
        }
        let lease
        try {
          lease = await reserveRenderCapacity(env, session, resourcePlan)
        } catch (error) {
          if (error instanceof RenderAdmissionError) {
            return session.respond(renderAdmissionErrorResponse(error))
          }
          throw error
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
          if (!idempotencyKey) {
            await lease.fail()
            throw error
          }
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
            await lease.fail()
            return json(
              { error: { code: "idempotency_key_reused" } },
              { status: 409 }
            )
          }
          await lease.fail()
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
                  expectedImageResources,
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
                    expectedImageResources,
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
          await lease.complete(
            artifacts.reduce((total, artifact) => total + artifact.bytes, 0)
          )
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
          await lease.fail()
          await Promise.allSettled(
            artifacts.map((artifact) => env.RENDERS.delete(artifact.key))
          )
          const rendererFailure =
            error instanceof RendererInvocationError ? error : null
          const message =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Renderer failed"
          await env.DB.prepare(
            `UPDATE render_jobs
             SET status = 'failed', error_code = ?2, error_message = ?3, completed_at = ?4
             WHERE id = ?1`
          )
            .bind(
              renderId,
              rendererFailure?.code ?? "renderer_failed",
              message,
              new Date().toISOString()
            )
            .run()
          return json(
            {
              id: renderId,
              status: "failed",
              error: {
                code: rendererFailure?.code ?? "renderer_failed",
                message,
                ...(rendererFailure?.nodeId
                  ? { nodeId: rendererFailure.nodeId }
                  : {}),
                ...(rendererFailure?.assetId
                  ? { assetId: rendererFailure.assetId }
                  : {}),
              },
              statusUrl: `/v1/renders/${renderId}`,
            },
            { status: 502 }
          )
        }
      },
    },
  },
})
