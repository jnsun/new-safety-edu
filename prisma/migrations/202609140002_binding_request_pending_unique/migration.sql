WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, type, payload ->> 'phone'
           ORDER BY created_at DESC, id DESC
         ) AS row_number
  FROM change_requests
  WHERE status = 'pending'
    AND type = 'binding'
    AND account_id IS NOT NULL
    AND payload ? 'phone'
)
INSERT INTO audit_logs (id, actor_id, action, object_type, object_id, metadata, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'binding.pending_deduplicated', 'change_request', id,
       jsonb_build_object('reason', 'duplicate_pending_request'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ranked
WHERE row_number > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, type, payload ->> 'phone'
           ORDER BY created_at DESC, id DESC
         ) AS row_number
  FROM change_requests
  WHERE status = 'pending'
    AND type = 'binding'
    AND account_id IS NOT NULL
    AND payload ? 'phone'
)
UPDATE change_requests
SET status = 'duplicate',
    reviewed_at = CURRENT_TIMESTAMP,
    review_note = '系统升级：重复待审核绑定申请，保留最新一条',
    updated_at = CURRENT_TIMESTAMP
FROM ranked
WHERE change_requests.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX "change_requests_one_pending_binding_per_phone"
ON change_requests (account_id, type, (payload ->> 'phone'))
WHERE status = 'pending'
  AND type = 'binding'
  AND account_id IS NOT NULL
  AND payload ? 'phone';
