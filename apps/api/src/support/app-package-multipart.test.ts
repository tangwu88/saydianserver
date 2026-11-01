import "reflect-metadata";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import type { ExecutionContext, NestInterceptor } from "@nestjs/common";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { of } from "rxjs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AdminController } from "../admin/admin.controller";
import { packageChunkBytes } from "./app-package-uploads";

let server: Server;
let url: string;
beforeAll(async () => {
  // Invoke the actual decorated interceptor, including Nest's own Multer version.
  // A separately imported Multer can have different inclusive size semantics.
  const [Interceptor] = Reflect.getMetadata(INTERCEPTORS_METADATA, AdminController.prototype.uploadAppPackagePart) as Array<new () => NestInterceptor>;
  if (!Interceptor) throw new Error("Production package interceptor missing");
  const interceptor = new Interceptor();
  server = createServer(async (request, response) => {
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ExecutionContext;
    try {
      await interceptor.intercept(context, { handle: () => of(null) });
      const file = (request as Request).file!;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ size: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex") }));
    } catch (error) {
      response.statusCode = (error as { getStatus?: () => number }).getStatus?.() ?? 500;
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

it.each([packageChunkBytes - 1, packageChunkBytes])("accepts a multipart file of %i bytes through the production interceptor", async size => {
  const bytes = Buffer.alloc(size, 0x61);
  const body = new FormData();
  body.append("file", new Blob([bytes]), "package.part");
  const response = await fetch(url, { method: "PUT", body });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ size, sha256: createHash("sha256").update(bytes).digest("hex") });
});

it("rejects even one byte beyond the negotiated chunk size", async () => {
  const body = new FormData();
  body.append("file", new Blob([Buffer.alloc(packageChunkBytes + 1)]), "package.part");
  const response = await fetch(url, { method: "PUT", body });
  expect(response.status).toBe(413);
});
