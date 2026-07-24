import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const astro = path.join(projectRoot, "node_modules", "astro", "bin", "astro.mjs");
const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };

function run(args, stdio = "inherit") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [astro, ...args], { cwd: projectRoot, env, stdio });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const code = await run(["dev", "--background", "--host", "127.0.0.1"]);
if (code !== 0) process.exit(code);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await run(["dev", "stop"], "ignore");
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => undefined, 60_000);
