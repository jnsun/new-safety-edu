ALTER TABLE "persons"
  ALTER COLUMN "national_id_cipher" DROP NOT NULL,
  ALTER COLUMN "national_id_iv" DROP NOT NULL,
  ALTER COLUMN "national_id_tag" DROP NOT NULL,
  ALTER COLUMN "national_id_hash" DROP NOT NULL,
  ALTER COLUMN "national_id_last4" DROP NOT NULL,
  ALTER COLUMN "photo_file_id" DROP NOT NULL;
