export const siteMeta = {
  title: "ZWAWA",
  tagline: "星夜像素档案馆",
  description: "ZWAWA 的个人档案馆：技术写作、游戏世界、画作与摄影。",
  owner: "ZWAWA",
  email: "hello@example.com",
  url: "https://blog.example.com",
  locale: "zh-CN",
  keywords: ["ZWAWA", "个人博客", "技术写作", "游戏", "画作", "摄影"]
};

export const navItems = [
  { href: "/", label: "首页", match: "exact" },
  { href: "/writing", label: "写作" },
  { href: "/games", label: "游戏" },
  { href: "/gallery/art", label: "画作" },
  { href: "/gallery/photo", label: "摄影" },
  { href: "/links", label: "链接" },
  { href: "/about", label: "关于" }
];

export const socialLinks = [
  { label: "哔哩哔哩", shortLabel: "B站", href: "https://space.bilibili.com/", note: "视频、游戏记录与生活切片", mark: "B" },
  { label: "GitHub", shortLabel: "GitHub", href: "https://github.com/", note: "代码、实验与开源项目", mark: "GH" },
  { label: "Docker Hub", shortLabel: "Docker", href: "https://hub.docker.com/", note: "容器镜像与发布记录", mark: "DH" },
  { label: "爱发电", shortLabel: "爱发电", href: "https://afdian.com/", note: "创作支持与特别内容", mark: "AF" }
];

export const writingPlatforms = [
  { name: "博客园", href: "https://www.cnblogs.com/", focus: "方案、范式与长期笔记", note: "偏完整的技术推导和可复用经验。" },
  { name: "DEV Community", href: "https://dev.to/", focus: "英文项目与构建故事", note: "面向更广泛读者的项目记录。" },
  { name: "CSDN", href: "https://blog.csdn.net/", focus: "问题与解决路径", note: "环境问题、构建错误和实用解法。" },
  { name: "掘金", href: "https://juejin.cn/", focus: "中文技术长文", note: "实现拆解、架构取舍和重构记录。" },
  { name: "SegmentFault", href: "https://segmentfault.com/", focus: "实验与踩坑档案", note: "保留尝试过程，也保留失败分支。" },
  { name: "开源中国", href: "https://www.oschina.net/", focus: "开源项目动态", note: "仓库发布、版本更新和公开里程碑。" }
];

export const gameWorlds = [
  {
    slug: "terraria",
    title: "泰拉瑞亚",
    english: "Terraria",
    mark: "TR",
    summary: "从第一棵树到月球领主：多人存档、建筑、模组与冒险记录。",
    topics: ["联机日志", "模组", "建筑"]
  },
  {
    slug: "minecraft",
    title: "我的世界",
    english: "Minecraft",
    mark: "MC",
    summary: "方块世界里的自动化、服务器纪事、建筑草图与远行。",
    topics: ["生存档", "自动化", "服务器"]
  },
  {
    slug: "starbound",
    title: "星界边境",
    english: "Starbound",
    mark: "SB",
    summary: "沿着星图收集奇异行星、殖民地故事与宇宙旅途碎片。",
    topics: ["探索", "殖民地", "星图"]
  }
];

export const linkCollections = [
  { title: "创作与身份", eyebrow: "IDENTITY", links: socialLinks },
  {
    title: "写作分站",
    eyebrow: "WRITING",
    links: writingPlatforms.map((platform) => ({
      label: platform.name,
      href: platform.href,
      note: platform.focus,
      mark: platform.name.slice(0, 2).toUpperCase()
    }))
  }
];

export const archiveRooms = [
  { href: "/writing", index: "01", title: "技术写作", note: "代码、系统与构建记录" },
  { href: "/games", index: "02", title: "游戏世界", note: "联机日志与世界档案" },
  { href: "/gallery/art", index: "03", title: "画作展墙", note: "角色、色彩与创作过程" },
  { href: "/gallery/photo", index: "04", title: "摄影底片", note: "街头、旅途与安静物件" }
];
