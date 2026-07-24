import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://blog.zwawa.dpdns.org",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  session: { driver: sessionDrivers.lruCache() },
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: {
    optimizeDeps: { exclude: ["@astrojs/cloudflare/entrypoints/server"] },
    server: { watch: { ignored: ["**/opensource/**"] } },
    build: { chunkSizeWarningLimit: 700 }
  }
});
