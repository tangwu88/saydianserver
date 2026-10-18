-- Existing contact relationships keep their original visibility. This candidate
-- is deliberately NOT approved in deploy/compatible-migrations.json.
CREATE TYPE "CareIdentityDisclosure" AS ENUM ('CONTACT', 'MEMBER_NO_PENDING', 'MEMBER_NO_ACCEPTED');
ALTER TABLE "CareRelationship" ADD COLUMN "identityDisclosure" "CareIdentityDisclosure" NOT NULL DEFAULT 'CONTACT';
