import { describe, expect, it, vi } from "vitest";
import { apiCatalog } from "@saydian/app-contracts";
import { documentedExample, generateOpenApi, openApiPath } from "./openapi";
import { ApiDocumentationService } from "./api-documentation.service";

describe("field-aware OpenAPI and examples", () => {
  it("converts all Nest path parameters and does not emit wildcard query parameters", () => {
    const spec = generateOpenApi(
      apiCatalog.routes.map((route) => ({ ...route })),
      "test",
    );
    for (const [path, methods] of Object.entries(spec.paths)) {
      expect(path).not.toMatch(/:\w/);
      for (const operation of Object.values(methods as Record<string, any>)) {
        for (const match of path.matchAll(/\{([^}]+)\}/g)) {
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({
              in: "path",
              name: match[1],
              required: true,
            }),
          );
        }
        expect(operation.parameters.some((p: any) => p.name === "*")).toBe(
          false,
        );
      }
    }
    expect(openApiPath("/orders/:id/items/:itemId")).toBe(
      "/orders/{id}/items/{itemId}",
    );
  });
  it("exports the actual password-reset body and minimum typed session, without a missing request.json", () => {
    const route = apiCatalog.routes.find(
      (route) => route.key === "AuthController.resetPassword",
    )!;
    const example = documentedExample(route);
    expect(example.curl).toContain("--data-raw");
    expect(example.curl).not.toContain("@request.json");
    expect(example.请求体).toEqual(
      expect.objectContaining({
        mobile: "<TEST_MOBILE>",
        code: "<SMS_CODE>",
        password: "<NEW_TEST_PASSWORD>",
      }),
    );
    const operation = generateOpenApi([{ ...route }], "test").paths[route.path]
      .post;
    const alternatives =
      operation.requestBody.content["application/json"].schema.anyOf;
    expect(alternatives[0].required).toContain("mobile");
    expect(alternatives[1].required).toEqual([
      "challengeId",
      "code",
      "password",
    ]);
    expect(
      operation.responses["201"].content["application/json"].schema.properties
        .data.required,
    ).toContain("refreshToken");
  });
  it("records multipart names, legacy token auth and HTTP-200 business errors", () => {
    const route = apiCatalog.routes.find(
      (route) => route.key === "LegacyCartController.create",
    )!;
    const example = documentedExample(route);
    expect(example.curl).toContain("--form-string 'sku_id=101'");
    const operation = generateOpenApi([{ ...route }], "test").paths[route.path]
      .post;
    expect(
      operation.requestBody.content["multipart/form-data"].schema.required,
    ).toEqual(["sku_id", "num"]);
    expect(operation.responses["200"].description).toMatch(/业务code/);
    expect(operation.security).toContainEqual({ legacyToken: [] });
  });
  it("does not manufacture executable examples for unknown schemas", () => {
    const unknown = {
      method: "POST",
      path: "/test",
      parameters: [{ in: "body" }],
      contract: { status: "unreviewed" },
    };
    expect(documentedExample(unknown).curl).toBeNull();
    expect(
      generateOpenApi([unknown], "test").paths["/test"].post[
        "x-saydian-field-status"
      ],
    ).toBe("unreviewed");
  });
  it("exports PDF and image downloads as raw bytes, never fabricated JSON objects", () => {
    for (const [key, mediaTypes] of [
      ["HealthReportsController.export", ["application/pdf"]],
      ["FilesController.download", ["image/jpeg", "image/png", "image/webp"]],
    ] as const) {
      const route = apiCatalog.routes.find((item) => item.key === key)!;
      // A stale saved generic object contract must not override controller-level response evidence.
      const stale = {
        ...route,
        contract: {
          responseSchema: { type: "object" },
          responseExample: { ok: true },
        },
      };
      const operation = generateOpenApi([stale], "test").paths[
        openApiPath(route.path)
      ].get;
      const content = operation.responses["200"].content;
      expect(Object.keys(content)).toEqual(mediaTypes);
      for (const mediaType of mediaTypes) {
        expect(content[mediaType].schema).toMatchObject({
          type: "string",
          format: "binary",
        });
        expect(content[mediaType]).not.toHaveProperty("example");
        expect(content[mediaType].schema).not.toHaveProperty("properties");
      }
      expect(
        operation.responses["404"].content["application/json"],
      ).toBeDefined();
      expect(documentedExample(stale).返回示例).toBeNull();
    }
  });
  it("exports both Alipay acknowledgements as text/plain success without a JSON envelope", () => {
    for (const key of [
      "BillingController.alipayNotify",
      "CommerceCompatibilityController.alipayNotify",
    ]) {
      const route = apiCatalog.routes.find((item) => item.key === key)!;
      const operation = generateOpenApi([{ ...route }], "test").paths[
        route.path
      ].post;
      expect(operation.responses["200"].content).toEqual({
        "text/plain": {
          schema: { type: "string", const: "success" },
          example: "success",
        },
      });
      expect(documentedExample(route).返回示例).toBe("success");
    }
  });
  it("exports both private after-sale readers as authenticated raw image bytes even with stale annotations", () => {
    for (const [key, path, auth] of [
      [
        "CommerceEvidenceController.image",
        "/api/saidian-mall/v1/storefront/after-sale-images/:id",
        "member",
      ],
      [
        "AppCommerceEvidenceController.image",
        "/api/saydian-app/v2/commerce/after-sale-images/:id",
        "member",
      ],
      [
        "AdminCommerceEvidenceController.image",
        "/api/saydian-app/admin/v1/commerce-after-sales/:saleId/evidence/:fileId",
        "admin",
      ],
    ]) {
      const route = {
        key,
        path,
        auth,
        method: "GET",
        envelope: "raw-or-legacy",
        successStatus: 200,
        contract: {
          responseSchema: { type: "object" },
          responseExample: { url: "https://example.invalid/not-public" },
        },
      };
      const operation = generateOpenApi([route], "test").paths[
        openApiPath(path!)
      ].get;
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(Object.keys(operation.responses["200"].content)).toEqual([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);
      expect(operation.responses["200"].content).not.toHaveProperty(
        "application/json",
      );
      for (const value of Object.values(
        operation.responses["200"].content,
      ) as any[]) {
        expect(value.schema).toMatchObject({
          type: "string",
          format: "binary",
        });
        expect(value).not.toHaveProperty("example");
      }
      for (const status of [401, 403, 404, 503])
        expect(
          operation.responses[String(status)].content["application/json"],
        ).toBeDefined();
      expect(documentedExample(route).返回示例).toBeNull();
      expect(documentedExample(route).返回类型).toEqual([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);
    }
  });
  it("uploads reviewed binary multipart fields with curl --form while retaining text field semantics", () => {
    const route = {
      key: "CommerceEvidenceController.upload",
      path: "/api/saidian-mall/v1/storefront/after-sale-images",
      method: "POST",
      auth: "member",
      envelope: "raw-or-legacy",
      parameters: [{ in: "file", name: "file" }],
      contract: {
        contentType: "multipart/form-data",
        requestSchema: {
          type: "object",
          required: ["file"],
          properties: {
            file: { type: "string", format: "binary" },
            label: { type: "string" },
          },
        },
        requestExample: {
          file: "<LOCAL_JPEG_PNG_WEBP_FILE>",
          label: "@literal-label",
        },
        responseSchema: {
          type: "object",
          required: ["id", "byteSize", "contentType", "sha256"],
        },
        responseExample: null,
      },
    };
    const operation = generateOpenApi([route], "test").paths[route.path].post;
    expect(
      operation.requestBody.content["multipart/form-data"].schema.properties
        .file,
    ).toEqual({ type: "string", format: "binary" });
    expect(
      operation.responses["201"].content["application/json"].schema.required,
    ).toEqual(["id", "byteSize", "contentType", "sha256"]);
    const example = documentedExample(route);
    expect(example.curl).toContain("--form 'file=@<LOCAL_JPEG_PNG_WEBP_FILE>'");
    expect(example.curl).toContain("--form-string 'label=@literal-label'");
    expect(example.curl).not.toContain("--form-string 'file=");
    expect(example.curl).toContain("Authorization: Bearer <ACCESS_TOKEN>");
    route.contract.requestExample.file = "synthetic person's photo.jpg";
    expect(documentedExample(route).curl).toContain(
      "--form 'file=@synthetic person'\\''s photo.jpg'",
    );
  });
  it("round-trips password schemas and synthetic placeholders while redacting actual credentials", async () => {
    const saved = vi.fn().mockImplementation(async (args) => args.create);
    const service = new ApiDocumentationService({
      apiDocumentationAnnotation: { upsert: saved },
    } as any);
    const input = {
      请求体: {
        password: "<TEST_PASSWORD>",
        authorization: "Bearer <ACCESS_TOKEN>",
        mobile: "<TEST_MOBILE>",
      },
      请求Schema: {
        type: "object",
        required: ["password"],
        properties: {
          password: {
            type: "string",
            minLength: 12,
            example: "<TEST_PASSWORD>",
          },
        },
      },
      standalone: {
        password: {
          type: "string",
          format: "password",
          default: "actual-password",
        },
      },
      actual: {
        password: "actual-password",
        accessToken: "actual-token",
        authorization: "Bearer actual-token",
        mobile: "13812345678",
      },
    };
    const result = (await service.update(
      "admin",
      "AuthController.resetPassword",
      { businessExample: input },
    )) as any;
    expect(result.businessExample.请求体).toEqual(input.请求体);
    expect(result.businessExample.请求Schema).toEqual(input.请求Schema);
    expect(result.businessExample.standalone.password).toEqual({
      type: "string",
      format: "password",
      default: "***",
    });
    expect(result.businessExample.actual).toEqual({
      password: "***",
      accessToken: "***",
      authorization: "***",
      mobile: "***",
    });
    const generated = documentedExample(
      apiCatalog.routes.find(
        (route) => route.key === "AuthController.resetPassword",
      )!,
    );
    const second = (await service.update(
      "admin",
      "AuthController.resetPassword",
      { businessExample: generated },
    )) as any;
    expect(second.businessExample.请求Schema).toEqual(generated.请求Schema);
    expect(second.businessExample.请求体).toEqual(generated.请求体);
  });
});
