// Operates only against the named, isolated loopback preview. Never part of production builds.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  fixtures = join(root, "artifacts/health-screen-profile-access");
const api = "http://127.0.0.1:18097",
  origin = "http://127.0.0.1:3312";
const privateSettings = JSON.parse(
  await readFile(
    join(root, "artifacts/health-screen-20261107/preview-private.json"),
    "utf8",
  ),
);
const database =
  "postgresql://health_preview@127.0.0.1:55447/saydian_health_screen_preview";
if (
  privateSettings.env.DATABASE_URL !== database ||
  privateSettings.env.H5_DEMO_ENABLED !== "true" ||
  privateSettings.admin.username !== "health-preview-admin"
)
  throw Error("Only the original isolated local demo is supported");
const { PrismaClient } = createRequire(join(root, "apps/api/package.json"))(
  "@prisma/client",
);
const db = new PrismaClient({ datasourceUrl: database });
const stages = [
  ["child", "儿童", 8],
  ["teen", "青少年", 15],
  ["adult", "成人", 36],
  ["senior", "老年", 72],
];
const people = [];
const partner = await db.brandPartner.findUniqueOrThrow({
  where: { partnerNo: "HEALTH-PREVIEW" },
});
for (const [i, [age, label, years]] of stages.entries())
  for (const [j, sex] of ["male", "female"].entries()) {
    const id = "aef20810-3011-4000-a000-00000000000" + (1 + i * 2 + j),
      name = "预览" + label + (j ? "女性" : "男性"),
      mobile = "+861990000790" + (1 + i * 2 + j);
    const old = await db.user.findUnique({
      where: { id },
      select: { nickname: true },
    });
    if (old && old.nickname !== name)
      throw Error("Fixture identifier collision");
    await db.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        nickname: name,
        mobile,
        mobileVerifiedAt: new Date(),
        partnerId: partner.id,
        gender: j ? "FEMALE" : "MALE",
        birthday: new Date(new Date().getUTCFullYear() - years + "-01-01"),
        weightKg: [28, 51, 64, 67][i],
        heightCm: [126, 164, 170, 166][i],
        locale: "zh-Hans",
        healthProfile: { create: { screenName: name } },
      },
    });
    const records = [],
      references = [];
    for (let lag = 0; lag < 7; lag++) {
      const observedAt = new Date(Date.now() - lag * 86400000);
      const day = observedAt.toISOString().slice(0, 10);
      const change = (lag * 3 + i + j) % 7;
      for (const [metric, values, unit] of [
        ["HEART_RATE", { bpm: 72 + change }, "bpm"],
        [
          "BLOOD_PRESSURE",
          { systolic: 114 + change, diastolic: 73 + change },
          "mmHg",
        ],
      ])
        records.push({
          userId: id,
          metric,
          observedAt,
          unit,
          values,
          clientRecordId: "health-screen-preview-" + day + "-" + metric,
          timezoneOffsetMinutes: 480,
          sourceOrigin: "watch_history",
          sourceDeviceKey: "local-figure-fixture",
          sourcePlatform: "synthetic-local-preview",
          sourceModel: "合成预览设备",
          sourceMetadata: { timeBasis: "sdk" },
          quality: "VALID",
        });
      if (i >= 2 && lag % 3 === 0)
        for (const [metric, value, unit] of [
          ["BLOOD_GLUCOSE", (52 + change) / 10, "mmol/L"],
          ["URIC_ACID", 320 + change * 3, "μmol/L"],
        ])
          references.push({
            userId: id,
            metric,
            unit,
            values: { value },
            method: "LAB_REPORT",
            context: "FASTING",
            observedAt,
            actorType: "MEMBER",
            actorId: id,
            requestKey: "figure-preview-" + id + "-" + day + "-" + metric,
            inputDigest: "synthetic-local-preview",
          });
    }
    await db.healthRecord.createMany({ data: records, skipDuplicates: true });
    await db.memberHealthReference.createMany({
      data: references,
      skipDuplicates: true,
    });
    people.push({
      id,
      stage: age,
      label,
      years,
      sex,
      name,
      mobile: mobile.slice(3),
    });
  }
