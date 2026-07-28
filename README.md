# ZWAWA

ZWAWA 是一个运行在 Astro 与 Cloudflare Workers 上的个人内容站模板，包含技术写作、游戏档案、画作、摄影、私有 Studio 和 Wechatsync 草稿接收接口。

公开页面由 Workers 提供，文章与设置保存在 D1，媒体保存在 R2；站点域名与 Cloudflare 资源由部署者自行配置，不写入公开仓库。

仓库中的 `ZWAWA`、示例文章和栏目文案用于展示完整界面，不代表部署者必须沿用该品牌。站点名称、描述、公开邮箱、外部链接和全站素材可在 Studio 中修改；需要彻底更换演示品牌时，再调整 `src/data/site.js` 与本地 Seed。

## 已实现

- 中文“星夜像素档案馆”公开站与响应式导航
- 文章、游戏、画作、摄影的列表、详情、标签、搜索和分页
- 多图作品灯箱、RSS、Sitemap、SEO 与旧 Slug 重定向
- Studio 内容总览、Markdown 分栏编辑、自动保存、预览、发布和归档
- Markdown Frontmatter 导入导出，兼容 Obsidian 与 VS Code
- D1 内容、标签、修订、设置、平台、凭据和统计数据
- R2 媒体上传、公开读取与内容图集关系
- Studio 从 R2 媒体库选择头像、全站背景、首页主图和后台登录图
- GitHub、Docker Hub 拉取量、RSS、Cloudflare Analytics、外链健康检查和手工统计状态
- Cloudflare Access 生产鉴权入口与本地签名 Cookie 登录
- WordPress XML-RPC 最小兼容层，供 Wechatsync 写入草稿和上传图片

## 本地启动

环境要求：Node.js 22 或更高版本。

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
Copy-Item wrangler.example.jsonc wrangler.jsonc
npm run db:migrate:local
npm run dev -- --host 127.0.0.1
```

新数据库默认没有文章，只保留站点栏目。需要本地演示内容时再执行 `npm run db:seed:local`；生产环境不要执行这个命令。

访问地址：

- 公开站：`http://127.0.0.1:4321`
- Studio：`http://127.0.0.1:4321/studio`

首次启动前应修改 `.dev.vars` 中的开发口令、API Token 与会话密钥，并按需调整本地 `wrangler.jsonc`。这两个文件已被 Git 忽略。

如果 Astro 已在后台运行：

```powershell
node scripts/run-astro.mjs dev status
node scripts/run-astro.mjs dev stop
```

## 内容模型

D1 是唯一在线内容源，GitHub 保存代码和可选 Markdown 备份。内容类型包括：

- `article`：技术文章与普通博客
- `game`：攻略、联机日志、模组笔记和世界记录
- `artwork`：画作、系列与创作过程
- `photo`：摄影专题与照片记录

状态统一为 `draft`、`published`、`archived`。画作和摄影发布前必须设置带替代文本的封面。

导出的 Markdown 使用以下 Frontmatter：

```markdown
---
id: post-id
title: 标题
slug: stable-slug
type: article
summary: 摘要
tags: [Astro, Cloudflare]
cover: /media/media-id
locale: zh-CN
publishedAt: null
---
```

导入带已有 `id` 的文件会先比较差异；所有导入内容均先进入草稿。

## Wechatsync

1. 登录 Studio，打开“连接”。
2. 在“Wechatsync 应用密码”中生成密码，并立即保存唯一一次显示的完整值。
3. 在 Wechatsync 中添加 WordPress 站点。
4. 本地站点地址填写 `http://127.0.0.1:4321`，用户名填写 `zwawa`，密码填写应用密码。

兼容入口为 `/xmlrpc.php`，只实现：

- `wp.getUsersBlogs`
- `wp.newPost`
- `wp.uploadFile`

无论客户端请求何种状态，`wp.newPost` 都只保存草稿。接口不等同于完整 WordPress，也不支持普通账户密码。

## 常用命令

```powershell
npm run dev
npm run build
npm run check
npm test
npm run test:e2e:install
npm run test:e2e
npm run db:migrate:local
npm run db:seed:local
```

Playwright 浏览器安装在被忽略的 `.playwright-browsers/` 中。

## 主要接口

- `GET /api/v1/content`：公开内容列表
- `GET /api/v1/content/:type/:slug`：公开内容详情
- `GET /api/v1/settings`：公开站点设置
- `/api/admin/content/**`：内容、发布、修订、导入导出和图集
- `/api/admin/media/**`：媒体管理
- `/api/admin/settings`：站点设置
- `/api/admin/platforms`：外部平台与 RSS
- `/api/admin/stats`：统计快照与刷新
- `/api/admin/credentials`：应用密码生成与撤销

