-- Serialize all work that uses one token, including power verification, while retaining
-- concurrency between independent tokens. This prevents a token sync from overwriting
-- server state while a control job is still being verified.
DROP INDEX IF EXISTS sync_jobs_one_active_token_idx;
CREATE UNIQUE INDEX sync_jobs_one_active_token_idx ON sync_jobs(token_id)
  WHERE token_id IS NOT NULL AND status IN ('queued', 'running', 'verifying');
