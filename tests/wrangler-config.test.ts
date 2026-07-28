import { describe, expect, it } from "vitest";
import { createDeployWranglerConfig, DEPLOY_VARIABLES } from "../scripts/prepare-wrangler-config.mjs";

const completeEnvironment = {
  DEPLOY_WORKER_NAME: "example-blog",
  DEPLOY_D1_DATABASE_NAME: "example-blog-db",
  DEPLOY_D1_DATABASE_ID: "11111111-1111-1111-1111-111111111111",
  DEPLOY_R2_BUCKET_NAME: "example-blog-media",
  DEPLOY_SITE_URL: "https://blog.example.com/",
};

describe("deployment Wrangler config", () => {
  it("leaves local builds on the developer-owned Wrangler config", () => {
    expect(createDeployWranglerConfig({})).toBeNull();
  });

  it("rejects a partially configured deployment", () => {
    expect(() => createDeployWranglerConfig({ DEPLOY_WORKER_NAME: "example-blog" }))
      .toThrow(DEPLOY_VARIABLES.slice(1).join(", "));
  });

  it("maps private build variables into Worker bindings", () => {
    const config = createDeployWranglerConfig(completeEnvironment);
    expect(config?.name).toBe("example-blog");
    expect(config?.d1_databases[0]).toMatchObject({
      binding: "DB",
      database_name: "example-blog-db",
      database_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(config?.r2_buckets[0]).toEqual({ binding: "MEDIA", bucket_name: "example-blog-media" });
    expect(config?.vars).toEqual({ ENVIRONMENT: "production", SITE_URL: "https://blog.example.com" });
  });
});
