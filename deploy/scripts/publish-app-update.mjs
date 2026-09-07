import { PrismaClient } from "@prisma/client";
import { parseDownloadManifest } from "@saydian/app-contracts";

const prisma = new PrismaClient();
const action = process.env.APP_UPDATE_ACTION;

function decodePayload() {
  const encoded = process.env.APP_UPDATE_PAYLOAD_B64;
  if (!encoded) throw new Error("APP_UPDATE_PAYLOAD_B64 is required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

try {
  if (action === "snapshot") {
    const setting = await prisma.appSetting.findUnique({ where: { key: "app_update" } });
    if (!setting) throw new Error("app_update setting does not exist");
    process.stdout.write(Buffer.from(JSON.stringify(setting)).toString("base64"));
  } else if (action === "apply") {
    const payload = decodePayload();
    const value = parseDownloadManifest(payload.value);
    await prisma.appSetting.update({
      where: { key: "app_update" },
      data: { value, public: payload.public === true },
    });
    process.stdout.write("applied");
  } else if (action === "restore") {
    const snapshot = decodePayload();
    await prisma.appSetting.update({
      where: { key: "app_update" },
      data: {
        value: snapshot.value,
        public: snapshot.public,
        updatedAt: new Date(snapshot.updatedAt),
      },
    });
    process.stdout.write("restored");
  } else {
    throw new Error("APP_UPDATE_ACTION must be snapshot, apply or restore");
  }
} finally {
  await prisma.$disconnect();
}
