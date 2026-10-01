import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/down/",
  preview: {
    port: 4174,
    proxy: {
      "/api": {
        target: "https://app.saydian.cn",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        "say-ring-privacy": resolve(__dirname, "say-ring-privacy.html"),
        "say-ring-terms": resolve(__dirname, "say-ring-terms.html"),
      },
    },
    commonjsOptions: {
      include: [/node_modules/, /packages\/contracts/],
    },
  },
});
