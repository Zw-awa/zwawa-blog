import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import path from "node:path";

const [, , ...args] = process.argv;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");

if (!process.env.ADMIN_DEV_PASSWORD) {
  try { loadEnvFile(path.join(projectRoot, ".dev.vars")); } catch { /* The test reports a clear error below. */ }
}

const child = spawn(process.execPath, [cli, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: path.join(projectRoot, ".playwright-browsers"),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
