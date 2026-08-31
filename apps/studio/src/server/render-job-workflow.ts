import { WorkflowEntrypoint } from "cloudflare:workers"
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import {
  beginRenderJobAttempt,
  cancelRenderJobExecution,
  completeRenderJobAttempt,
  failRenderJobAttempt,
  renderJobArtifact,
} from "./render-job-execution"
import type { RenderArtifact } from "./render-job-execution"

export type RenderJobWorkflowPayload = {
  renderId: string
  curatedMediaRequestUrl?: string
}

export class RenderJobWorkflow extends WorkflowEntrypoint<
  Env,
  RenderJobWorkflowPayload
> {
  async run(
    event: Readonly<WorkflowEvent<RenderJobWorkflowPayload>>,
    step: WorkflowStep
  ) {
    const begun = await step.do(
      "claim and admit render attempt",
      {
        retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      () =>
        beginRenderJobAttempt(
          this.env,
          event.payload.renderId,
          event.instanceId,
          event.payload.curatedMediaRequestUrl
        ),
      {
        rollback: async ({ output }) => {
          if (output?.status === "ready") {
            await cancelRenderJobExecution(
              this.env,
              event.payload.renderId,
              output.plan.attemptId
            )
          }
        },
        rollbackConfig: {
          retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
          timeout: "1 minute",
        },
      }
    )
    if (begun.status !== "ready") return begun

    const artifacts: RenderArtifact[] = []
    try {
      for (const [index, selection] of begun.plan.selections.entries()) {
        artifacts.push(
          await step.do(
            `render artifact ${index + 1}`,
            {
              retries: {
                limit: 2,
                delay: "5 seconds",
                backoff: "exponential",
              },
              timeout: "3 minutes",
            },
            () => renderJobArtifact(this.env, begun.plan, selection)
          )
        )
      }
      return await step.do(
        "settle and publish render outputs",
        {
          retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        () => completeRenderJobAttempt(this.env, begun.plan, artifacts),
        {
          rollback: async () => {
            await cancelRenderJobExecution(
              this.env,
              event.payload.renderId,
              begun.plan.attemptId
            )
          },
          rollbackConfig: {
            retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
            timeout: "1 minute",
          },
        }
      )
    } catch (error) {
      return step.do(
        "fail render attempt",
        {
          retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        () => failRenderJobAttempt(this.env, begun.plan, artifacts, error)
      )
    }
  }
}
