// Reviewed against the domain and API contracts. No captured health data.
const text = { type: "string" },
  id = { type: "string", format: "uuid" },
  count = { type: "integer", minimum: 0 },
  flag = { type: "boolean" },
  nullableNumber = { type: ["number", "null"] },
  nullableText = { type: ["string", "null"] };
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const list = (items) => ({ type: "array", items });
const period = obj({
  days: { enum: [7, 30, 90] },
  timezone: text,
  from: text,
  to: text,
  dates: list(text),
});
const score = obj({
  version: { type: ["integer", "null"] },
  title: nullableText,
  total: nullableNumber,
  reason: nullableText,
  items: list(
    obj({
      key: text,
      label: text,
      score: nullableNumber,
      value: nullableNumber,
      reason: nullableText,
      basis: text,
      referenceUrl: text,
      count,
      days: count,
      weight: { type: "number" },
    }),
  ),
});
const statement = obj({ text, evidence: list(text) }),
  content = obj({
    summary: list(statement),
    insights: list(obj({ key: text, text, evidence: list(text) })),
    suggestions: list(statement),
    limitations: list(text),
  });
const nullable = (s) => ({ oneOf: [s, { type: "null" }] });
const analysis = obj({
  id,
  status: { enum: ["QUEUED", "GENERATING", "READY", "FAILED", "REVOKED"] },
  createdAt: text,
  generatedAt: nullableText,
  period,
  inputDigest: text,
  ruleVersion: nullableNumber,
  content: nullable(content),
  failureReason: nullableText,
});
const series = obj({
  kind: { enum: ["device", "reference"] },
  key: text,
  metric: text,
  label: text,
  group: text,
  unit: text,
  semantics: text,
  count,
  eligibleCount: count,
  coverageDays: count,
  eligibleDays: count,
  latest: nullableNumber,
  latestAt: nullableText,
  average: nullableNumber,
  eligibleAverage: nullableNumber,
  sources: list(text),
  exclusions: { type: "object" },
  points: list(
    obj({
      date: text,
      value: nullableNumber,
      eligibleValue: nullableNumber,
      count,
      eligibleCount: count,
    }),
  ),
});
const screen = obj({
  member: obj({
    id,
    memberNo: count,
    nickname: text,
    gender: text,
    age: nullableNumber,
  }),
  period,
  recordCount: count,
  unusableRecordCount: count,
  eligibleRecordCount: count,
  coverageDays: count,
  lastMeasuredAt: nullableText,
  dataUpdatedAt: nullableText,
  series: list(series),
  qualityCounts: { type: "object" },
  score,
  dataDigest: text,
  analysis: nullable(analysis),
  analysisStale: flag,
  availability: obj({
    canGenerate: flag,
    reasons: list(text),
    credits: count,
    consentBypass: flag,
    creditBypass: flag,
  }),
  fetchedAt: text,
});
const records = obj({
  items: list(
    obj({
      id,
      metric: text,
      measuredAt: text,
      uploadedAt: text,
      quality: text,
      source: text,
      sourceModel: nullableText,
      unavailableReason: nullableText,
      values: list(
        obj({
          key: text,
          label: text,
          value: { type: "number" },
          unit: text,
          reason: nullableText,
        }),
      ),
    }),
  ),
  nextCursor: nullableText,
});
const rules = obj({
  title: { type: "string", minLength: 1, maxLength: 120 },
  description: { type: "string", maxLength: 2000 },
  items: {
    type: "array",
    minItems: 1,
    maxItems: 20,
    items: obj({
      key: text,
      label: text,
      weight: { type: "number", minimum: 0, maximum: 100 },
      required: flag,
      minDays: { type: "integer", minimum: 1, maximum: 90 },
      minSamples: { type: "integer", minimum: 1, maximum: 100000 },
      minAge: nullableNumber,
      maxAge: nullableNumber,
      gender: { enum: ["ANY", "MALE", "FEMALE"] },
      allowedOrigins: list(text),
      bands: list(
        obj({
          min: nullableNumber,
          max: nullableNumber,
          score: { type: "number", minimum: 0, maximum: 100 },
        }),
      ),
      basis: text,
      referenceUrl: text,
    }),
  },
});
const version = obj({
  id,
  version: count,
  status: { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
  rules,
  createdAt: text,
  updatedAt: text,
  publishedAt: nullableText,
});
const source =
  "apps/api/src/health-screen/health-screen.service.ts; packages/contracts/src/health-screen.ts; packages/health-domain/src/policy.ts; apps/api/src/health-screen/health-screen.database.test.ts";
const record = (requestSchema, responseSchema) => ({
  status: "request-reviewed",
  requestSchema,
  requestExample: null,
  responseSchema,
  responseExample: null,
  contentType: "application/json",
  source,
  note: "健康统计/确定性评分/独立异步分析；实际权限和授权由服务端检查。结构复核与本地合成验收不代表真实千问或生产验收。",
});
const referenceInput = obj({
  metric: {
    enum: [
      "BLOOD_GLUCOSE",
      "URIC_ACID",
      "BLOOD_LIPIDS",
      "BLOOD_PRESSURE",
      "HEART_RATE",
      "BLOOD_OXYGEN",
      "TEMPERATURE",
    ],
  },
  measuredAt: { type: "string", format: "date-time" },
  unit: text,
  values: { type: "object", additionalProperties: { type: "number" } },
  method: {
    enum: [
      "GLUCOSE_METER",
      "URIC_ACID_METER",
      "LIPID_METER",
      "BLOOD_PRESSURE_MONITOR",
      "PULSE_OXIMETER",
      "THERMOMETER",
      "LAB_REPORT",
    ],
  },
  context: { enum: ["FASTING", "AFTER_MEAL_2H", "RANDOM", "RESTING"] },
  requestKey: id,
});
const referenceRow = obj({
  id,
  metric: text,
  measuredAt: text,
  unit: text,
  values: { type: "object", additionalProperties: { type: "number" } },
  method: text,
  context: text,
  createdAt: text,
  voidedAt: nullableText,
  voidReason: nullableText,
});
export const healthScreenFieldContracts = {};
for (const controller of [
  "AdminHealthScreenController",
  "PartnerHealthScreenController",
]) {
  healthScreenFieldContracts[controller + ".availability"] = record(
    null,
    obj({ enabled: flag }),
  );
  healthScreenFieldContracts[controller + ".updates"] = record(
    null,
    obj({ groups: list(obj({ group: text, count, updatedAt: text })) }),
  );
  healthScreenFieldContracts[controller + ".updates"].query = {
    days: { schema: { enum: ["7", "30", "90"] }, required: false },
  };
  healthScreenFieldContracts[controller + ".references"] = record(
    null,
    obj({ items: list(referenceRow), nextCursor: nullableText }),
  );
  healthScreenFieldContracts[controller + ".references"].query = {
    cursor: { schema: id, required: false },
  };
  healthScreenFieldContracts[controller + ".saveReference"] = record(
    referenceInput,
    referenceRow,
  );
  healthScreenFieldContracts[controller + ".voidReference"] = record(
    obj({ reason: { type: "string", minLength: 5, maxLength: 200 } }),
    referenceRow,
  );
  healthScreenFieldContracts[controller + ".load"] = record(null, screen);
  healthScreenFieldContracts[controller + ".load"].query = {
    days: {
      schema: { enum: ["7", "30", "90"] },
      example: "7",
      required: false,
    },
  };
  healthScreenFieldContracts[controller + ".records"] = record(null, records);
  healthScreenFieldContracts[controller + ".records"].query = {
    days: {
      schema: { enum: ["7", "30", "90"] },
      example: "90",
      required: false,
    },
    metric: { schema: text, example: "HEART_RATE", required: false },
    cursor: { schema: id, required: false },
    reason: { schema: text, required: false },
  };
  healthScreenFieldContracts[controller + ".generate"] = record(
    obj({
      days: { enum: [7, 30, 90] },
      inputDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      requestKey: id,
    }),
    analysis,
  );
  healthScreenFieldContracts[controller + ".result"] = record(null, analysis);
}
healthScreenFieldContracts["HealthScoreRulesController.list"] = record(
  null,
  obj({ enabled: flag, items: list(version) }),
);
healthScreenFieldContracts["HealthScoreRulesController.save"] = record(
  obj({ id, rules }, []),
  version,
);
healthScreenFieldContracts["HealthScoreRulesController.settings"] = record(
  obj({ enabled: flag }),
  obj({ enabled: flag }),
);
healthScreenFieldContracts["HealthScoreRulesController.preview"] = record(
  obj({ memberId: id, days: { enum: [7, 30, 90] } }),
  obj({ preview: { const: true }, score }),
);
healthScreenFieldContracts["HealthScoreRulesController.publish"] = record(
  obj({
    reviewed: { const: true },
    expectedUpdatedAt: { type: "string", format: "date-time" },
  }),
  version,
);
