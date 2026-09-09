import { defineConfig } from "vite";
import uniModule from "@dcloudio/vite-plugin-uni";

const uni =
  (uniModule as unknown as { default?: typeof uniModule }).default ?? uniModule;

export default defineConfig({
  plugins: [uni()],
  base: process.env.UNI_PLATFORM === "h5" ? "/saidian-mall/" : "/",
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: { "/api": { target: process.env.VITE_API_PROXY_TARGET || process.env.SHOP_API_TARGET || "http://127.0.0.1:8080", changeOrigin: false } },
  },
});
