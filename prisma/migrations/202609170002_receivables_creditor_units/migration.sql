UPDATE "receivable_ledgers"
SET "creditor_unit" = CASE "creditor_unit"
  WHEN '物化院' THEN '山西省地球物理化学勘查院有限公司'
  WHEN '测绘院' THEN '山西省地质测绘院有限公司'
  WHEN '六勘院' THEN '山西省第六地质工程勘察院有限公司'
  WHEN '禹地公司' THEN '山西禹地基础工程有限公司'
  ELSE "creditor_unit"
END
WHERE "creditor_unit" IN ('物化院', '测绘院', '六勘院', '禹地公司');

UPDATE "receivable_dictionary_options" AS source
SET "value" = mapping.full_name
FROM (VALUES
  ('物化院', '山西省地球物理化学勘查院有限公司'),
  ('测绘院', '山西省地质测绘院有限公司'),
  ('六勘院', '山西省第六地质工程勘察院有限公司'),
  ('禹地公司', '山西禹地基础工程有限公司')
) AS mapping(short_name, full_name)
WHERE source."category" = 'unit'
  AND source."value" = mapping.short_name
  AND NOT EXISTS (
    SELECT 1 FROM "receivable_dictionary_options" AS target
    WHERE target."category" = 'unit' AND target."value" = mapping.full_name
  );

DELETE FROM "receivable_dictionary_options" AS source
USING (VALUES
  ('物化院', '山西省地球物理化学勘查院有限公司'),
  ('测绘院', '山西省地质测绘院有限公司'),
  ('六勘院', '山西省第六地质工程勘察院有限公司'),
  ('禹地公司', '山西禹地基础工程有限公司')
) AS mapping(short_name, full_name)
WHERE source."category" = 'unit'
  AND source."value" = mapping.short_name
  AND EXISTS (
    SELECT 1 FROM "receivable_dictionary_options" AS target
    WHERE target."category" = 'unit' AND target."value" = mapping.full_name
  );
