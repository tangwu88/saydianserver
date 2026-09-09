type Json = Record<string, any>;

export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

const errorSchema = {
  type: "object", required: ["code", "message", "data", "timestamp"],
  properties: { code: { type: "integer" }, message: { type: "string" }, data: { type: ["object", "null"] }, timestamp: { type: "integer" }, requestId: { type: "string" } },
};

/** Verified controller responses that bypass the JSON envelope. File MIME is stored with the avatar. */
function rawResponseContract(route: Json): { mediaTypes: string[]; schema: Json; example?: unknown } | undefined {
  const key = String(route.routeKey ?? route.key);
  if (key === "HealthReportsController.export") return { mediaTypes: ["application/pdf"], schema: { type: "string", format: "binary" } };
  if (key === "FilesController.download") return { mediaTypes: ["image/jpeg", "image/png", "image/webp"], schema: { type: "string", format: "binary", description: "原始头像文件字节；Content-Type 取决于已保存文件，不含JSON包裹" } };
  if (["BillingController.alipayNotify", "CommerceCompatibilityController.alipayNotify"].includes(key)) {
    return { mediaTypes: ["text/plain"], schema: { type: "string", const: "success" }, example: "success" };
  }
  return undefined;
}

export function generateOpenApi(items: Json[], version: string) {
  const paths: Json = {};
  for (const route of items) {
    const path = openApiPath(String(route.path));
    const method = String(route.method).toLowerCase();
    const contract = route.contract ?? {};
    const raw = rawResponseContract(route);
    const legacy = /^\/api\/(v1|rf-article|inv-shop\/v1)\//.test(path);
    const envelope = !raw && (legacy || route.envelope === "v2");
    const parameters: Json[] = [];
    for (const match of path.matchAll(/\{([^}]+)\}/g)) {
      parameters.push({ name: match[1], in: "path", required: true, schema: { type: "string" }, description: "资源标识；旧接口保留来源整数ID，新接口通常为UUID" });
    }
    for (const parameter of (route.parameters ?? []) as Json[]) {
      if (!["query", "header"].includes(parameter.in) || parameter.name === "*" || parameter.name.toLowerCase() === "authorization") continue;
      const documented = contract.query?.[parameter.name];
      parameters.push({ name: parameter.name, in: parameter.in, required: documented?.required ?? !parameter.optional,
        schema: documented?.schema ?? { type: parameter.type === "number" ? "number" : "string" },
        ...(documented?.example !== undefined ? { example: documented.example } : {}),
      });
    }
    // @Query() object parameters have no individual decorator names. Export
    // only explicitly reviewed fields, preserving named parameters without duplicates.
    for (const [name, documented] of Object.entries(contract.query ?? {}) as Array<[string, Json]>) {
      if (name === "*" || parameters.some(parameter => parameter.in === "query" && parameter.name === name)) continue;
      parameters.push({ name, in: "query", required: documented.required ?? false,
        schema: documented.schema ?? { type: "string" },
        ...(documented.example !== undefined ? { example: documented.example } : {}),
      });
    }
    const dataSchema = raw?.schema ?? contract.responseSchema ?? {};
    const successSchema = envelope ? { type: "object", required: ["code", "message", "data"], properties: {
      code: { const: 200 }, message: { type: "string" }, data: dataSchema,
      ...(!legacy ? { timestamp: { type: "integer" }, requestId: { type: "string" } } : {}),
    } } : dataSchema;
    const successStatus = String(route.successStatus ?? (method === "post" ? 201 : 200));
    const responseExample = raw ? raw.example : contract.responseExample === null || contract.responseExample === undefined ? undefined
      : envelope ? { code: 200, message: "OK", data: contract.responseExample, ...(!legacy ? { timestamp: 1_788_825_600, requestId: "contract-example" } : {}) } : contract.responseExample;
    const responses: Json = {
      [successStatus]: { description: `成功：${route.response ?? "见业务说明"}`, content: Object.fromEntries((raw?.mediaTypes ?? ["application/json"]).map((mediaType) => [mediaType, { schema: successSchema, ...(responseExample !== undefined ? { example: responseExample } : {}) }])) },
    };
    if (legacy) {
      // The exception filter intentionally wraps legacy failures in HTTP 200.
      const schema = successStatus === "200" ? { anyOf: [successSchema, errorSchema] } : errorSchema;
      responses["200"] = { description: "旧响应：必须检查业务code；失败也使用HTTP 200，不能只检查HTTP状态", content: { "application/json": { schema } } };
    } else {
      for (const status of [400, ...(route.auth === "public" ? [] : [401, 403]), 404, 409, 429, 503]) {
        responses[String(status)] = { description: ({ 400: "参数或业务校验失败", 401: "登录失效", 403: "权限不足", 404: "资源不存在", 409: "状态、版本或幂等冲突", 429: "请求过于频繁", 503: "依赖未配置或暂不可用" } as Json)[status], content: { "application/json": { schema: errorSchema } } };
      }
    }
    const hasBody = (route.parameters ?? []).some((item: Json) => ["body", "file"].includes(item.in));
    const operation: Json = {
      operationId: String(route.routeKey ?? route.key).replaceAll(".", "_"), summary: route.title ?? route.summary,
      description: `${route.summary ?? ""}\n\n${contract.note ?? "字段尚待复核"}`,
      tags: route.tags?.length ? route.tags : [String(route.auth)], deprecated: route.deprecated === true,
      security: route.auth === "public" ? [] : legacy ? [{ bearerAuth: [] }, { legacyToken: [] }] : [{ bearerAuth: [] }],
      parameters, responses,
      "x-saydian-field-status": contract.status ?? "unreviewed",
      "x-saydian-request-notes": route.request,
      "x-saydian-dependency": route.dependency,
      "x-saydian-error-guidance": route.errorGuidance,
    };
    if (hasBody) {
      operation.requestBody = { required: true, description: route.request, content: {
        [contract.contentType ?? "application/json"]: { schema: contract.requestSchema ?? { type: "object", additionalProperties: true, description: "未复核字段，不可据此判定兼容" },
          ...(contract.requestExample ? { example: contract.requestExample } : {}),
        },
      } };
    }
    (paths[path] ??= {})[method] = operation;
  }
  return { openapi: "3.1.0", info: { title: "Saydian赛电 API", version }, servers: [{ url: "/" }], paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" }, legacyToken: { type: "apiKey", in: "header", name: "token", description: "旧App兼容令牌头" } } },
  };
}

