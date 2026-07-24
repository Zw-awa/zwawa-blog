import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

export type XmlRpcStruct = { [key: string]: XmlRpcValue };
export type XmlRpcValue = string | number | boolean | null | Uint8Array | XmlRpcValue[] | XmlRpcStruct;

export interface XmlRpcCall {
  methodName: string;
  params: XmlRpcValue[];
}

export class XmlRpcFault extends Error {
  readonly faultCode: number;

  constructor(faultCode: number, message: string) {
    super(message);
    this.name = "XmlRpcFault";
    this.faultCode = faultCode;
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  parseTagValue: false,
  trimValues: false,
  maxNestedTags: 64,
  isArray: (tagName, jPath) =>
    tagName === "param" ||
    tagName === "member" ||
    (tagName === "value" && typeof jPath === "string" && jPath.endsWith(".array.data.value")),
  processEntities: {
    enabled: true,
    maxEntitySize: 256,
    maxExpansionDepth: 4,
    maxTotalExpansions: 2_000,
    maxExpandedLength: 40 * 1024 * 1024,
    maxEntityCount: 100,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value) && own(value, "#text")) return text(value["#text"]);
  throw new XmlRpcFault(-32600, "XML-RPC 值格式无效。");
}

function decodeBase64(value: unknown): Uint8Array {
  const encoded = text(value).replace(/\s+/g, "");
  if (!encoded) return new Uint8Array();
  if (
    encoded.length % 4 === 1 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new XmlRpcFault(-32602, "上传内容不是有效的 Base64 数据。");
  }
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new XmlRpcFault(-32602, "上传内容不是有效的 Base64 数据。");
  }
}

function decodeStruct(value: unknown, depth: number): XmlRpcStruct {
  if (value === "" || value == null) return Object.create(null) as XmlRpcStruct;
  if (!isRecord(value)) throw new XmlRpcFault(-32600, "XML-RPC struct 格式无效。");
  const members = value.member == null ? [] : Array.isArray(value.member) ? value.member : [value.member];
  const result: XmlRpcStruct = Object.create(null) as XmlRpcStruct;
  for (const member of members) {
    if (!isRecord(member)) throw new XmlRpcFault(-32600, "XML-RPC struct member 格式无效。");
    const name = text(member.name);
    if (!name || own(result, name)) throw new XmlRpcFault(-32600, "XML-RPC struct 包含无效或重复字段。");
    result[name] = decodeValue(member.value, depth + 1);
  }
  return result;
}

function decodeArray(value: unknown, depth: number): XmlRpcValue[] {
  if (!isRecord(value)) throw new XmlRpcFault(-32600, "XML-RPC array 格式无效。");
  if (value.data === "" || value.data == null) return [];
  if (!isRecord(value.data)) throw new XmlRpcFault(-32600, "XML-RPC array 格式无效。");
  if (value.data.value === "" || value.data.value == null) return [];
  const values = value.data.value == null ? [] : Array.isArray(value.data.value) ? value.data.value : [value.data.value];
  return values.map((item) => decodeValue(item, depth + 1));
}

function decodeValue(value: unknown, depth = 0): XmlRpcValue {
  if (depth > 32) throw new XmlRpcFault(-32600, "XML-RPC 值嵌套过深。");
  if (value == null || typeof value === "string") return text(value);
  if (!isRecord(value)) throw new XmlRpcFault(-32600, "XML-RPC value 格式无效。");

  if (own(value, "string")) return text(value.string);
  if (own(value, "int") || own(value, "i4")) {
    const raw = text(own(value, "int") ? value.int : value.i4);
    if (!/^[+-]?\d+$/.test(raw)) throw new XmlRpcFault(-32600, "XML-RPC 整数格式无效。");
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) throw new XmlRpcFault(-32600, "XML-RPC 整数超出范围。");
    return parsed;
  }
  if (own(value, "boolean")) {
    const raw = text(value.boolean).trim().toLowerCase();
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    throw new XmlRpcFault(-32600, "XML-RPC boolean 格式无效。");
  }
  if (own(value, "double")) {
    const parsed = Number(text(value.double));
    if (!Number.isFinite(parsed)) throw new XmlRpcFault(-32600, "XML-RPC 浮点数格式无效。");
    return parsed;
  }
  if (own(value, "base64")) return decodeBase64(value.base64);
  if (own(value, "dateTime.iso8601")) return text(value["dateTime.iso8601"]);
  if (own(value, "nil")) return null;
  if (own(value, "struct")) return decodeStruct(value.struct, depth + 1);
  if (own(value, "array")) return decodeArray(value.array, depth + 1);
  if (own(value, "#text")) return text(value["#text"]);
  throw new XmlRpcFault(-32600, "XML-RPC value 缺少受支持的类型。");
}

export function parseXmlRpcCall(xml: string): XmlRpcCall {
  if (!xml.trim()) throw new XmlRpcFault(-32700, "XML 请求不能为空。");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlRpcFault(-32700, "XML 请求不能包含 DTD 或自定义实体。");
  const validation = SyntaxValidator.validate(xml);
  if (validation !== true) throw new XmlRpcFault(-32700, "XML 请求格式无效。");

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    throw new XmlRpcFault(-32700, "XML 请求无法解析。");
  }
  if (!isRecord(parsed) || !isRecord(parsed.methodCall)) {
    throw new XmlRpcFault(-32600, "请求不是有效的 XML-RPC methodCall。");
  }
  const methodName = text(parsed.methodCall.methodName).trim();
  if (!methodName) throw new XmlRpcFault(-32600, "XML-RPC 请求缺少 methodName。");
  const paramsNode = parsed.methodCall.params;
  if (paramsNode == null || paramsNode === "") return { methodName, params: [] };
  if (!isRecord(paramsNode)) throw new XmlRpcFault(-32600, "XML-RPC params 格式无效。");
  const paramNodes = paramsNode.param == null ? [] : Array.isArray(paramsNode.param) ? paramsNode.param : [paramsNode.param];
  const params = paramNodes.map((param) => {
    if (!isRecord(param) || !own(param, "value")) throw new XmlRpcFault(-32600, "XML-RPC param 缺少 value。");
    return decodeValue(param.value);
  });
  return { methodName, params };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function encodeXmlRpcValue(value: XmlRpcValue): string {
  if (value === null) return "<value><nil/></value>";
  if (typeof value === "string") return `<value><string>${escapeXml(value)}</string></value>`;
  if (typeof value === "boolean") return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("XML-RPC cannot encode a non-finite number.");
    const tag = Number.isInteger(value) ? "int" : "double";
    return `<value><${tag}>${value}</${tag}></value>`;
  }
  if (value instanceof Uint8Array) return `<value><base64>${encodeBase64(value)}</base64></value>`;
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(encodeXmlRpcValue).join("")}</data></array></value>`;
  }
  const members = Object.entries(value).map(
    ([name, item]) => `<member><name>${escapeXml(name)}</name>${encodeXmlRpcValue(item)}</member>`,
  );
  return `<value><struct>${members.join("")}</struct></value>`;
}

export function serializeXmlRpcResponse(value: XmlRpcValue): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<methodResponse><params><param>${encodeXmlRpcValue(value)}</param></params></methodResponse>`;
}

export function serializeXmlRpcFault(faultCode: number, faultString: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<methodResponse><fault>${encodeXmlRpcValue({ faultCode, faultString })}</fault></methodResponse>`;
}
