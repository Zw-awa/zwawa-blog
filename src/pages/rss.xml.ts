import type { APIRoute } from "astro";
import { siteMeta } from "../data/site.js";
import { contentHref, getPublicSiteIdentity, listAllPublicContent } from "../lib/public-data";

export const prerender = false;

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = async ({ locals }) => {
  const [records, identity] = await Promise.all([listAllPublicContent(locals), getPublicSiteIdentity(locals)]);
  const items = records
    .map((item) => {
      const link = new URL(contentHref(item), siteMeta.url).toString();
      const pubDate = new Date(item.publishedAt).toUTCString();
      return `<item><title>${xml(item.title)}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid><description>${xml(item.summary)}</description><category>${xml(item.typeLabel)}</category><pubDate>${pubDate}</pubDate></item>`;
    })
    .join("");

  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(identity.name)}</title><link>${xml(siteMeta.url)}</link><description>${xml(identity.description)}</description><language>${xml(identity.locale)}</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
};
