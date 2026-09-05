ALTER TABLE "User"
ADD COLUMN "wechatAppOpenId" TEXT;

CREATE UNIQUE INDEX "User_wechatAppOpenId_key"
ON "User"("wechatAppOpenId");

INSERT INTO "IntegrationConfig" (
  "id",
  "key",
  "state",
  "publicConfig",
  "updatedAt"
)
VALUES (
  '9952cc07-f04f-4eb6-bf04-3b9dd618ed95',
  'wechat_login',
  'UNCONFIGURED',
  '{"provider":"wechat_open_platform","appId":null}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
