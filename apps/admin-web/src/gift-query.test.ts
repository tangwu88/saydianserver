import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, ref } from "vue";
import { parseGiftCardNos } from "@saydian/app-contracts";
import { describe, expect, it, vi } from "vitest";

function sfcScript(
  file: string,
  deps: Record<string, unknown>,
  names: string[],
) {
  const sfc = readFileSync(new URL(file, import.meta.url), "utf8");
  const source = ts.createSourceFile(
    "view.ts",
    sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    source.statements
      .filter((s) => !ts.isImportDeclaration(s))
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, source))
      .join("\n")
      .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/admin/")),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  return new Function(
    ...Object.keys(deps),
    code + `\nreturn {${names.join(",")}};`,
  )(...Object.values(deps));
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function portal(initialToken = "") {
  const values = new Map<string, string>();
  if (initialToken) values.set("saydian-gift-query-session", initialToken);
  const storage = {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const client = { post: vi.fn(), get: vi.fn() };
  let mount = async () => {},
    unmount = () => {};
  const state = sfcScript(
    "./views/GiftQueryView.vue",
    {
      ref,
      axios: {
        create: () => client,
        isAxiosError: (error: any) => !!error?.response,
      },
      parseGiftCardNos,
      sessionStorage: storage,
      onMounted: (fn: any) => {
        mount = fn;
      },
      onBeforeUnmount: (fn: any) => {
        unmount = fn;
      },
    },
    [
      "username",
      "password",
      "authenticated",
      "checking",
      "busy",
      "error",
      "input",
      "items",
      "name",
      "token",
      "login",
      "query",
      "logout",
    ],
  );
  return {
    state,
    client,
    values,
    mount: () => mount(),
    unmount: () => unmount(),
  };
}
async function loggedIn() {
  const h = portal("query-only-token");
  h.client.get.mockResolvedValue({
    data: { data: { displayName: "合成查询员" } },
  });
  await h.mount();
  return h;
}
describe("standalone inquiry UI identity and request ownership", () => {
  it("shows the dedicated login without requesting admin/member credentials", async () => {
    const h = portal();
    await h.mount();
    expect(h.state.checking.value).toBe(false);
    expect(h.state.authenticated.value).toBe(false);
    expect(h.client.get).not.toHaveBeenCalled();
    expect(h.client.post).not.toHaveBeenCalled();
    h.state.username.value = "query_test";
    h.state.password.value = "synthetic-password";
    h.client.post.mockResolvedValue({
      data: {
        data: {
          token: "query-only",
          displayName: "合成",
          expiresAt: "2026-12-01",
        },
      },
    });
    await h.state.login();
    expect(h.client.post).toHaveBeenCalledWith("/login", {
      username: "query_test",
      password: "synthetic-password",
    });
    expect(h.state.password.value).toBe("");
    expect(h.values.get("saydian-gift-query-session")).toBe("query-only");
    expect(h.values.size).toBe(1);
  });
  it("deduplicates card numbers and uses only the query bearer token", async () => {
    const h = await loggedIn();
    h.state.input.value = "80100611,80100612\n80100611";
    h.client.post.mockResolvedValue({
      data: {
        data: {
          items: [
            { cardNo: "80100611", status: "REDEEMED", orderNo: "SYNTHETIC-1" },
          ],
          queriedAt: "2026-11-25",
        },
      },
    });
    await h.state.query();
    expect(h.client.post).toHaveBeenCalledWith(
      "/query",
      { cardNos: ["80100611", "80100612"] },
      { headers: { Authorization: "Bearer query-only-token" } },
    );
    expect(h.state.items.value[0].orderNo).toBe("SYNTHETIC-1");
  });
  it("blocks duplicate clicks and clears previous results before new queries", async () => {
    const h = await loggedIn(),
      pending = deferred();
    h.state.items.value = [{ cardNo: "80100611" }];
    h.state.input.value = "80100612";
    h.client.post.mockReturnValue(pending.promise);
    const request = h.state.query();
    await h.state.query();
    expect(h.client.post).toHaveBeenCalledTimes(1);
    expect(h.state.items.value).toEqual([]);
    pending.resolve({ data: { data: { items: [], queriedAt: "2026-11-25" } } });
    await request;
  });
  it("rejects malformed/oversized pasted input without sending a request", async () => {
    const h = await loggedIn();
    for (const input of [
      "611",
      "",
      Array.from({ length: 101 }, (_, i) => String(80100000 + i)).join("\n"),
    ]) {
      h.state.input.value = input;
      await h.state.query();
    }
    expect(h.client.post).not.toHaveBeenCalled();
    expect(h.state.error.value).toContain("100张");
  });
  it("expires only the inquiry identity and clears card/order data on 401", async () => {
    const h = await loggedIn();
    h.state.items.value = [{ orderNo: "SYNTHETIC-1" }];
    h.state.input.value = "80100611";
    h.values.set("saydian-global-admin-token", "unrelated-admin");
    h.client.post.mockRejectedValue({
      response: { status: 401, data: { message: "查询登录已失效" } },
    });
    await h.state.query();
    expect(h.state.authenticated.value).toBe(false);
    expect(h.state.items.value).toEqual([]);
    expect(h.state.input.value).toBe("");
    expect(h.values.get("saydian-global-admin-token")).toBe("unrelated-admin");
    expect(h.values.has("saydian-gift-query-session")).toBe(false);
  });
  it("revokes the remote query session before clearing it locally", async () => {
    const h = await loggedIn();
    h.client.post.mockResolvedValue({ data: { data: { loggedOut: true } } });
    await h.state.logout();
    expect(h.client.post).toHaveBeenCalledWith(
      "/logout",
      {},
      { headers: { Authorization: "Bearer query-only-token" } },
    );
    expect(h.state.authenticated.value).toBe(false);
    expect(h.values.size).toBe(0);
  });
  it("ignores a late response after leaving the page", async () => {
    const h = await loggedIn(),
      pending = deferred();
    h.state.input.value = "80100611";
    h.client.post.mockReturnValue(pending.promise);
    const work = h.state.query();
    h.unmount();
    pending.resolve({
      data: { data: { items: [{ orderNo: "SYNTHETIC-LATE" }] } },
    });
    await work;
    expect(h.state.items.value).toEqual([]);
  });
});

function management() {
  const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
  let session = "admin-a",
    unmount = () => {};
  const state = sfcScript(
    "./components/GiftQueryManagement.vue",
    {
      ref,
      computed,
      api,
      adminSessionKey: () => session,
      getAdminRoles: () => ["SUPER_ADMIN"],
      readableError: () => "保存失败",
      responseData: (response: any) => response.data.data,
      onMounted: () => {},
      onBeforeUnmount: (fn: any) => {
        unmount = fn;
      },
      location: { origin: "https://example.invalid" },
    },
    [
      "form",
      "accounts",
      "logs",
      "dialog",
      "error",
      "busy",
      "load",
      "edit",
      "save",
      "portalUrl",
    ],
  );
  return {
    api,
    state,
    changeSession: () => {
      session = "admin-b";
    },
    unmount: () => unmount(),
  };
}
describe("inquiry account administration UI", () => {
  it("creates an independent account with a strong password, clears it on success and refreshes statistics", async () => {
    const h = management();
    h.state.edit();
    Object.assign(h.state.form.value, {
      username: "query_test",
      displayName: "合成",
      password: "synthetic-password",
    });
    h.api.post.mockResolvedValue({});
    h.api.get
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({ data: { data: { items: [], total: 0 } } });
    await h.state.save();
    expect(h.api.post).toHaveBeenCalledWith(
      "/commerce-gift-query-accounts",
      expect.objectContaining({
        username: "query_test",
        active: true,
        password: "synthetic-password",
      }),
    );
    expect(h.state.form.value.password).toBe("");
    expect(h.state.dialog.value).toBe(false);
    expect(h.api.get).toHaveBeenCalledTimes(2);
    expect(h.state.portalUrl).toBe("https://example.invalid/admin/gift-query");
  });
  it("retains input on server conflicts and sends the expected optimistic version", async () => {
    const h = management();
    h.state.edit({
      id: "synthetic-id",
      username: "query_test",
      displayName: "合成",
      active: true,
      version: 4,
    });
    h.api.put.mockRejectedValue(new Error("conflict"));
    await h.state.save();
    expect(h.api.put).toHaveBeenCalledWith(
      "/commerce-gift-query-accounts/synthetic-id",
      expect.objectContaining({ version: 4, password: "" }),
    );
    expect(h.state.dialog.value).toBe(true);
    expect(h.state.error.value).toBe("保存失败");
  });
  it("ignores statistics responses from a previous administrator identity", async () => {
    const h = management(),
      a = deferred(),
      l = deferred();
    h.api.get.mockReturnValueOnce(a.promise).mockReturnValueOnce(l.promise);
    const request = h.state.load();
    h.changeSession();
    a.resolve({ data: { data: [{ username: "old-account" }] } });
    l.resolve({
      data: { data: { items: [{ username: "old-account" }], total: 1 } },
    });
    await request;
    expect(h.state.accounts.value).toEqual([]);
    expect(h.state.logs.value).toEqual([]);
  });
});
