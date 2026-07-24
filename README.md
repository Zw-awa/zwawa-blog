# ZWAWA

ZWAWA 是一个运行在 Astro 与 Cloudflare Workers 上的个人内容站，包含技术写作、游戏档案、画作、摄影、私有 Studio 和 Wechatsync 草稿接收接口。

当前阶段只完成本地代码与本地 Cloudflare 资源模拟，`zwawa.dpdns.org` 的正式部署、Access 策略和生产 Secrets 留到下一阶段。

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
npm run db:migrate:local
npm run dev -- --host 127.0.0.1
```

新数据库默认没有文章，只保留站点栏目。需要本地演示内容时再执行 `npm run db:seed:local`；生产环境不要执行这个命令。

访问地址：

- 公开站：`http://127.0.0.1:4321`
- Studio：`http://127.0.0.1:4321/studio`

首次启动前应修改 `.dev.vars` 中的开发口令、API Token 与会话密钥。该文件已被 Git 忽略。

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
- 公开 GitHub 仓库只保存应用框架、迁移和示例数据；正式文章保存在 D1，文章图片与作品原图保存在 R2。
- 头像、全站背景、首页主图和后台登录图同样存储在 R2，由 Studio 的“站点设置”选择。
- `public/images/` 与 `private-assets/` 不进入 Git，公开仓库和 GitHub 自动构建不需要任何个人素材。
- Cloudflare Analytics 需要在 Secrets 中配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ZONE_ID`；未配置时 Studio 明确显示不可用。
- Markdown 输出会转义原始 HTML，并拒绝危险 URL Scheme。
- XML-RPC 拒绝 DTD、非法 Base64、SVG 和超过 25 MB 的图片。
- 应用密码使用 256 位随机值，D1 只保存 SHA-256 摘要，支持撤销和最近使用时间。
- 正式环境不启用本地口令登录，应由 Cloudflare Access 保护 `/studio*`。

## 部署边界

推荐由 Cloudflare 连接公开 GitHub 仓库并自动部署 Workers。生产环境需要单独创建真实 D1/R2、执行迁移、配置 Secrets、Cloudflare Access、域名路由和 Email Routing。不要在生产环境执行本地 Seed，也不要把本地 `database_id`、`.dev.vars` 或示例口令提交到仓库。
