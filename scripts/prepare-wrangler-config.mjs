import fs from "node:fs";
import path from "node:path";

export const DEPLOY_VARIABLES = [
  "DEPLOY_WORKER_NAME",
  "DEPLOY_D1_DATABASE_NAME",
  "DEPLOY_D1_DATABASE_ID",
  "DEPLOY_R2_BUCKET_NAME",
  "DEPLOY_SITE_URL",
];

function text(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function createDeployWranglerConfig(env = process.env) {
  const values = Object.fromEntries(DEPLOY_VARIABLES.map((key) => [key, text(env, key)]));
  const provided = DEPLOY_VARIABLES.filter((key) => values[key]);
  if (provided.length === 0) return null;

  const missing = DEPLOY_VARIABLES.filter((key) => !values[key]);
  if (missing.length) {
    throw new Error(`部署配置不完整，缺少环境变量：${missing.join(", ")}`);
  }

  let siteUrl;
  try {
    siteUrl = new URL(values.DEPLOY_SITE_URL);
  } catch {
    throw new Error("DEPLOY_SITE_URL 必须是有效的绝对 URL。");
  }
  if (!new Set(["http:", "https:"]).has(siteUrl.protocol)) {
    throw new Error("DEPLOY_SITE_URL 必须使用 http 或 https 协议。");
  }

  return {
    name: values.DEPLOY_WORKER_NAME,
    workers_dev: false,
    preview_urls: false,
    compatibility_date: "2026-07-23",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{
      binding: "DB",
      database_name: values.DEPLOY_D1_DATABASE_NAME,
      database_id: values.DEPLOY_D1_DATABASE_ID,
      migrations_dir: "../../migrations",
    }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: values.DEPLOY_R2_BUCKET_NAME }],
    vars: {
      ENVIRONMENT: "production",
      SITE_URL: siteUrl.toString().replace(/\/$/, ""),
    },
  };
}

export function prepareDeployWranglerConfig(projectRoot, env = process.env) {
  const config = createDeployWranglerConfig(env);
  if (!config) return null;
  const relativePath = ".wrangler/generated/wrangler.jsonc";
  const outputPath = path.join(projectRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return relativePath;
}
