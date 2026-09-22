-- The monthly-report taxonomy is an approved, closed list.  Historical rows
-- retain their referenced type records, while legacy types stop being offered
-- for new reporting.
INSERT INTO "report_project_types" ("id", "name", "sort_order", "active", "updated_at") VALUES
  ('22000000-0000-4000-8000-000000000001', '测绘地理信息', 10, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000002', '钻探', 20, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000003', '物化探', 30, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000004', '水工环', 40, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000005', '矿产探勘', 50, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000006', '土地整治', 60, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000007', '矿山修复', 70, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000008', '生态保护修复', 80, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000009', '煤矿防治', 90, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000010', '污水治理', 100, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000011', '井下施工', 110, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000012', '环境监测', 120, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000013', '生态评估', 130, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000014', '桩基工程', 140, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000015', '基础施工', 150, true, CURRENT_TIMESTAMP),
  ('22000000-0000-4000-8000-000000000016', '其他', 160, true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE
  SET "sort_order" = EXCLUDED."sort_order",
      "active" = true,
      "updated_at" = CURRENT_TIMESTAMP;

UPDATE "report_project_types"
SET "active" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "name" NOT IN (
  '测绘地理信息', '钻探', '物化探', '水工环', '矿产探勘', '土地整治',
  '矿山修复', '生态保护修复', '煤矿防治', '污水治理', '井下施工', '环境监测',
  '生态评估', '桩基工程', '基础施工', '其他'
);
