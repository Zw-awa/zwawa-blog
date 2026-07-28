import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
}

test("public archive renders seeded content without overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ZWAWA 星夜像素档案馆", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到 ZWAWA 档案馆", exact: true })).toBeVisible();
  await expect(page.locator('.site-footer a[href="/studio"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
});

test("public metadata and discovery endpoints share the configured site origin", async ({ page, request }) => {
  await page.goto("/");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBeTruthy();
  const siteUrl = new URL(canonical as string);
  expect(siteUrl.pathname).toBe("/");
  await expect(page.locator(".hero-coordinates li").first()).toContainText(siteUrl.host);

  const [rss, sitemap, robots] = await Promise.all([
    request.get("/rss.xml"),
    request.get("/sitemap.xml"),
    request.get("/robots.txt"),
  ]);
  expect(rss.ok()).toBe(true);
  expect(sitemap.ok()).toBe(true);
  expect(robots.ok()).toBe(true);
  const [rssBody, sitemapBody, robotsBody] = await Promise.all([
    rss.text(),
    sitemap.text(),
    robots.text(),
  ]);
  expect(rssBody).toContain(`<link>${siteUrl.origin}</link>`);
  expect(sitemapBody).toContain(`<loc>${siteUrl.origin}/</loc>`);
  expect(robotsBody).toContain(`Sitemap: ${siteUrl.origin}/sitemap.xml`);
});

test("published article and search are reachable", async ({ page }) => {
  await page.goto("/writing/welcome-to-zwawa");
  await expect(page.getByRole("heading", { name: "欢迎来到 ZWAWA 档案馆" })).toBeVisible();
  await page.goto("/search?q=ZWAWA");
  await expect(page.getByText("欢迎来到 ZWAWA 档案馆")).toBeVisible();
});

test("mobile navigation opens and remains inside the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only interaction");
  await page.goto("/");
  await page.locator(".nav-toggle").click();
  await expect(page.locator(".site-nav")).toHaveAttribute("data-open", "");
  await expect(page.getByRole("link", { name: "游戏", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-navigation.png"), fullPage: true });
});

test("Studio login opens dashboard and Markdown editor", async ({ page }, testInfo) => {
  const adminPassword = process.env.ADMIN_DEV_PASSWORD;
  expect(adminPassword, "ADMIN_DEV_PASSWORD must be configured in .dev.vars").toBeTruthy();
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/studio\/login/);
  await page.locator('input[name="password"]').fill(adminPassword as string);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("heading", { name: "内容总览" })).toBeVisible();
  await page.goto("/studio?view=settings");
  await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
  await expect(page.locator(".site-asset-field")).toHaveCount(4);
  await page.goto("/studio/content/seed-welcome/edit");
  await expect(page.locator(".editor-meta-grid input").first()).toHaveValue("欢迎来到 ZWAWA 档案馆");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".markdown-preview")).toContainText("第一盏灯");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("studio-editor.png"), fullPage: true });
});

test("Studio permanently deletes content in every publication state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "destructive content workflow only needs one browser project");
  const adminPassword = process.env.ADMIN_DEV_PASSWORD;
  expect(adminPassword, "ADMIN_DEV_PASSWORD must be configured in .dev.vars").toBeTruthy();
  await page.goto("/studio");
  await page.locator('input[name="password"]').fill(adminPassword as string);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/studio$/);

  const suffix = Date.now().toString(36);
  for (const status of ["draft", "published", "archived"] as const) {
    const title = `删除测试-${status}-${suffix}`;
    const created = await page.evaluate(async ({ title, status }) => {
      const response = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "article",
          status,
          title,
          slug: title,
          summary: "用于验证 Studio 永久删除流程。",
          bodyMarkdown: "# 删除测试",
        }),
      });
      return { status: response.status, body: await response.json() };
    }, { title, status });
    expect(created.status).toBe(201);
    const id = (created.body as { data: { id: string } }).data.id;

    await page.goto("/studio?view=content");
    const search = page.getByPlaceholder("搜索标题、摘要或正文");
    await search.fill(title);
    await search.press("Enter");
    await expect(page.getByRole("button", { name: `永久删除《${title}》` })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `永久删除《${title}》` }).click();
    await expect(page.getByText("没有符合条件的内容")).toBeVisible();

    const getStatus = await page.evaluate(async (id) => (await fetch(`/api/admin/content/${encodeURIComponent(id)}`)).status, id);
    expect(getStatus).toBe(404);
  }
});

test("Studio archive preserves content until it is permanently deleted", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "destructive content workflow only needs one browser project");
  const adminPassword = process.env.ADMIN_DEV_PASSWORD;
  expect(adminPassword, "ADMIN_DEV_PASSWORD must be configured in .dev.vars").toBeTruthy();
  await page.goto("/studio");
  await page.locator('input[name="password"]').fill(adminPassword as string);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/studio$/);

  const suffix = Date.now().toString(36);
  const title = `归档测试-${suffix}`;
  const bodyMarkdown = "# 归档测试\n\n归档后正文应继续存在。";
  const created = await page.evaluate(async ({ title, bodyMarkdown }) => {
    const response = await fetch("/api/admin/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "article",
        status: "draft",
        title,
        slug: title,
        summary: "用于验证归档不会永久删除内容。",
        bodyMarkdown,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { title, bodyMarkdown });
  expect(created.status).toBe(201);
  const id = (created.body as { data: { id: string } }).data.id;
  const resourcePath = `/api/admin/content/${encodeURIComponent(id)}`;

  await page.goto(`/studio/content/${encodeURIComponent(id)}/edit`);
  await expect(page.locator(".editor-meta-grid input").first()).toHaveValue(title);

  const requests: Array<{ method: string; body: string | null }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === resourcePath) {
      requests.push({ method: request.method(), body: request.postData() });
    }
  });
  const archiveResponse = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== resourcePath || response.request().method() !== "PATCH") return false;
    try {
      return (response.request().postDataJSON() as { status?: string }).status === "archived";
    } catch {
      return false;
    }
  });
  await page.getByTitle("归档").click();
  expect((await archiveResponse).status()).toBe(200);

  expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  expect(requests.some((request) => request.method === "PATCH" && request.body === JSON.stringify({ status: "archived" }))).toBe(true);

  const archived = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return { status: response.status, body: await response.json() };
  }, resourcePath);
  expect(archived.status).toBe(200);
  expect((archived.body as { data: { id: string; status: string; bodyMarkdown: string } }).data).toMatchObject({
    id,
    status: "archived",
    bodyMarkdown,
  });

  const deletedStatus = await page.evaluate(async (path) => (await fetch(path, { method: "DELETE" })).status, resourcePath);
  expect(deletedStatus).toBe(204);
  const missingStatus = await page.evaluate(async (path) => (await fetch(path)).status, resourcePath);
  expect(missingStatus).toBe(404);
});
