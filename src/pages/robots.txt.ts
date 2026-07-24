import type { APIRoute } from "astro";
import { siteMeta } from "../data/site.js";

export const prerender = true;

export const GET: APIRoute = () => {
  const body = `User-agent: *\nAllow: /\nDisallow: /studio\nDisallow: /api/admin\nSitemap: ${siteMeta.url}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