const missing = "aef20810-3011-4000-a000-000000000009";
await db.user.upsert({
  where: { id: missing },
  update: {},
  create: {
    id: missing,
    nickname: "预览待完善会员",
    mobile: "+8619900007909",
    mobileVerifiedAt: new Date(),
    partnerId: partner.id,
    locale: "zh-Hans",
  },
});
for (const type of ["user_agreement", "privacy_policy"])
  await db.globalLegalDocument.upsert({
    where: {
      documentType_version_locale: {
        documentType: type,
        version: "screen-local-preview-v1",
        locale: "zh-Hans",
      },
    },
    update: {},
    create: {
      documentType: type,
      version: "screen-local-preview-v1",
      locale: "zh-Hans",
      title: "本地预览说明",
      contentHtml:
        "<p>此环境仅用于合成会员预览。验证码送至本机模拟收件箱。</p>",
      reviewed: true,
      active: true,
      publishedAt: new Date(),
    },
  });
const sms = await db.integrationConfig.findUnique({
  where: { key: "sms_global" },
});
if (
  sms &&
  sms.state === "CONFIGURED" &&
  sms.publicConfig.webhookUrl !== "https://health-screen-preview.invalid/otp"
)
  throw Error("An existing SMS configuration is in use");
const config = {
  provider: "webhook",
  deliveryVerified: true,
  webhookUrl: "https://health-screen-preview.invalid/otp",
  countries: ["CN"],
};
await db.integrationConfig.upsert({
  where: { key: "sms_global" },
  update: { state: "CONFIGURED", publicConfig: config },
  create: { key: "sms_global", state: "CONFIGURED", publicConfig: config },
});
await db.$disconnect();
const gallery = await readFile(
  join(root, "tools/health-screen-preview-gallery.html"),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  function send(code, body, type = "application/json") {
    res.writeHead(code, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(
      typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body),
    );
  }
  try {
    if (req.headers.host !== "127.0.0.1:3312") return send(403, {});
    const url = new URL(req.url, origin),
      path = decodeURIComponent(url.pathname);
    if (path === "/") return send(200, gallery, mime[".html"]);
    if (path === "/preview/people") return send(200, { people, missing });
    if (path === "/preview/staff" && req.method === "POST") {
      if (
        req.headers.origin !== origin ||
        req.headers["x-preview"] !== "synthetic"
      )
        return send(403, {});
      const result = await fetch(api + "/api/saydian-app/admin/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(privateSettings.admin),
      });
      const body = await result.json();
      if (!result.ok || !body.data?.token) return send(403, {});
      return send(200, { token: body.data.token });
    }
    if (/^\/preview\/inbox\/790[1-9]$/.test(path)) {
      const value = await readFile(
        join(fixtures, "inbox", path.slice(-4) + ".json"),
        "utf8",
      )
        .then(JSON.parse)
        .catch(() => null);
      return send(200, { code: value?.until > Date.now() ? value.code : null });
    }
    if (path.startsWith("/api/") || path.startsWith("/global/api/")) {
      if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method))
        return send(405, {});
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1024 * 1024) return send(413, {});
        chunks.push(chunk);
      }
      const headers = {
        "content-type": "application/json",
        "user-agent": req.headers["user-agent"] || "",
      };
      if (req.headers.authorization)
        headers.authorization = req.headers.authorization;
      const upstream = await fetch(
        api + path.replace(/^\/global(?=\/api\/)/, "") + url.search,
        {
          method: req.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        },
      );
      return send(
        upstream.status,
        Buffer.from(await upstream.arrayBuffer()),
        upstream.headers.get("content-type") || "application/json",
      );
    }
    if (req.method !== "GET") return send(405, {});
    const sources = {
      "/admin/": "apps/admin-web/dist",
      "/vip/": "apps/vip-web/dist",
      "/global/saidian-mall/": "apps/shop/dist/build/h5",
      "/figures/": "packages/health-screen-ui/src/assets",
    };
    const prefix = Object.keys(sources).find((k) => path.startsWith(k));
    if (!prefix) return send(404, {});
    const folder = join(root, sources[prefix]);
    let file = resolve(folder, "." + path.slice(prefix.length - 1));
    if (file !== folder && !file.startsWith(folder + sep)) return send(403, {});
    if (!extname(file) && prefix !== "/figures/")
      file = join(folder, "index.html");
    if (!(await stat(file)).isFile()) return send(404, {});
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  } catch {
    return send(404, {});
  }
});
server.listen(3312, "127.0.0.1", () =>
  console.log("Synthetic preview: " + origin),
);
