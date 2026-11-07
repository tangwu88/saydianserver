import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const ts = createRequire(import.meta.url)("typescript");
function fixture(
  handler = async () => ({ id: "member-one", nickname: "新昵称" }),
) {
  const storage = new Map([
      [
        "saidian-user",
        {
          id: "member-one",
          nickname: "原昵称",
          phoneVerified: true,
          phoneTestMode: false,
          phoneMasked: "+86***0000",
        },
      ],
      ["saidian-token", "LOCAL-SYNTHETIC-TOKEN"],
    ]),
    calls = [],
    uploads = [];
  let stamp = "original";
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../src/member-profile.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      module,
      exports: module.exports,
      Error,
      Date,
      URL,
      location: { origin: "http://127.0.0.1:5277" },
      uni: {
        uploadFile: (input) => {
          uploads.push(input);
          return { abort() {} };
        },
      },
      require(name) {
        if (name === "./api")
          return {
            API_BASE: "/api/saidian-mall/v1",
            mallSessionStamp: () => stamp,
            api: (path, input) => {
              calls.push({ path, input });
              return handler(path, input);
            },
          };
        if (name === "./realm")
          return {
            mallStorage: {
              get: (key) => storage.get(key),
              set: (key, value) => storage.set(key, value),
            },
          };
        if (name === "./after-sale-images")
          return { evidenceFile: (value) => value };
        throw Error("Unexpected import " + name);
      },
    },
  );
  return {
    ...module.exports,
    storage,
    calls,
    uploads,
    switchAccount() {
      stamp = "changed";
      storage.set("saidian-user", { id: "member-two" });
    },
  };
}
const form = {
  nickname: " 新昵称 ",
  gender: "female",
  birthday: "1995-06-01",
  heightCm: "165.5",
  weightKg: "55",
};
test("profile uses the App fields, preserves unknown measurements and validates dates and limits", () => {
  const h = fixture();
  assert.equal(
    JSON.stringify(h.profileInput(form)),
    JSON.stringify({
      nickname: "新昵称",
      gender: "female",
      birthday: "1995-06-01",
      heightCm: 165.5,
      weightKg: 55,
    }),
  );
  const empty = h.profileInput({
    ...form,
    birthday: "",
    heightCm: "",
    weightKg: "",
  });
  assert.equal(empty.birthday, null);
  assert.equal("heightCm" in empty, false);
  assert.equal("weightKg" in empty, false);
  for (const change of [
    { nickname: " " },
    { gender: "admin" },
    { birthday: "2025-99-99" },
    { birthday: "2025-02-30" },
    { birthday: "2099-01-01" },
    { heightCm: "0" },
    { weightKg: "-1" },
  ])
    assert.throws(() => h.profileInput({ ...form, ...change }));
});
test("save reuses authenticated profile endpoint and preserves session verification metadata", async () => {
  const h = fixture();
  const client = h.createMemberProfileClient();
  await client.save(h.profileInput(form));
  assert.equal(h.calls[0].path, "/storefront/member-profile");
  assert.equal(h.calls[0].input.method, "PUT");
  assert.equal(h.calls[0].input.auth, true);
  assert.equal(h.calls[0].input.sessionStamp, "original");
  assert.equal(h.storage.get("saidian-user").nickname, "新昵称");
  assert.equal(h.storage.get("saidian-user").phoneVerified, true);
  assert.equal(h.storage.get("saidian-user").phoneMasked, "+86***0000");
});
test("late profile responses never overwrite the newly signed-in account", async () => {
  let resolve;
  const response = new Promise((r) => (resolve = r)),
    h = fixture(() => response),
    client = h.createMemberProfileClient();
  const save = client.save(h.profileInput(form));
  h.switchAccount();
  resolve({ id: "member-one", nickname: "旧账号迟到" });
  await assert.rejects(save, /账号/);
  assert.equal(h.storage.get("saidian-user").id, "member-two");
  assert.equal(h.storage.get("saidian-user").nickname, undefined);
});
test("avatar uploads only to the fixed same-origin route and rejects a foreign response URL", async () => {
  const h = fixture(),
    client = h.createMemberProfileClient(),
    id = "00000000-0000-4000-8000-000000000071";
  const pending = client.uploadAvatar({
    path: "blob:local",
    size: 100,
    type: "image/png",
  });
  assert.equal(
    h.uploads[0].url,
    "/api/saidian-mall/v1/storefront/member-profile/avatar",
  );
  assert.equal(h.uploads[0].name, "file");
  h.uploads[0].success({
    statusCode: 200,
    data: JSON.stringify({
      id,
      url: `https://foreign.invalid/api/saydian-app/v2/files/${id}`,
    }),
  });
  await assert.rejects(pending, /回执/);
  const retry = client.uploadAvatar({
    path: "blob:local",
    size: 100,
    type: "image/png",
  });
  h.uploads[1].success({
    statusCode: 200,
    data: JSON.stringify({
      id,
      url: `http://127.0.0.1:5277/api/saydian-app/v2/files/${id}`,
    }),
  });
  assert.equal((await retry).id, id);
});
test("unverified temporary sessions cannot upload avatars", async () => {
  const h = fixture();
  h.storage.get("saidian-user").phoneTestMode = true;
  await assert.rejects(
    h.createMemberProfileClient().uploadAvatar({ path: "blob:local" }),
    /验证/,
  );
  assert.equal(h.uploads.length, 0);
});
