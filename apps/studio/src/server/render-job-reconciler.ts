import { cancelRenderJobExecution } from "./render-job-execution"

type PendingDispatch = {
  id: string
  workflow_instance_id: string | null
  dispatch_state: "pending" | "dispatched" | "restart_pending"
}

type StaleJob = {
  id: string
  workflow_instance_id: string | null
  active_attempt_id: string | null
}

type ExpiredArtifact = {
  id: string
  r2_key: string
}

type PendingAdmissionSettlement = {
  id: string
  status: "completed" | "failed" | "cancelled"
  reservation_id: string
  admission_key: string
  actual_bytes: number
}

const dispatchQueuedJob = async (env: Env, renderId: string) => {
  const job = await env.DB.prepare(
    `SELECT workflow_instance_id, dispatch_state FROM render_jobs
     WHERE id = ?1 AND status = 'queued'`
  )
    .bind(renderId)
    .first<PendingDispatch>()
  if (!job) return
  try {
    if (job.workflow_instance_id) {
      const instance = await env.RENDER_JOBS.get(job.workflow_instance_id)
      const instanceState = await instance.status()
      if (
        ["queued", "running", "waiting", "paused", "waitingForPause"].includes(
          instanceState.status
        )
      ) {
        await env.DB.prepare(
          `UPDATE render_jobs SET dispatch_state = 'dispatched', updated_at = ?2
           WHERE id = ?1 AND status = 'queued'`
        )
          .bind(renderId, new Date().toISOString())
          .run()
        return
      }
      if (
        ["complete", "errored", "terminated"].includes(instanceState.status)
      ) {
        await instance.restart()
        await env.DB.prepare(
          `UPDATE render_jobs SET dispatch_state = 'dispatched',
             error_code = NULL, error_message = NULL, updated_at = ?2
           WHERE id = ?1 AND status = 'queued'`
        )
          .bind(renderId, new Date().toISOString())
          .run()
        return
      }
      throw new Error("Workflow dispatch state is unknown")
    }
    const instance = await env.RENDER_JOBS.create({
      id: renderId,
      params: { renderId },
      retention: {
        successRetention: "14 days",
        errorRetention: "14 days",
      },
    })
    await env.DB.prepare(
      `UPDATE render_jobs
       SET workflow_instance_id = ?2, dispatch_state = 'dispatched', error_code = NULL,
           error_message = NULL, updated_at = ?3
       WHERE id = ?1 AND status = 'queued' AND workflow_instance_id IS NULL`
    )
      .bind(renderId, instance.id, new Date().toISOString())
      .run()
  } catch (createError) {
    try {
      const instance = await env.RENDER_JOBS.get(renderId)
      await instance.status()
      await env.DB.prepare(
        `UPDATE render_jobs
         SET workflow_instance_id = ?2, dispatch_state = 'dispatched', error_code = NULL,
             error_message = NULL, updated_at = ?3
         WHERE id = ?1 AND status = 'queued' AND workflow_instance_id IS NULL`
      )
        .bind(renderId, instance.id, new Date().toISOString())
        .run()
    } catch {
      await env.DB.prepare(
        `UPDATE render_jobs
         SET error_code = 'render_dispatch_pending', error_message = ?2,
             updated_at = ?3
         WHERE id = ?1 AND status = 'queued'`
      )
        .bind(
          renderId,
          createError instanceof Error
            ? createError.message.slice(0, 500)
            : "Render dispatch is pending",
          new Date().toISOString()
        )
        .run()
    }
  }
}

async function reconcilePendingDispatches(env: Env) {
  const pending = await env.DB.prepare(
    `SELECT id, workflow_instance_id, dispatch_state FROM render_jobs
     WHERE status = 'queued'
     ORDER BY created_at LIMIT 25`
  ).all<PendingDispatch>()
  for (const job of pending.results) await dispatchQueuedJob(env, job.id)
}

