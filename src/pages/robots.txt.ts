import type { APIRoute } from "astro";
import { getSiteUrl } from "../lib/server/env";

export const prerender = false;

export const GET: APIRoute = ({ locals, request }) => {
  const siteUrl = getSiteUrl(locals, request.url);
  const body = `User-agent: *\nAllow: /\nDisallow: /studio\nDisallow: /api/admin\nSitemap: ${siteUrl}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
