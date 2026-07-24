import type { APIRoute } from "astro";
import { getDb, getMediaBucket, getSiteUrl } from "../lib/server/env";
import { handleXmlRpcRequest, xmlRpcErrorResponse } from "../lib/xmlrpc";

export const prerender = false;

export const GET: APIRoute = () => new Response("XML-RPC server accepts POST requests only.", {
  status: 405,
  headers: {
    allow: "POST",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  },
});

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    return await handleXmlRpcRequest(request, {
      db: getDb(locals),
      bucket: getMediaBucket(locals),
      siteUrl: getSiteUrl(locals, request.url),
    });
  } catch (error) {
    return xmlRpcErrorResponse(error);
  }
};
