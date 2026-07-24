export const supportedLocales = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

const messages = {
  "zh-CN": {
    "a11y.skip": "跳到正文",
    "nav.label": "主导航",
    "nav.open": "打开导航",
    "nav.close": "关闭导航",
    "nav.search": "搜索站内内容",
    "footer.email": "邮件",
    "footer.sitemap": "站点地图",
  },
  en: {
    "a11y.skip": "Skip to content",
    "nav.label": "Main navigation",
    "nav.open": "Open navigation",
    "nav.close": "Close navigation",
    "nav.search": "Search this site",
    "footer.email": "Email",
    "footer.sitemap": "Sitemap",
  },
} as const;

export type TranslationKey = keyof (typeof messages)["zh-CN"];

export function resolveLocale(value: string | null | undefined): SupportedLocale {
  return value?.toLowerCase().startsWith("en") ? "en" : "zh-CN";
}
export function createTranslator(locale: string | null | undefined) {
  const resolved = resolveLocale(locale);
  return (key: TranslationKey): string => messages[resolved][key] ?? messages["zh-CN"][key];
}
