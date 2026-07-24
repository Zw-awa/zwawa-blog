import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [, , command = "dev", ...extraArgs] = process.argv;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const astroBin = path.join(projectRoot, "node_modules", "astro", "bin", "astro.mjs");

const child = spawn(process.execPath, [astroBin, command, ...extraArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
