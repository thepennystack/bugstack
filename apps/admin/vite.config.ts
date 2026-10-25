import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  cacheDir: ".vite",
  clearScreen: false,
  server: { host: "0.0.0.0", port: 5174, strictPort: true },
});
