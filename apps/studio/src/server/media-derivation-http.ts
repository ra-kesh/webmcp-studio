import { z } from "zod"
import type { StudioPrincipal } from "./studio-principal"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { readStudioJsonBody } from "./json-request-policy"
import { MediaDerivationRepository } from "./media-derivation-repository"
import {
  assertMediaDerivationIdempotencyKey,
  mediaDerivationCreateInputSchema,
  MediaDerivationError,
  publicMediaDerivationJob,
  publicMediaDerivationProvenance,
} from "./media-derivations"
import type { MediaDerivationConfiguration } from "./media-derivations"

type PrincipalResolver = (
  request: Request
) => Promise<StudioPrincipal | Response>

export type MediaDerivationDispatcher = Readonly<{
  dispatch: (input: { workspaceId: string; jobId: string }) => Promise<void>
}>

export type MediaDerivationHttpDependencies = Readonly<{
  db: D1Database
  requirePrincipal: PrincipalResolver
  configuration: MediaDerivationConfiguration
  disclosure: {
    subprocessor: string
    retention: string
    region: string | null
    cost: string
    cancellationLimits: string
  }
  dispatcher: MediaDerivationDispatcher
  repository?: Pick<
    MediaDerivationRepository,
    | "create"
    | "get"
    | "getProvenance"
    | "latestForSource"
    | "retryWithReceipt"
    | "requestCancellationWithReceipt"
    | "markRetryDispatched"
  >
  admitCreate: (
    principal: StudioPrincipal,
    sourceAssetId: string
  ) => Promise<void>
}>

export type MediaDerivationReadHttpDependencies = Readonly<{
  db: D1Database
  requirePrincipal: PrincipalResolver
  repository?: Pick<
    MediaDerivationRepository,
    "get" | "getProvenance" | "latestForSource"
  >
}>

const consentSchema = z
  .object({
    accepted: z.literal(true),
    privacyPolicyVersion: z.string().min(1).max(200),
  })
  .strict()

const createSchema = mediaDerivationCreateInputSchema
  .omit({ sourceAssetId: true })
  .extend({ consent: consentSchema })
  .strict()

const mutationSchema = z
  .object({ expectedUpdatedAt: z.iso.datetime() })
  .strict()

const noStore = { "Cache-Control": "private, no-store" }

const errorResponse = (request: Request, error: MediaDerivationError) =>
  Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
    },
    { status: error.status, headers: noStore }
  )

const withPrincipal = async (
  dependencies: Pick<MediaDerivationHttpDependencies, "requirePrincipal">,
  request: Request,
  operation: (principal: StudioPrincipal) => Promise<Response>
) => {
  const principal = await dependencies.requirePrincipal(request)
  if (principal instanceof Response) return principal
  try {
    return principal.respond(await operation(principal))
  } catch (error) {
    if (error instanceof JsonBodyError) {
      return principal.respond(jsonBodyErrorResponse(error))
    }
    if (error instanceof MediaDerivationError) {
      return principal.respond(errorResponse(request, error))
    }
    throw error
  }
}

export function createMediaDerivationReadHttpHandlers(
  dependencies: MediaDerivationReadHttpDependencies
) {
  const repository =
    dependencies.repository ?? new MediaDerivationRepository(dependencies.db)
  return {
    latest: (request: Request, sourceAssetId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const job = await repository.latestForSource(
          principal.workspaceId,
          sourceAssetId
        )
        return Response.json(
          { job: job ? publicMediaDerivationJob(job) : null },
          { headers: noStore }
        )
      }),
    get: (request: Request, jobId: string) =>
      withPrincipal(dependencies, request, async (principal) =>
        Response.json(
          publicMediaDerivationJob(
            await repository.get(principal.workspaceId, jobId)
          ),
          { headers: noStore }
        )
      ),
    provenance: (request: Request, outputAssetId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const provenance = await repository.getProvenance(
          principal.workspaceId,
          outputAssetId
        )
        return Response.json(
          {
            provenance: provenance
              ? publicMediaDerivationProvenance(provenance)
              : null,
          },
          { headers: noStore }
        )
      }),
  }
}

