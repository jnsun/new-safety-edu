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

type IndexFact = {
  indexName: string;
  tableName: string;
  unique: boolean;
  columns: string[];
  predicate: string | null;
};

type CheckFact = {
  constraintName: string;
  tableName: string;
  expression: string;
};

type ForeignKeyFact = {
  constraintName: string;
  tableName: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  deleteAction: string;
};

function assertExactIndex(indexes: IndexFact[], expected: IndexFact): void {
  const actual = indexes.find(({ indexName }) => indexName === expected.indexName);
  assert.ok(actual, `Missing index: ${expected.indexName}`);
  assert.equal(actual.unique, expected.unique, `Wrong uniqueness: ${expected.indexName}`);
  assert.equal(actual.tableName, expected.tableName, `Wrong index table or columns: ${expected.indexName}`);
  assert.deepEqual(actual.columns, expected.columns, `Wrong index table or columns: ${expected.indexName}`);
  assert.equal(normalizeSql(actual.predicate), normalizeSql(expected.predicate), `Wrong index predicate: ${expected.indexName}`);
}

function assertExactCheck(checks: CheckFact[], expected: CheckFact): void {
  const actual = checks.find(({ constraintName }) => constraintName === expected.constraintName);
  assert.ok(actual, `Missing CHECK: ${expected.constraintName}`);
  assert.equal(actual.tableName, expected.tableName, `Wrong CHECK table: ${expected.constraintName}`);
  assert.equal(normalizeSql(actual.expression), normalizeSql(expected.expression), `Wrong CHECK expression: ${expected.constraintName}`);
}

function assertExactForeignKeys(actual: ForeignKeyFact[], expected: ForeignKeyFact[]): void {
  assert.equal(actual.length, expected.length, "Wrong number of receivables foreign keys");
  const actualByName = new Map(actual.map((foreignKey) => [foreignKey.constraintName, foreignKey]));
  for (const expectedForeignKey of expected) {
    const actualForeignKey = actualByName.get(expectedForeignKey.constraintName);
    assert.ok(actualForeignKey, `Missing foreign key: ${expectedForeignKey.constraintName}`);
    assert.deepEqual(actualForeignKey, expectedForeignKey, `Wrong foreign key: ${expectedForeignKey.constraintName}`);
  }
}

