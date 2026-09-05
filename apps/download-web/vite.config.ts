import { defineConfig } from "vite";

export default defineConfig({
  base: "/down/",
  build: {
    outDir: "dist",
    sourcemap: false,
    commonjsOptions: {
      include: [/node_modules/, /packages\/contracts/],
    },
  },
});
