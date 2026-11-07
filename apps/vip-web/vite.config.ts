import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: "/vip/",
  optimizeDeps: { include: ["@saydian/app-contracts", "@saydian/app-contracts/commerce-erp"] },
  build: { commonjsOptions: { include: [/node_modules/, /packages\/contracts/] } },
  server: {
    port: 3302,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080" },
      "/health": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080" },
    },
  },
});
