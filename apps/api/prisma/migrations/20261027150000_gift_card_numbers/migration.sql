-- A database-generated management number; original references and credentials stay intact.
ALTER TABLE "CommerceGiftCard" ADD COLUMN "number" SERIAL NOT NULL;
CREATE UNIQUE INDEX "CommerceGiftCard_number_key" ON "CommerceGiftCard"("number");
