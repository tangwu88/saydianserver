import { describe, expect, it } from "vitest";
import { documentedExample, generateOpenApi } from "./openapi";

describe("H5 field-authored query export", () => {
  it("expands reviewed @Query object fields without wildcard or duplicate parameters", () => {
    const route = {
      key: "CommerceEmployeeController.dashboard", method: "GET", path: "/api/saidian-mall/v1/wecom/me/dashboard",
      auth: "employee", envelope: "raw-or-legacy", successStatus: 200,
      parameters: [{ in: "query", name: "*", type: "EmployeeDashboardQuery", optional: false },
        { in: "query", name: "page", type: "string", optional: true }],
      contract: { status: "request-reviewed", query: {
        range: { schema: { enum: ["month", "custom"] }, required: false, example: "custom" },
        from: { schema: { type: "string" }, required: false, example: "2026-09-08" },
        to: { schema: { type: "string" }, required: false, example: "2026-09-08" },
        page: { schema: { type: "integer", minimum: 1 }, required: false, example: 1 },
      }, responseSchema: { type: "object", properties: { trend: { type: "null" } } }, responseExample: { trend: null } },
    };
    const operation = generateOpenApi([route], "h5-contract-test").paths[route.path].get;
    expect(operation.parameters).toHaveLength(4);
    expect(operation.parameters.filter((parameter: any) => parameter.name === "page")).toHaveLength(1);
    expect(operation.parameters).not.toContainEqual(expect.objectContaining({ name: "*" }));
    expect(operation.parameters).toContainEqual({ in: "query", name: "range", required: false,
      schema: { enum: ["month", "custom"] }, example: "custom" });
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "page", schema: { type: "integer", minimum: 1 } }));
    expect(operation.responses["200"].content["application/json"].example).toEqual({ trend: null });
    expect(documentedExample(route).curl).toContain("range=custom&from=2026-09-08&to=2026-09-08&page=1");
  });
});
