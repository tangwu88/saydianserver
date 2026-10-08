import { defineConfig } from "vite";
import uniModule from "@dcloudio/vite-plugin-uni";
import { parseManifestJsonOnce } from "@dcloudio/uni-cli-shared";
import { resolveMallConfig } from "./src/realm-config";
import { miniSelectors, miniVueStyles } from "./mini-style";

const uni =
  (uniModule as unknown as { default?: typeof uniModule }).default ?? uniModule;

const realm = resolveMallConfig(process.env, process.env.UNI_PLATFORM === "mp-weixin");
const publicBase = realm.publicBase;
if (process.env.UNI_PLATFORM === "mp-weixin" && process.env.VITE_WECHAT_MINI_APP_ID) {
  const appId = process.env.VITE_WECHAT_MINI_APP_ID;
  if (!/^wx[A-Za-z0-9]{8,64}$/.test(appId)) throw new Error("微信小程序构建 AppID 不正确");
  if (process.env.UNI_INPUT_DIR) {
    const manifest = parseManifestJsonOnce(process.env.UNI_INPUT_DIR);
    manifest["mp-weixin"] = { ...manifest["mp-weixin"], appid: appId };
  }
}
if (process.env.UNI_PLATFORM === "h5") {
  process.env.UNI_H5_BASE = publicBase;
  // Uni reads this cached manifest for compiler/runtime options. Do not change the source file.
  if (process.env.UNI_INPUT_DIR) {
    const manifest = parseManifestJsonOnce(process.env.UNI_INPUT_DIR);
    manifest.h5 = { ...manifest.h5, router: { ...manifest.h5?.router, base: publicBase } };
  }
}

export default defineConfig({
  plugins: [{
    name: "saydian-mini-style-compatibility", enforce: "pre",
    transform(code, id) {
      if (process.env.UNI_PLATFORM !== "mp-weixin") return;
      if (id.endsWith(".vue")) return { code: miniVueStyles(code, id), map: null };
      if (id.endsWith(".scss")) return { code: miniSelectors(code), map: null };
    },
  }, {
    name: "saydian-realm-manifest", enforce: "pre",
    transform(code, id) {
      if (process.env.UNI_PLATFORM === "mp-weixin" && process.env.VITE_WECHAT_MINI_APP_ID && id.endsWith("manifest-json-js")) {
        const manifest = JSON.parse(code);
        manifest["mp-weixin"] = { ...manifest["mp-weixin"], appid: process.env.VITE_WECHAT_MINI_APP_ID };
        return { code: JSON.stringify(manifest), map: null };
      }
      if (realm.realm === "global" && process.env.UNI_PLATFORM === "h5" && id.endsWith("pages-json-js")) {
        const pages = JSON.parse(code);
        pages.tabBar.selectedColor = "#D20B27";
        return { code: JSON.stringify(pages), map: null };
      }
      if (process.env.UNI_PLATFORM !== "h5" || !id.endsWith("manifest-json-js")) return;
      const manifest = JSON.parse(code);
      manifest.h5 = { ...manifest.h5, router: { ...manifest.h5?.router, base: publicBase } };
      return { code: JSON.stringify(manifest), map: null };
    },
  }, uni()],
  base: process.env.UNI_PLATFORM === "h5" ? publicBase : "/",
  ...(process.env.UNI_PLATFORM === "mp-weixin" ? { css: {
    postcss: { plugins: [{
      postcssPlugin: "saydian-mini-selectors",
      Rule(rule: { selector: string }) { rule.selector = miniSelectors(rule.selector + "{").slice(0, -1); },
    }] },
  } } : {}),
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: realm.realm === "global" ? { "/global/api": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8082", rewrite: path => path.replace(/^\/global(?=\/api\/)/, ""), changeOrigin: false } } : { "/api": { target: process.env.VITE_API_PROXY_TARGET || process.env.SHOP_API_TARGET || "http://127.0.0.1:8080", changeOrigin: false } },
  },
});
