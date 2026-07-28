import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareDeployWranglerConfig } from "./prepare-wrangler-config.mjs";

const [, , command = "dev", ...extraArgs] = process.argv;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const astroBin = path.join(projectRoot, "node_modules", "astro", "bin", "astro.mjs");
const generatedConfig = command === "build" ? prepareDeployWranglerConfig(projectRoot) : null;

const child = spawn(process.execPath, [astroBin, command, ...extraArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
    ...(generatedConfig ? {
      ASTRO_WRANGLER_CONFIG: generatedConfig,
      PUBLIC_SITE_URL: process.env.DEPLOY_SITE_URL,
    } : {}),
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
