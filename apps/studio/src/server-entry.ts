import startServerEntry from "@tanstack/react-start/server-entry"
import {
  finalizeApiResponse,
  internalApiErrorResponse,
  requestIdFor,
  withApiRequestId,
} from "./server/api-boundary"
import { reconcileRenderJobs } from "./server/render-job-reconciler"

export { RenderAdmission } from "./server/render-admission"
export { RenderJobWorkflow } from "./server/render-job-workflow"

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