function normalizeSql(expression: string | null): string | null {
  return expression?.toLowerCase().replace(/"/g, "").replace(/\s+/g, "") ?? null;
}

assert.throws(
  () => assertExactIndex([{
    indexName: "receivable_ledgers_contract_no_normalized_key",
    tableName: "wrong_table",
    unique: true,
    columns: ["wrong_column"],
    predicate: null,
  }], {
    indexName: "receivable_ledgers_contract_no_normalized_key",
    tableName: "receivable_ledgers",
    unique: true,
    columns: ["contract_no_normalized"],
    predicate: null,
  }),
  /Wrong index table or columns/,
);

assert.throws(
  () => assertExactIndex([{
    indexName: "receivable_access_grants_one_active_account",
    tableName: "receivable_access_grants",
    unique: true,
    columns: ["account_id"],
    predicate: "active = false",
  }], {
    indexName: "receivable_access_grants_one_active_account",
    tableName: "receivable_access_grants",
    unique: true,
    columns: ["account_id"],
    predicate: "active = true",
  }),
  /Wrong index predicate/,
);

assert.throws(
  () => assertExactCheck([{
    constraintName: "receivable_invoice_amount_positive",
    tableName: "receivable_invoices",
    expression: "amount >= 0",
  }], {
    constraintName: "receivable_invoice_amount_positive",
    tableName: "receivable_invoices",
    expression: "amount > 0",
  }),
  /Wrong CHECK expression/,
);

assert.throws(
  () => assertExactForeignKeys([{
    constraintName: "receivable_invoices_ledger_id_fkey",
    tableName: "receivable_invoices",
    sourceColumns: ["ledger_id"],
    targetTable: "wrong_table",
    targetColumns: ["id"],
    deleteAction: "CASCADE",
  }], [{
    constraintName: "receivable_invoices_ledger_id_fkey",
    tableName: "receivable_invoices",
    sourceColumns: ["ledger_id"],
    targetTable: "receivable_ledgers",
    targetColumns: ["id"],
    deleteAction: "RESTRICT",
  }]),
  /Wrong foreign key/,
);

const expectedIndexes: IndexFact[] = [
  { indexName: "receivable_ledgers_contract_no_normalized_key", tableName: "receivable_ledgers", unique: true, columns: ["contract_no_normalized"], predicate: null },
  { indexName: "receivable_access_grants_one_active_account", tableName: "receivable_access_grants", unique: true, columns: ["account_id"], predicate: "(active = true)" },
  { indexName: "receivable_invoices_ledger_id_status_invoice_date_idx", tableName: "receivable_invoices", unique: false, columns: ["ledger_id", "status", "invoice_date"], predicate: null },
  { indexName: "receivable_receipts_ledger_id_status_receipt_date_idx", tableName: "receivable_receipts", unique: false, columns: ["ledger_id", "status", "receipt_date"], predicate: null },
];

const expectedChecks: CheckFact[] = [
  { constraintName: "receivable_invoice_amount_positive", tableName: "receivable_invoices", expression: "(amount > (0)::numeric)" },
  { constraintName: "receivable_receipt_amount_positive", tableName: "receivable_receipts", expression: "(amount > (0)::numeric)" },
  {
    constraintName: "receivable_ledger_amounts_nonnegative",
    tableName: "receivable_ledgers",
    expression: "(((contract_amount IS NULL) OR (contract_amount >= (0)::numeric)) AND ((final_amount IS NULL) OR (final_amount >= (0)::numeric)) AND (writeoff_amount >= (0)::numeric))",
  },
];

const expectedForeignKeys: ForeignKeyFact[] = [
  { constraintName: "receivable_settings_finance_organization_id_fkey", tableName: "receivable_settings", sourceColumns: ["finance_organization_id"], targetTable: "organizations", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_settings_configuration_confirmed_by_fkey", tableName: "receivable_settings", sourceColumns: ["configuration_confirmed_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_departments_deactivated_by_fkey", tableName: "receivable_departments", sourceColumns: ["deactivated_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_access_grants_account_id_fkey", tableName: "receivable_access_grants", sourceColumns: ["account_id"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_access_grants_granted_by_fkey", tableName: "receivable_access_grants", sourceColumns: ["granted_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_access_grants_revoked_by_fkey", tableName: "receivable_access_grants", sourceColumns: ["revoked_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_grant_departments_grant_id_fkey", tableName: "receivable_grant_departments", sourceColumns: ["grant_id"], targetTable: "receivable_access_grants", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_grant_departments_finance_department_id_fkey", tableName: "receivable_grant_departments", sourceColumns: ["finance_department_id"], targetTable: "receivable_departments", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_dictionary_options_deactivated_by_fkey", tableName: "receivable_dictionary_options", sourceColumns: ["deactivated_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_batches_original_file_id_fkey", tableName: "receivable_import_batches", sourceColumns: ["original_file_id"], targetTable: "files", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_batches_requested_by_fkey", tableName: "receivable_import_batches", sourceColumns: ["requested_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_batches_applied_by_fkey", tableName: "receivable_import_batches", sourceColumns: ["applied_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_batches_rolled_back_by_fkey", tableName: "receivable_import_batches", sourceColumns: ["rolled_back_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledgers_finance_department_id_fkey", tableName: "receivable_ledgers", sourceColumns: ["finance_department_id"], targetTable: "receivable_departments", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledgers_voided_by_fkey", tableName: "receivable_ledgers", sourceColumns: ["voided_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledgers_created_by_fkey", tableName: "receivable_ledgers", sourceColumns: ["created_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledgers_updated_by_fkey", tableName: "receivable_ledgers", sourceColumns: ["updated_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledgers_created_by_import_batch_id_fkey", tableName: "receivable_ledgers", sourceColumns: ["created_by_import_batch_id"], targetTable: "receivable_import_batches", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledger_revisions_ledger_id_fkey", tableName: "receivable_ledger_revisions", sourceColumns: ["ledger_id"], targetTable: "receivable_ledgers", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledger_revisions_changed_by_fkey", tableName: "receivable_ledger_revisions", sourceColumns: ["changed_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_ledger_revisions_import_batch_id_fkey", tableName: "receivable_ledger_revisions", sourceColumns: ["import_batch_id"], targetTable: "receivable_import_batches", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_invoices_ledger_id_fkey", tableName: "receivable_invoices", sourceColumns: ["ledger_id"], targetTable: "receivable_ledgers", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_invoices_voided_by_fkey", tableName: "receivable_invoices", sourceColumns: ["voided_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_invoices_created_by_fkey", tableName: "receivable_invoices", sourceColumns: ["created_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_receipts_ledger_id_fkey", tableName: "receivable_receipts", sourceColumns: ["ledger_id"], targetTable: "receivable_ledgers", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_receipts_voided_by_fkey", tableName: "receivable_receipts", sourceColumns: ["voided_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_receipts_created_by_fkey", tableName: "receivable_receipts", sourceColumns: ["created_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_attachments_ledger_id_fkey", tableName: "receivable_attachments", sourceColumns: ["ledger_id"], targetTable: "receivable_ledgers", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_attachments_file_id_fkey", tableName: "receivable_attachments", sourceColumns: ["file_id"], targetTable: "files", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_attachments_uploaded_by_fkey", tableName: "receivable_attachments", sourceColumns: ["uploaded_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_attachments_voided_by_fkey", tableName: "receivable_attachments", sourceColumns: ["voided_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_items_batch_id_fkey", tableName: "receivable_import_items", sourceColumns: ["batch_id"], targetTable: "receivable_import_batches", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_import_items_ledger_id_fkey", tableName: "receivable_import_items", sourceColumns: ["ledger_id"], targetTable: "receivable_ledgers", targetColumns: ["id"], deleteAction: "RESTRICT" },
  { constraintName: "receivable_export_jobs_requested_by_fkey", tableName: "receivable_export_jobs", sourceColumns: ["requested_by"], targetTable: "accounts", targetColumns: ["id"], deleteAction: "RESTRICT" },
];

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

  const indexes = await prisma.$queryRaw<IndexFact[]>`
    SELECT index_relation.relname AS "indexName",
           table_relation.relname AS "tableName",
           index_catalog.indisunique AS "unique",
           ARRAY(
             SELECT attribute.attname
             FROM unnest(index_catalog.indkey) WITH ORDINALITY AS index_key(attribute_number, ordinal_position)
             JOIN pg_attribute attribute
               ON attribute.attrelid = index_catalog.indrelid
              AND attribute.attnum = index_key.attribute_number
             WHERE index_key.ordinal_position <= index_catalog.indnkeyatts
             ORDER BY index_key.ordinal_position
           ) AS columns,
           pg_get_expr(index_catalog.indpred, index_catalog.indrelid) AS predicate
    FROM pg_index index_catalog
    JOIN pg_class index_relation ON index_relation.oid = index_catalog.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_catalog.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'public'
  `;
  for (const expectedIndex of expectedIndexes) assertExactIndex(indexes, expectedIndex);

  const checks = await prisma.$queryRaw<CheckFact[]>`
    SELECT constraint_catalog.conname AS "constraintName",
           table_relation.relname AS "tableName",
           pg_get_expr(constraint_catalog.conbin, constraint_catalog.conrelid) AS expression
    FROM pg_constraint constraint_catalog
    JOIN pg_class table_relation ON table_relation.oid = constraint_catalog.conrelid
    JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
    WHERE constraint_catalog.contype = 'c' AND namespace.nspname = 'public'
  `;
  for (const expectedCheck of expectedChecks) assertExactCheck(checks, expectedCheck);

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

  const foreignKeys = await prisma.$queryRaw<ForeignKeyFact[]>`
    SELECT constraint_catalog.conname AS "constraintName",
           source_table.relname AS "tableName",
           ARRAY(
             SELECT source_attribute.attname
             FROM unnest(constraint_catalog.conkey) WITH ORDINALITY AS source_key(attribute_number, ordinal_position)
             JOIN pg_attribute source_attribute
               ON source_attribute.attrelid = constraint_catalog.conrelid
              AND source_attribute.attnum = source_key.attribute_number
             ORDER BY source_key.ordinal_position
           ) AS "sourceColumns",
           target_table.relname AS "targetTable",
           ARRAY(
             SELECT target_attribute.attname
             FROM unnest(constraint_catalog.confkey) WITH ORDINALITY AS target_key(attribute_number, ordinal_position)
             JOIN pg_attribute target_attribute
               ON target_attribute.attrelid = constraint_catalog.confrelid
              AND target_attribute.attnum = target_key.attribute_number
             ORDER BY target_key.ordinal_position
           ) AS "targetColumns",
           CASE constraint_catalog.confdeltype
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE constraint_catalog.confdeltype::text
           END AS "deleteAction"
    FROM pg_constraint constraint_catalog
    JOIN pg_class source_table ON source_table.oid = constraint_catalog.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source_table.relnamespace
    JOIN pg_class target_table ON target_table.oid = constraint_catalog.confrelid
    WHERE constraint_catalog.contype = 'f'
      AND namespace.nspname = 'public'
      AND source_table.relname = ANY(${expectedTables as unknown as string[]}::text[])
  `;
  assertExactForeignKeys(foreignKeys, expectedForeignKeys);

  console.log("RECEIVABLES_SCHEMA_OK");
} finally {
  await prisma.$disconnect();
}
