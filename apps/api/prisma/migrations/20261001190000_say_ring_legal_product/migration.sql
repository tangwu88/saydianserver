ALTER TABLE "CommerceOAuthState"
ADD COLUMN "product" TEXT NOT NULL DEFAULT 'saydian-global';

ALTER TABLE "CommerceWechatBindTicket"
ADD COLUMN "product" TEXT NOT NULL DEFAULT 'saydian-global';
