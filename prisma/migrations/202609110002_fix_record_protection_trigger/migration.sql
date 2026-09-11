CREATE OR REPLACE FUNCTION "protect_final_business_records"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'training_assignments' THEN
    IF OLD."status" = 'completed' AND NEW."status" <> 'completed' THEN
      RAISE EXCEPTION 'completed training assignments cannot regress';
    END IF;
  ELSIF TG_TABLE_NAME = 'exam_attempts' THEN
    IF OLD."status" = 'submitted' THEN
      RAISE EXCEPTION 'submitted exam attempts are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'courseware_versions' THEN
    IF OLD."status" = 'published' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
      RAISE EXCEPTION 'published courseware versions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
