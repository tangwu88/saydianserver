-- CreateTable
CREATE TABLE "SupportGuest" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "userId" UUID,
    "guestId" UUID,
    "locale" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ai',
    "assignedAdminId" UUID,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerSeq" INTEGER NOT NULL DEFAULT 0,
    "lastReplySeq" INTEGER NOT NULL DEFAULT 0,
    "customerReadSeq" INTEGER NOT NULL DEFAULT 0,
    "staffReadSeq" INTEGER NOT NULL DEFAULT 0,
    "guestDiagnostic" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "clientMessageId" UUID,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sources" JSONB,
    "aiRunId" UUID,
    "aiAvailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportGuest_tokenHash_key" ON "SupportGuest"("tokenHash");

-- CreateIndex
CREATE INDEX "SupportGuest_expiresAt_idx" ON "SupportGuest"("expiresAt");

-- CreateIndex
CREATE INDEX "SupportConversation_product_userId_updatedAt_idx" ON "SupportConversation"("product", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportConversation_product_guestId_updatedAt_idx" ON "SupportConversation"("product", "guestId", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportConversation_product_state_updatedAt_idx" ON "SupportConversation"("product", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportMessage_aiAvailableAt_idx" ON "SupportMessage"("aiAvailableAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_seq_key" ON "SupportMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_clientMessageId_key" ON "SupportMessage"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAttachment_messageId_key" ON "SupportAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "SupportGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
