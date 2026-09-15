import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");

const parsedDatabaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
assert.ok(parsedDatabaseName.includes("receivables_test"), `Refusing non-test database: ${parsedDatabaseName}`);

const prisma = new PrismaClient();
const expectedTables = [
  "receivable_settings",
  "receivable_departments",
  "receivable_access_grants",
  "receivable_grant_departments",
  "receivable_ledgers",
  "receivable_ledger_revisions",
  "receivable_invoices",
  "receivable_receipts",
  "receivable_attachments",
  "receivable_dictionary_options",
  "receivable_import_batches",
  "receivable_import_items",
  "receivable_export_jobs",
] as const;

try {
  const [{ currentDatabase }] = await prisma.$queryRaw<Array<{ currentDatabase: string }>>`
    SELECT current_database() AS "currentDatabase"
  `;
  assert.ok(currentDatabase.includes("receivables_test"), `Connected to non-test database: ${currentDatabase}`);

  const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tables.map(({ tableName }) => tableName));
  for (const tableName of expectedTables) assert.ok(tableNames.has(tableName), `Missing table: ${tableName}`);

  const indexes = await prisma.$queryRaw<Array<{ indexName: string; indexDefinition: string }>>`
    SELECT indexname AS "indexName", indexdef AS "indexDefinition"
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const indexByName = new Map(indexes.map(({ indexName, indexDefinition }) => [indexName, indexDefinition]));
  assert.match(indexByName.get("receivable_ledgers_contract_no_normalized_key") ?? "", /CREATE UNIQUE INDEX/);
  assert.match(indexByName.get("receivable_access_grants_one_active_account") ?? "", /CREATE UNIQUE INDEX.*WHERE \(active = true\)/);
  for (const name of [
    "receivable_invoices_ledger_id_status_invoice_date_idx",
    "receivable_receipts_ledger_id_status_receipt_date_idx",
  ]) assert.ok(indexByName.has(name), `Missing detail index: ${name}`);

  const checks = await prisma.$queryRaw<Array<{ constraintName: string; definition: string }>>`
    SELECT conname AS "constraintName", pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'c'
  `;
  const checkByName = new Map(checks.map(({ constraintName, definition }) => [constraintName, definition]));
  assert.match(checkByName.get("receivable_invoice_amount_positive") ?? "", /amount.*>.*0/);
  assert.match(checkByName.get("receivable_receipt_amount_positive") ?? "", /amount.*>.*0/);
  assert.match(checkByName.get("receivable_ledger_amounts_nonnegative") ?? "", /contract_amount.*final_amount.*writeoff_amount/);

  const amounts = await prisma.$queryRaw<Array<{ tableName: string; columnName: string; precision: number; scale: number }>>`
    SELECT table_name AS "tableName", column_name AS "columnName",
           numeric_precision::int AS precision, numeric_scale::int AS scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('receivable_ledgers', 'contract_amount'),
        ('receivable_ledgers', 'final_amount'),
        ('receivable_ledgers', 'writeoff_amount'),
        ('receivable_invoices', 'amount'),
        ('receivable_receipts', 'amount')
      )
  `;
  assert.equal(amounts.length, 5, "Missing receivables amount columns");
  for (const amount of amounts) assert.deepEqual([amount.precision, amount.scale], [18, 4], `${amount.tableName}.${amount.columnName} must be NUMERIC(18,4)`);

  const aggregates = await prisma.$queryRaw<Array<{ columnName: string }>>`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'receivable_ledgers'
      AND column_name IN ('invoiced_amount', 'received_amount')
  `;
  assert.equal(aggregates.length, 0, "ReceivableLedger must not store editable invoice or receipt aggregates");

  const lifecycleColumns = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('receivable_ledgers', 'revision'), ('receivable_ledgers', 'status'),
        ('receivable_ledgers', 'voided_at'), ('receivable_ledgers', 'voided_by'), ('receivable_ledgers', 'void_reason'),
        ('receivable_invoices', 'revision'), ('receivable_invoices', 'status'),
        ('receivable_invoices', 'voided_at'), ('receivable_invoices', 'voided_by'), ('receivable_invoices', 'void_reason'),
        ('receivable_receipts', 'revision'), ('receivable_receipts', 'status'),
        ('receivable_receipts', 'voided_at'), ('receivable_receipts', 'voided_by'), ('receivable_receipts', 'void_reason'),
        ('receivable_attachments', 'revision'), ('receivable_attachments', 'status'),
        ('receivable_attachments', 'voided_at'), ('receivable_attachments', 'voided_by'), ('receivable_attachments', 'void_reason'),
        ('receivable_import_batches', 'revision'), ('receivable_import_batches', 'status')
      )
  `;
  assert.equal(lifecycleColumns.length, 22, "Missing revision, status, or void lifecycle columns");

  const foreignKeys = await prisma.$queryRaw<Array<{ tableName: string; constraintName: string; deleteAction: string }>>`
    SELECT conrelid::regclass::text AS "tableName", conname AS "constraintName",
           CASE confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE confdeltype::text END AS "deleteAction"
    FROM pg_constraint
    WHERE contype = 'f' AND conrelid::regclass::text = ANY(${expectedTables as unknown as string[]}::text[])
  `;
  assert.ok(foreignKeys.length > 0, "Missing receivables foreign keys");
  assert.deepEqual(
    foreignKeys.filter(({ deleteAction }) => deleteAction !== "RESTRICT"),
    [],
    "Every receivables foreign key must use ON DELETE RESTRICT",
  );

  console.log("RECEIVABLES_SCHEMA_OK");
} finally {
  await prisma.$disconnect();
}
