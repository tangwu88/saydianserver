-- Existing accounts retain access; admin-created/reset passwords opt in explicitly.
ALTER TABLE "BrandPartner" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
