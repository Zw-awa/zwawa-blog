import { AppError } from "../server/errors";
import {
  parseXmlRpcCall,
  serializeXmlRpcFault,
  serializeXmlRpcResponse,
  XmlRpcFault,
} from "./protocol";
import { dispatchXmlRpcCall, type XmlRpcRuntime } from "./service";

const MAX_XMLRPC_REQUEST_BYTES = 36 * 1024 * 1024;

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizeFault(error: unknown): XmlRpcFault {
  if (error instanceof XmlRpcFault) return error;
  if (error instanceof AppError) {
    const code = error.status === 401 || error.status === 403 ? 403 : error.status;
    return new XmlRpcFault(code, error.message);
  }
  console.error("XML-RPC request failed", error);
  return new XmlRpcFault(-32500, "服务器处理 XML-RPC 请求时发生错误。");
}

export function xmlRpcErrorResponse(error: unknown): Response {
  const fault = normalizeFault(error);
  return xmlResponse(serializeXmlRpcFault(fault.faultCode, fault.message));
}

async function readXmlBody(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/xml") && !contentType.includes("application/xml")) {
    throw new XmlRpcFault(415, "XML-RPC 请求必须使用 text/xml 或 application/xml。" );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_XMLRPC_REQUEST_BYTES) {
    throw new XmlRpcFault(413, "XML-RPC 请求体过大。");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_XMLRPC_REQUEST_BYTES) throw new XmlRpcFault(413, "XML-RPC 请求体过大。");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new XmlRpcFault(-32700, "XML-RPC 请求必须是有效的 UTF-8 文本。");
  }
}

export async function handleXmlRpcRequest(request: Request, runtime: XmlRpcRuntime): Promise<Response> {
  try {
    const call = parseXmlRpcCall(await readXmlBody(request));
    return xmlResponse(serializeXmlRpcResponse(await dispatchXmlRpcCall(call, runtime)));
  } catch (error) {
    return xmlRpcErrorResponse(error);
  }
}
