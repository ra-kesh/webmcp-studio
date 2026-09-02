import startServerEntry from "@tanstack/react-start/server-entry"
import {
  finalizeApiResponse,
  internalApiErrorResponse,
  requestIdFor,
  withApiRequestId,
} from "./server/api-boundary"
import { reconcileRenderJobs } from "./server/render-job-reconciler"
import { readDemoSession } from "./server/demo-session"
import { isPublicDemoMode } from "./server/studio-principal"

export { RenderAdmission } from "./server/render-admission"
export { RenderJobWorkflow } from "./server/render-job-workflow"
export { MediaDerivationJobWorkflow } from "./server/media-derivation-workflow"

export type StudioRequestContext = {
  workerEnv: Env
}

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: StudioRequestContext
    }
  }
}

// TanStack Start currently resolves server-entry and server-route context from
// different public Register exports, so both declarations must stay aligned.
declare module "@tanstack/react-router" {
  interface Register {
    server: {
      requestContext: StudioRequestContext
    }
  }
}

const studioServerEntry: ExportedHandler<Env> = {
  async fetch(request, workerEnv, executionContext) {
    const pathname = new URL(request.url).pathname
    if (!pathname.startsWith("/v1/")) {
      if (
        isPublicDemoMode(workerEnv) &&
        (pathname === "/" || pathname.startsWith("/documents/"))
      ) {
        const session = await readDemoSession(workerEnv.DB, request)
        if (!session) {
          return Response.redirect(new URL("/demo", request.url), 302)
        }
      }
      if (isPublicDemoMode(workerEnv) && pathname === "/demo") {
        const session = await readDemoSession(workerEnv.DB, request)
        if (session) {
          return Response.redirect(new URL("/", request.url), 302)
        }
      }
      return startServerEntry.fetch(request, {
        context: { workerEnv },
      })
    }

    const startedAt = performance.now()
    const requestId = requestIdFor(request)
    const routedRequest = withApiRequestId(request, requestId)
    let response: Response
    try {
      response = await startServerEntry.fetch(routedRequest, {
        context: { workerEnv },
      })
    } catch (error) {
      console.error("studio_api_request_failed", { requestId, error })
      response = internalApiErrorResponse(routedRequest)
    }
    const finalized = await finalizeApiResponse(
      workerEnv.DB,
      routedRequest,
      response,
      requestId,
      startedAt
    )
    executionContext.waitUntil(finalized.audit)
    return finalized.response
  },
  async scheduled(_controller, workerEnv) {
    await reconcileRenderJobs(workerEnv)
  },
}

export default studioServerEntry