async function reconcileStaleExecutions(env: Env) {
  const cutoff = new Date(Date.now() - 11 * 60_000).toISOString()
  const stale = await env.DB.prepare(
    `SELECT id, workflow_instance_id, active_attempt_id FROM render_jobs
     WHERE status IN ('rendering', 'retrying', 'cancelling')
       AND COALESCE(heartbeat_at, started_at, created_at) <= ?1
     ORDER BY created_at LIMIT 25`
  )
    .bind(cutoff)
    .all<StaleJob>()
  for (const job of stale.results) {
    const cancellation = await cancelRenderJobExecution(
      env,
      job.id,
      job.active_attempt_id ?? undefined
    )
    if (
      cancellation.status !== "cancelling" &&
      cancellation.status !== "cancelled"
    ) {
      continue
    }
    if (job.workflow_instance_id) {
      await env.RENDER_JOBS.get(job.workflow_instance_id)
        .then((instance) => instance.terminate({ rollback: true }))
        .catch(() => undefined)
    }
    await cancelRenderJobExecution(
      env,
      job.id,
      job.active_attempt_id ?? undefined
    )
    const now = new Date().toISOString()
    await env.DB.prepare(
      `UPDATE render_jobs
       SET status = 'failed', error_code = 'render_execution_timed_out',
           error_message = 'The durable render exceeded its execution deadline',
           retryable = CASE WHEN attempt_count < max_attempts THEN 1 ELSE 0 END,
           completed_at = ?2, updated_at = ?2
       WHERE id = ?1 AND status = 'cancelled'`
    )
      .bind(job.id, now)
      .run()
  }
}

async function expireArtifacts(env: Env) {
  const now = new Date().toISOString()
  const expired = await env.DB.prepare(
    `SELECT id, r2_key FROM render_outputs
     WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ?1
     ORDER BY expires_at LIMIT 100`
  )
    .bind(now)
    .all<ExpiredArtifact>()
  for (const artifact of expired.results) {
    await env.RENDERS.delete(artifact.r2_key)
    await env.DB.prepare(
      `UPDATE render_outputs SET status = 'expired', deleted_at = ?2
       WHERE id = ?1 AND status = 'ready'`
    )
      .bind(artifact.id, now)
      .run()
  }
}

async function reconcileAdmissionSettlements(env: Env) {
  const pending = await env.DB.prepare(
    `SELECT jobs.id, jobs.status, jobs.reservation_id, jobs.admission_key,
            COALESCE(SUM(outputs.bytes), 0) AS actual_bytes
     FROM render_jobs jobs
     LEFT JOIN render_outputs outputs ON outputs.render_job_id = jobs.id
     WHERE jobs.admission_settlement = 'pending'
       AND jobs.reservation_id IS NOT NULL
       AND jobs.status IN ('completed', 'failed', 'cancelled')
     GROUP BY jobs.id
     ORDER BY jobs.updated_at LIMIT 25`
  ).all<PendingAdmissionSettlement>()
  for (const job of pending.results) {
    const stub = env.RENDER_ADMISSION.getByName(job.admission_key)
    if (job.status === "completed") {
      await stub.complete(job.reservation_id, job.actual_bytes, Date.now())
      await env.DB.prepare(
        `UPDATE render_jobs SET admission_settlement = 'completed', updated_at = ?2
         WHERE id = ?1 AND status = 'completed'
           AND admission_settlement = 'pending'`
      )
        .bind(job.id, new Date().toISOString())
        .run()
      continue
    }
    await stub.fail(job.reservation_id, Date.now())
    await deleteFailedRenderPrefix(env, job.id)
    await env.DB.prepare(
      `UPDATE render_jobs SET admission_settlement = 'failed', updated_at = ?2
       WHERE id = ?1 AND status IN ('failed', 'cancelled')
         AND admission_settlement = 'pending'`
    )
      .bind(job.id, new Date().toISOString())
      .run()
  }
}

async function deleteFailedRenderPrefix(env: Env, renderId: string) {
  let cursor: string | undefined
  do {
    const page = await env.RENDERS.list({
      prefix: `${renderId}/`,
      ...(cursor ? { cursor } : {}),
    })
    if (page.objects.length) {
      await env.RENDERS.delete(page.objects.map((object) => object.key))
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

export async function reconcileRenderJobs(env: Env) {
  await reconcilePendingDispatches(env)
  await reconcileStaleExecutions(env)
  await reconcileAdmissionSettlements(env)
  await expireArtifacts(env)
}