后台接口要求有效 Studio 会话、Cloudflare Access 身份或本地管理 Token。

## 数据与安全

- D1 迁移位于 `migrations/`。
- R2 绑定名为 `MEDIA`，D1 绑定名为 `DB`。
- 公开 GitHub 仓库只保存应用框架、迁移、示例数据和 `wrangler.example.jsonc`；真实 `wrangler.jsonc`、正式文章与个人素材不进入 Git。
- 头像、全站背景、首页主图和后台登录图同样存储在 R2，由 Studio 的“站点设置”选择。
- `public/images/` 与 `private-assets/` 不进入 Git，公开仓库和 GitHub 自动构建不需要任何个人素材。
- Cloudflare Analytics 需要在 Secrets 中配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ZONE_ID`；未配置时 Studio 明确显示不可用。
- Markdown 输出会转义原始 HTML，并拒绝危险 URL Scheme。
- XML-RPC 拒绝 DTD、非法 Base64、SVG 和超过 25 MB 的图片。
- 应用密码使用 256 位随机值，D1 只保存 SHA-256 摘要，支持撤销和最近使用时间。
- 本项目是单管理员内容站，不提供访客注册或站内账户系统。
- 正式环境不启用本地口令登录，应由 Cloudflare Access 同时保护 `/studio*` 和 `/api/admin/*`。
- 公开页面不展示 Studio 入口；后台地址是否隐藏不属于安全边界，仍必须依赖 Access 鉴权。
- 不要通过未受 Access 保护的备用域名暴露同一个 Worker；建议关闭 `workers.dev` 与 Preview URLs，并只保留已配置 Access 的自定义域名。
- Wechatsync 只能使用 Studio 生成的可撤销应用密码，不应复用邮箱、Cloudflare 或其他平台密码。

## 部署边界

推荐由 Cloudflare 连接公开 GitHub 仓库并自动部署 Workers。生产环境需要单独创建真实 D1/R2、执行迁移、配置 Secrets、Cloudflare Access、域名路由和 Email Routing。不要在生产环境执行本地 Seed，也不要把真实 `wrangler.jsonc`、`.dev.vars` 或示例口令提交到仓库。

自动部署前，先在 Cloudflare Dashboard 中打开目标 Worker，然后进入“设置 → 构建 → 变量和机密”。在生产构建环境添加以下变量：

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `DEPLOY_WORKER_NAME` | Worker 名称 | `your-blog` |
| `DEPLOY_D1_DATABASE_NAME` | D1 数据库名称 | `your-blog-db` |
| `DEPLOY_D1_DATABASE_ID` | D1 Database ID | `00000000-0000-0000-0000-000000000000` |
| `DEPLOY_R2_BUCKET_NAME` | R2 存储桶名称 | `your-blog-media` |
| `DEPLOY_SITE_URL` | 公开站点绝对地址 | `https://blog.example.com` |

Worker、D1、R2 名称和站点 URL 可以使用普通构建变量；Database ID 可以设为 Secret。这里的 Secret 只用于减少个人部署信息暴露，不代表 Database ID 本身能够授权访问数据库。

保持以下构建设置：

```text
Build command: npm run build
Deploy command: npx wrangler deploy --config dist/server/wrangler.json
```

`npm run build` 检测到这组完整变量后，会在被忽略的 `.wrangler/` 目录生成临时配置；缺少任意一项都会终止构建。生成文件仅存在于当前构建环境，部署产物会自动带上 D1、R2 和 `SITE_URL` 绑定。

首次切换到私有构建变量时，应按以下顺序操作：

1. 在 Cloudflare 中添加并保存全部五个变量。
2. 确认构建与部署命令和上方一致。
3. 再推送移除真实 `wrangler.jsonc` 的代码提交。
4. 检查首次部署日志中的 Worker 名称以及 D1、R2 绑定。
5. 访问公开站、`/api/v1/settings` 和受 Access 保护的 `/studio` 做上线验证。

需要从本机手动部署时，可以继续使用被 Git 忽略的真实 `wrangler.jsonc`：

```text
npm run deploy
```

这些变量应在推送去个人化配置前设置完成。Database ID 与桶名不是访问密钥，但仍作为个人部署信息保留在 Cloudflare 构建环境中。
