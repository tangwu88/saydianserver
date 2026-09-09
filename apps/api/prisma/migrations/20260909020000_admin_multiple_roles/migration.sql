ALTER TABLE "AdminUser" ADD COLUMN "roles" "AdminRole"[] NOT NULL DEFAULT ARRAY[]::"AdminRole"[];
UPDATE "AdminUser" SET "roles" = ARRAY["role"];
