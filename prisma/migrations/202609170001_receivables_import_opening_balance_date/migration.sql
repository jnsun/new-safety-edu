ALTER TABLE "receivable_import_batches"
ADD COLUMN "opening_balance_date" DATE,
ADD COLUMN "column_mappings" JSONB;
