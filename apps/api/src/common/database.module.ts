import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { IntegrationSecretsService } from "./integration-secrets.service";

@Global()
@Module({
  providers: [PrismaService, IntegrationSecretsService],
  exports: [PrismaService, IntegrationSecretsService],
})
export class DatabaseModule {}
