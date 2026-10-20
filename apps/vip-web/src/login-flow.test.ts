import { readFileSync } from "node:fs";
import ts from "typescript";
import { reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { safeReturnPath } from "./navigation";

function viewHarness(view: "Login" | "MemberCallback" | "Partner", userAgent = "Desktop", next: unknown = "/orders") {
  const path = view === "Partner" ? "../../shop/src/pages/partner/index.vue" : `./views/${view}.vue`;
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("view.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(ast.statements.filter(n => !ts.isImportDeclaration(n))
    .map(n => printer.printNode(ts.EmitHint.Unspecified, n, ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const mounts: Array<() => void | Promise<void>> = [];
  const loads: Array<(options: Record<string, unknown>) => void> = [];
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  const api = { post: vi.fn(async () => ({ data: { data: { token: "synthetic-partner-token" } } })) };
  const router = { replace: vi.fn(async () => {}) };
  const beginMemberLogin = vi.fn(async (_next: unknown) => {});
  const location = { hash: "", pathname: "/vip/auth/member-callback", assign: vi.fn() };
  const history = { replaceState: vi.fn() };
  const deps = {
    reactive, ref, onMounted: (fn: () => void | Promise<void>) => mounts.push(fn),
    useRoute: () => ({ query: { next } }), useRouter: () => router,
    api, data: (result: any) => result.data.data, errorMessage: () => "合成登录失败",
    partnerTokenKey: "partner-token", memberVerifierKey: "member-verifier",
    sessionStorage: store, beginMemberLogin, safeReturnPath,
    navigator: { userAgent }, location, history,
    window: { location },
    onLoad: (fn: (options: Record<string, unknown>) => void) => loads.push(fn), onShow: vi.fn(),
    mallStorage: { get: store.getItem, set: store.setItem }, uni: { navigateTo: vi.fn(), switchTab: vi.fn() },
  };
  const exports = view === "Login" ? "login, mallLogin, form, busy, error" : view === "Partner" ? "partnerAccountLogin" : "error, retryPath, passwordPath";
  const state = new Function(...Object.keys(deps), `${code}\nreturn {${exports}};`)(...Object.values(deps));
  return { ...state, mounts, loads, store, api, router, beginMemberLogin, location, history };
}

describe("partner login remains available inside WeChat", () => {
  it.each(["iPhone MicroMessenger/8.0", "Android MicroMessenger/8.0", "Desktop Chrome"])(
    "keeps the password form open without starting member authorization (%s)", async (userAgent) => {
      const h = viewHarness("Login", userAgent);
      for (const mount of h.mounts) await mount();
      expect(h.beginMemberLogin).not.toHaveBeenCalled();
      expect(h.location.assign).not.toHaveBeenCalled();
      Object.assign(h.form, { username: "synthetic-partner", password: "synthetic-password" });
      await h.login();
      expect(h.api.post).toHaveBeenCalledWith("/auth/login", expect.objectContaining({ username: "synthetic-partner" }));
      expect(h.store.getItem("partner-token")).toBe("synthetic-partner-token");
      expect(h.form.password).toBe("");
      expect(h.router.replace).toHaveBeenCalledWith("/orders");
    },
  );

  it("keeps failed password login on the partner page and rejects external return paths", async () => {
    const h = viewHarness("Login", "iPhone MicroMessenger", "https://example.invalid");
    Object.assign(h.form, { username: "synthetic-partner", password: "synthetic-password" });
    h.api.post.mockRejectedValueOnce(new Error("synthetic"));
    await h.login();
    expect(h.error.value).toBe("合成登录失败");
    expect(h.busy.value).toBe(false);
    expect(h.router.replace).not.toHaveBeenCalled();
    expect(h.beginMemberLogin).not.toHaveBeenCalled();
    await h.login();
    expect(h.router.replace).toHaveBeenCalledWith("/");
  });

  it("starts the member bridge only on explicit action and prevents duplicate attempts", async () => {
    const h = viewHarness("Login", "iPhone MicroMessenger", "/wallet");
    let rejectAttempt!: (error: Error) => void;
    h.beginMemberLogin.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectAttempt = reject; }));
    const attempt = h.mallLogin();
    await h.mallLogin();
    await h.login();
    expect(h.beginMemberLogin).toHaveBeenCalledExactlyOnceWith("/wallet");
    expect(h.api.post).not.toHaveBeenCalled();
    rejectAttempt(new Error("synthetic storage failure"));
    await attempt;
    expect(h.busy.value).toBe(false);
    expect(h.error.value).toContain("保存登录状态");
  });

  it("offers a fresh authorization attempt and password login when a callback expires", async () => {
    const h = viewHarness("MemberCallback");
    h.location.hash = "#ticket=synthetic&next=%2Fwallet";
    await h.mounts[0]!();
    expect(h.history.replaceState).toHaveBeenCalledWith(null, "", "/vip/auth/member-callback");
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.retryPath.value).toBe("/vip/auth/member-start?next=%2Fwallet");
    expect(h.passwordPath.value).toBe("/vip/login?password=1&next=%2Fwallet");
    expect(h.error.value).toContain("失效");
  });

  it("consumes the verifier once and does not redirect a failed member exchange automatically", async () => {
    const h = viewHarness("MemberCallback");
    h.store.setItem("member-verifier", "synthetic-verifier");
    h.location.hash = "#ticket=synthetic&next=https%3A%2F%2Fexample.invalid";
    h.api.post.mockRejectedValueOnce(new Error("synthetic exchange failure"));
    await h.mounts[0]!();
    expect(h.store.getItem("member-verifier")).toBeNull();
    expect(h.api.post).toHaveBeenCalledWith("/auth/member-login", { ticket: "synthetic", codeVerifier: "synthetic-verifier" });
    expect(h.router.replace).not.toHaveBeenCalled();
    expect(h.location.assign).not.toHaveBeenCalled();
    expect(h.passwordPath.value).toBe("/vip/login?password=1&next=%2F");
  });

  it("still completes an explicitly initiated member login and returns to the requested partner page", async () => {
    const h = viewHarness("MemberCallback");
    h.store.setItem("member-verifier", "synthetic-verifier");
    h.location.hash = "#ticket=synthetic&next=%2Fproducts";
    await h.mounts[0]!();
    expect(h.store.getItem("member-verifier")).toBeNull();
    expect(h.store.getItem("partner-token")).toBe("synthetic-partner-token");
    expect(h.router.replace).toHaveBeenCalledExactlyOnceWith("/products");
    expect(h.error.value).toBe("");
  });

  it.each([["/wallet", "%2Fwallet"], ["//example.invalid", "%2F"], ["/admin/", "%2F"]])(
    "lets existing accounts leave the application page with a safe destination (%s)", (next, encoded) => {
      const h = viewHarness("Partner", "iPhone MicroMessenger");
      h.loads[0]!({ next });
      h.partnerAccountLogin();
      expect(h.location.assign).toHaveBeenCalledExactlyOnceWith(`/vip/login?password=1&next=${encoded}`);
      expect(h.api.post).not.toHaveBeenCalled();
    },
  );
});
