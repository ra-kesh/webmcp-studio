CREATE UNIQUE INDEX idx_render_outputs_artifact_identity
ON render_outputs(
  render_job_id,
  output_id,
  COALESCE(page_id, ''),
  format
);
