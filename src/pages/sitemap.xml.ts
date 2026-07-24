import type { APIRoute } from "astro";
import { siteMeta } from "../data/site.js";
import { contentHref, listAllPublicContent } from "../lib/public-data";

export const prerender = false;

const staticPaths = ["/", "/writing", "/games", "/gallery/art", "/gallery/photo", "/links", "/about"];

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const GET: APIRoute = async ({ locals }) => {
  const records = await listAllPublicContent(locals);
  const urls = [
    ...staticPaths.map((path) => ({ loc: new URL(path, siteMeta.url).toString(), lastmod: null })),
    ...records.map((item) => ({ loc: new URL(contentHref(item), siteMeta.url).toString(), lastmod: item.updatedAt }))
  ];
  const entries = urls
    .map(({ loc, lastmod }) => `<url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ""}</url>`)
    .join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
};
