CREATE UNIQUE INDEX "change_requests_one_pending_account_merge"
  ON "change_requests"("account_id", "type", ("payload" ->> 'targetAccountId'))
  WHERE "status" = 'pending' AND "type" = 'account_merge' AND "account_id" IS NOT NULL;
