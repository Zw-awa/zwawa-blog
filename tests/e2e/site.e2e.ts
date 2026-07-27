import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
}

test("public archive renders seeded content without overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ZWAWA 星夜像素档案馆", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到 ZWAWA 档案馆", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
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
