import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = ({ request, redirect }) => {
  const postId = new URL(request.url).searchParams.get("post")?.trim();
  if (!postId || postId.length > 160) return redirect("/studio", 302);
  return redirect(`/studio/content/${encodeURIComponent(postId)}/edit`, 302);
};
