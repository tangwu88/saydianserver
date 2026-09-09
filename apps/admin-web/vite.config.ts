import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/admin/",
  plugins: [vue()],
  optimizeDeps: {
    include: ["@saydian/app-contracts", "@saydian/app-contracts/download"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_API_PROXY_TARGET || "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    commonjsOptions: {
      include: [/node_modules/, /packages\/contracts/],
    },
  },
});
