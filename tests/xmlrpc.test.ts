import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike, R2BucketLike } from "../src/lib/server/types";
import {
  dispatchXmlRpcCall,
  htmlToSafeMarkdown,
  parseXmlRpcCall,
  serializeXmlRpcFault,
  serializeXmlRpcResponse,
  XmlRpcFault,
  type XmlRpcDependencies,
  type XmlRpcRuntime,
} from "../src/lib/xmlrpc";

const runtime: XmlRpcRuntime = {
  db: {} as D1DatabaseLike,
  bucket: {} as R2BucketLike,
  siteUrl: "https://blog.example.com",
};

function dependencies(overrides: Partial<XmlRpcDependencies> = {}): XmlRpcDependencies {
  return {
    verifyCredential: vi.fn(async () => ({ id: "credential-1" })),
    createContent: vi.fn(async () => ({ id: "post-1" })),
    storeMedia: vi.fn(async () => ({ id: "media-1" })),
    slugExists: vi.fn(async () => false),
    ...overrides,
  };
}

describe("XML-RPC protocol", () => {
  it("parses the exact wp.uploadFile shape sent by Wechatsync", () => {
    const call = parseXmlRpcCall(`<?xml version="1.0" encoding="UTF-8"?>
      <methodCall><methodName>wp.uploadFile</methodName><params>
        <param><value><int>0</int></value></param>
        <param><value><string>zwawa</string></value></param>
        <param><value><string>zw_secret</string></value></param>
        <param><value><struct>
          <member><name>name</name><value><string>picture.png</string></value></member>
          <member><name>type</name><value><string>image/png</string></value></member>
          <member><name>bits</name><value><base64>AQID</base64></value></member>
          <member><name>overwrite</name><value><boolean>1</boolean></value></member>
        </struct></value></param>
      </params></methodCall>`);

    expect(call.methodName).toBe("wp.uploadFile");
    expect(call.params.slice(0, 3)).toEqual([0, "zwawa", "zw_secret"]);
    expect(call.params[3]).toMatchObject({ name: "picture.png", type: "image/png", overwrite: true });
    expect(Array.from((call.params[3] as { bits: Uint8Array }).bits)).toEqual([1, 2, 3]);
  });

  it("escapes successful and fault responses as XML", () => {
    const response = serializeXmlRpcResponse({ url: "https://example.com/a?x=1&y=2" });
    expect(response).toContain("<name>url</name><value><string>https://example.com/a?x=1&amp;y=2</string></value>");
    const fault = serializeXmlRpcFault(403, "bad <password>");
    expect(fault).toContain("<fault>");
    expect(fault).toContain("bad &lt;password&gt;");
  });

  it("rejects DTD input and malformed Base64", () => {
    expect(() => parseXmlRpcCall("<!DOCTYPE x><methodCall><methodName>x</methodName></methodCall>"))
      .toThrow(XmlRpcFault);
    expect(() => parseXmlRpcCall(
      "<methodCall><methodName>x</methodName><params><param><value><base64>***</base64></value></param></params></methodCall>",
    )).toThrow("Base64");
  });

  it("accepts an explicitly empty params element", () => {
    expect(parseXmlRpcCall(
      "<methodCall><methodName>system.listMethods</methodName><params></params></methodCall>",
    )).toEqual({ methodName: "system.listMethods", params: [] });
  });
});

describe("Wechatsync compatibility", () => {
  it("removes active HTML and converts safe content to Markdown", () => {
    const markdown = htmlToSafeMarkdown(`
      <h2>标题</h2><script>alert(1)</script>
      <p><strong>正文</strong> <a href="javascript:alert(2)">危险链接</a></p>
      <img src="https://cdn.example.com/a.png" alt="示例" onerror="alert(3)">
    `);
    expect(markdown).toContain("## 标题");
    expect(markdown).toContain("**正文** 危险链接");
    expect(markdown).toContain("![示例](<https://cdn.example.com/a.png>)");
    expect(markdown).not.toMatch(/alert|javascript|onerror/i);
  });

  it("always creates wp.newPost as a draft", async () => {
    const deps = dependencies();
    const result = await dispatchXmlRpcCall({
      methodName: "wp.newPost",
      params: [0, "zwawa", "zw_secret", {
        post_title: "同一个标题",
        post_content: "<p>Hello <strong>world</strong>.</p>",
        post_status: "publish",
        post_type: "post",
      }],
    }, runtime, deps);

    expect(result).toBe("post-1");
    expect(deps.verifyCredential).toHaveBeenCalledWith(runtime.db, "zwawa", "zw_secret", "xmlrpc:write");
    expect(deps.createContent).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
      status: "draft",
      title: "同一个标题",
      slug: "同一个标题",
      bodyMarkdown: "Hello **world**.",
      publishedAt: null,
      metadata: expect.objectContaining({ requestedStatus: "publish", importedVia: "xmlrpc" }),
    }), "xmlrpc");
  });

  it("stores supported image uploads and returns an absolute URL", async () => {
    const deps = dependencies();
    const result = await dispatchXmlRpcCall({
      methodName: "wp.uploadFile",
      params: [0, "zwawa", "zw_secret", {
        name: "folder\\picture.jpg",
        type: "image/jpg",
        bits: new Uint8Array([1, 2, 3]),
        overwrite: true,
      }],
    }, runtime, deps);

    expect(result).toEqual({
      id: "media-1",
      file: "picture.jpg",
      url: "https://blog.example.com/media/media-1",
      type: "image/jpeg",
    });
    expect(deps.storeMedia).toHaveBeenCalledWith(runtime.db, runtime.bucket, expect.objectContaining({
      fileName: "picture.jpg",
      mimeType: "image/jpeg",
      byteSize: 3,
    }));
  });

  it("returns an authentication fault for a bad application password", async () => {
    const deps = dependencies({ verifyCredential: vi.fn(async () => null) });
    await expect(dispatchXmlRpcCall({
      methodName: "wp.getUsersBlogs",
      params: ["zwawa", "wrong"],
    }, runtime, deps)).rejects.toMatchObject({ faultCode: 403 });
  });
});