export function createMediaDerivationHttpHandlers(
  dependencies: MediaDerivationHttpDependencies
) {
  const repository =
    dependencies.repository ?? new MediaDerivationRepository(dependencies.db)
  const readJson = async (request: Request) =>
    readStudioJsonBody(request, "/v1/studio/media-derivations")
  const requireIdempotency = (request: Request) =>
    assertMediaDerivationIdempotencyKey(
      request.headers.get("idempotency-key") ?? ""
    )

  return {
    policy: (request: Request) =>
      withPrincipal(dependencies, request, async () =>
        Response.json(
          {
            operation: "remove_background",
            privacyPolicyVersion:
              dependencies.configuration.privacyPolicyVersion,
            ...dependencies.disclosure,
          },
          { headers: noStore }
        )
      ),

    create: (request: Request, sourceAssetId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const idempotencyKey = requireIdempotency(request)
        const parsed = createSchema.safeParse(await readJson(request))
        if (!parsed.success) {
          throw new MediaDerivationError(
            "invalid_derivation_request",
            400,
            "The media derivation request is malformed"
          )
        }
        if (
          parsed.data.consent.privacyPolicyVersion !==
          dependencies.configuration.privacyPolicyVersion
        ) {
          throw new MediaDerivationError(
            "invalid_derivation_request",
            400,
            "Consent must name the configured privacy policy version"
          )
        }
        await dependencies.admitCreate(principal, sourceAssetId)
        const result = await repository.create(
          principal.workspaceId,
          idempotencyKey,
          {
            sourceAssetId,
            operation: parsed.data.operation,
            parameters: parsed.data.parameters,
          },
          dependencies.configuration
        )
        await dependencies.dispatcher.dispatch({
          workspaceId: principal.workspaceId,
          jobId: result.job.id,
        })
        return Response.json(publicMediaDerivationJob(result.job), {
          status: result.created ? 202 : 200,
          headers: noStore,
        })
      }),

    latest: (request: Request, sourceAssetId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const job = await repository.latestForSource(
          principal.workspaceId,
          sourceAssetId
        )
        return Response.json(
          { job: job ? publicMediaDerivationJob(job) : null },
          { headers: noStore }
        )
      }),

    provenance: (request: Request, outputAssetId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const provenance = await repository.getProvenance(
          principal.workspaceId,
          outputAssetId
        )
        return Response.json(
          {
            provenance: provenance
              ? publicMediaDerivationProvenance(provenance)
              : null,
          },
          { headers: noStore }
        )
      }),

    get: (request: Request, jobId: string) =>
      withPrincipal(dependencies, request, async (principal) =>
        Response.json(
          publicMediaDerivationJob(
            await repository.get(principal.workspaceId, jobId)
          ),
          { headers: noStore }
        )
      ),

    cancel: (request: Request, jobId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const idempotencyKey = requireIdempotency(request)
        const parsed = mutationSchema.safeParse(await readJson(request))
        if (!parsed.success) {
          throw new MediaDerivationError(
            "invalid_derivation_request",
            400,
            "Cancellation requires the expected job update timestamp"
          )
        }
        const result = await repository.requestCancellationWithReceipt(
          principal.workspaceId,
          jobId,
          idempotencyKey,
          parsed.data.expectedUpdatedAt
        )
        return Response.json(publicMediaDerivationJob(result.job), {
          status: 202,
          headers: noStore,
        })
      }),

    retry: (request: Request, jobId: string) =>
      withPrincipal(dependencies, request, async (principal) => {
        const idempotencyKey = requireIdempotency(request)
        const parsed = mutationSchema.safeParse(await readJson(request))
        if (!parsed.success) {
          throw new MediaDerivationError(
            "invalid_derivation_request",
            400,
            "Retry requires the expected job update timestamp"
          )
        }
        const result = await repository.retryWithReceipt(
          principal.workspaceId,
          jobId,
          idempotencyKey,
          parsed.data.expectedUpdatedAt
        )
        if (result.dispatchRequired) {
          await dependencies.dispatcher.dispatch({
            workspaceId: principal.workspaceId,
            jobId: result.job.id,
          })
          await repository.markRetryDispatched(
            principal.workspaceId,
            result.job.id,
            idempotencyKey
          )
        }
        return Response.json(publicMediaDerivationJob(result.job), {
          status: 202,
          headers: noStore,
        })
      }),
  }
}
