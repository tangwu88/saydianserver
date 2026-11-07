import { Module } from "@nestjs/common";
import { HealthScreenService } from "./health-screen.service";
@Module({ providers: [HealthScreenService], exports: [HealthScreenService] })
export class HealthScreenModule {}