export function documentedExample(route: Json) {
  const contract = route.contract ?? {};
  const raw = rawResponseContract(route);
  const authHeader = route.auth === "public" ? "" : ' -H "Authorization: Bearer <ACCESS_TOKEN>"';
  const needsBody = (route.parameters ?? []).some((item: Json) => ["body", "file"].includes(item.in));
  const hasExample = contract.requestExample !== null && contract.requestExample !== undefined;
  const contentType = contract.contentType ?? "application/json";
  const body = !needsBody ? "" : !hasExample ? null : contentType === "multipart/form-data"
    ? Object.entries(contract.requestExample).map(([key, value]) => ` --form-string '${key}=${String(value)}'`).join("")
    : ` -H "Content-Type: application/json" --data-raw '${JSON.stringify(contract.requestExample).replaceAll("'", "'\\''")}'`;
  const query = Object.entries(contract.query ?? {}).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String((value as Json).example))}`).join("&");
  const url = `{{baseUrl}}${openApiPath(route.path)}${query ? `?${query}` : ""}`;
  const idempotency = /Idempotency-Key/i.test(route.request) ? ' -H "Idempotency-Key: <UNIQUE_OPERATION_KEY>"' : "";
  return {
    场景: route.summary, 字段状态: contract.status ?? "unreviewed",
    curl: body === null ? null : `curl -X ${route.method} "${url}"${authHeader}${idempotency}${body}`,
    请求体: contract.requestExample ?? null, 请求Schema: contract.requestSchema ?? null,
    返回类型: raw?.mediaTypes ?? ["application/json"],
    返回Schema: raw?.schema ?? contract.responseSchema ?? null, 返回示例: raw ? raw.example ?? null : contract.responseExample ?? null,
    请求说明: route.request, 预期返回: route.response, 依赖: route.dependency,
    说明: body === null ? "此接口尚无经过复核的字段示例，不能把空对象当作有效请求。" : "合成示例。curl使用POSIX单引号语法；替换baseUrl、路径参数和尖括号占位符后在测试环境使用。PowerShell可用请求体配合Invoke-RestMethod；禁止用真实密码或健康数据填写发布文档。",
  };
}
