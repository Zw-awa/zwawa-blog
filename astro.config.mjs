import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://blog.example.com",
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    ...(process.env.ASTRO_WRANGLER_CONFIG ? { configPath: process.env.ASTRO_WRANGLER_CONFIG } : {}),
  }),
  session: { driver: sessionDrivers.lruCache() },
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: {
    optimizeDeps: { exclude: ["@astrojs/cloudflare/entrypoints/server"] },
    server: { watch: { ignored: ["**/opensource/**"] } },
    build: { chunkSizeWarningLimit: 700 }
  }
});
