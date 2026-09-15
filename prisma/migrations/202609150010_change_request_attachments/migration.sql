CREATE TABLE "change_request_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "change_request_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "change_request_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_request_attachments_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_request_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "change_request_attachments_change_request_id_file_id_key" ON "change_request_attachments"("change_request_id", "file_id");
CREATE INDEX "change_request_attachments_file_id_idx" ON "change_request_attachments"("file_id");

INSERT INTO "change_request_attachments" ("change_request_id", "file_id")
SELECT request_row."id", file_row."id"
FROM "change_requests" request_row
JOIN "files" file_row ON file_row."id"::text = request_row."payload"->>'photoFileId'
WHERE COALESCE(request_row."payload"->>'photoFileId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;

INSERT INTO "change_request_attachments" ("change_request_id", "file_id")
SELECT request_row."id", file_row."id"
FROM "change_requests" request_row
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(request_row."payload"->'attachmentIds') = 'array' THEN request_row."payload"->'attachmentIds' ELSE '[]'::jsonb END) attachment("value")
JOIN "files" file_row ON file_row."id"::text = attachment."value"
WHERE attachment."value" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;
