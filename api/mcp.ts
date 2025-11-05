// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

function setCORS(res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

// Turn our internal tool into a strict Actions-style action
function toAction(t: any) {
  const schema = t.inputSchema || t.input_schema || {};
  return {
    name: t.name, // underscore-only name
    description: t.description,
    parameters: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: schema.properties ?? {},
      required: schema.required ?? []
    }
  };
}

function log(prefix: string, obj: unknown) {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    console.log(prefix, String(s).slice(0, 500));
  } catch {
    console.log(prefix, "<unserializable>");
  }
}

function ok(res: VercelResponse, payload: any) {
  setCORS(res);
  return res.status(200).json(payload);
}

function normalize(method?: string) {
  return (method || "").replace(/\./g, "/"); // tools.list -> tools/list
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    setCORS(res);
    return res.status(204).send("");
  }

  if (req.method === "GET") {
    // Friendly GET (browser probes)
    const m = normalize((req.query?.method as string) || "");
    if (m === "tools/list") {
      const actions = listTools().map(toAction);
      log("GET tools/list -> actions:", actions);
      return ok(res, { actions });
    }
    return ok(res, {
      mcp: true,
      message:
        'POST {"method":"tools.list"} or {"method":"tools.call","name":"...","arguments":{...}}'
    });
  }

  if (req.method === "POST") {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      log("POST body:", raw);
      const jsonrpc = typeof (raw as any).jsonrpc === "string" ? (raw as any).jsonrpc : undefined;
      const id = (raw as any).id;
      const methodOriginal = (raw as any).method;
      const method = normalize(methodOriginal);

      if (method === "tools/list") {
        const actions = listTools().map(toAction);
        const payload = jsonrpc ? { jsonrpc, id, result: { actions } } : { actions };
        log("REPLY tools.list:", payload);
        return ok(res, payload);
      }

      if (method === "tools/call") {
        const name =
          (raw as any).name ??
          (raw as any).tool_name ??
          (raw as any).params?.name ??
          (raw as any).params?.tool_name;
        const args =
          (raw as any).arguments ??
          (raw as any).params?.arguments ??
          (raw as any).args ??
          {};
        if (!name) {
          const payload = jsonrpc
            ? { jsonrpc, id, error: { code: -32602, message: "Missing tool name" } }
            : { error: "Missing tool name" };
          log("REPLY tools.call (missing name):", payload);
          return ok(res, payload);
        }
        const result = await callTool(name, args);
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY tools.call:", payload);
        return ok(res, payload);
      }

      const payload = jsonrpc
        ? { jsonrpc, id, error: { code: -32601, message: `Unsupported method: ${methodOriginal}` } }
        : { error: `Unsupported method: ${methodOriginal}` };
      log("REPLY unsupported:", payload);
      return ok(res, payload);
    } catch (e: any) {
      console.error("Handler error:", e?.message || e);
      setCORS(res);
      return res.status(500).json({ error: e?.message || "Internal Server Error" });
    }
  }

  setCORS(res);
  res.setHeader("Allow", "POST, GET, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
