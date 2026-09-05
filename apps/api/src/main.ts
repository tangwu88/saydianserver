import "dotenv/config";
import "reflect-metadata";
import { NestFactory, Reflector } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ApiEnvelopeInterceptor } from "./common/api-envelope.interceptor";
import {
  assertProductionEnvironment,
  env,
  envBoolean,
} from "./common/environment";
import { SafeHttpExceptionFilter } from "./common/http-exception.filter";

async function bootstrap(): Promise<void> {
  assertProductionEnvironment();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.use(
    json({
      limit: "30mb",
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: "2mb" }));
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.enableCors({
    origin: env("CORS_ORIGINS", "http://localhost:5173")
      .split(",")
      .map((value) => value.trim()),
    credentials: true,
    allowedHeaders: [
      "authorization",
      "content-type",
      "idempotency-key",
      "token",
      "x-request-id",
    ],
  });
  app.useGlobalFilters(new SafeHttpExceptionFilter());
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();

  if (envBoolean("ENABLE_PUBLIC_DOCS")) {
    const config = new DocumentBuilder()
      .setTitle("Saydian App API")
      .setDescription("脱敏的 Saydian App V2 与兼容接口说明")
      .setVersion("2.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(env("PORT", "8080"));
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
