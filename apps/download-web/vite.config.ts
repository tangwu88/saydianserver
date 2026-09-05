import { defineConfig } from "vite";

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
    commonjsOptions: {
      include: [/node_modules/, /packages\/contracts/],
    },
  },
});
