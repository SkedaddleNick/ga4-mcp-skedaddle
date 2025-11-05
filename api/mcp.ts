// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

/* -------------------------- CORS & helpers -------------------------- */
function setCORS(res: VercelResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}
function log(prefix: string, obj: unknown) {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    console.log(prefix, String(s).slice(0, 500));
  } catch {
    console.log(prefix, "<unserializable>");
  }
}
function ok(res: VercelResponse, payload: any) { setCORS(res); return res.status(200).json(payload); }
function normalize(m?: string) {
  const s = (m || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "/");
  if (s === "tools/list" || s === "actions/list" || s === "list" || s === "get/actions") return "tools/list";
  if (s === "tools/call"  || s === "actions/call"  || s === "call" || s === "invoke")   return "tools/call";
  return s;
}

/* -------------------------- adapters -------------------------- */
function toAction(t: any) {
  const schema = t.inputSchema || t.input_schema || {};
  return {
    name: t.name,
    description: t.description,
    parameters: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: schema.properties ?? {},
      required: schema.required ?? [],
    },
  };
}
function toTool(t: any) {
  const schema = t.inputSchema || t.input_schema || {};
  return {
    name: t.name,
    description: t.description,
    inputSchema: schema,
    input_schema: schema, // alias for some clients
  };
}

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") { setCORS(res); return res.status(204).send(""); }

  // helpful GET for manual checks
  if (req.method === "GET") {
    const actions = listTools().map(toAction);
    log("GET tools/list -> actions:", actions);
    return ok(res, { schema_version: "v1", actions, tools: listTools().map(toTool) });
  }

  if (req.method === "POST") {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      log("POST body:", raw);

      const jsonrpc = typeof (raw as any).jsonrpc === "string" ? (raw as any).jsonrpc : undefined;
      const id = (raw as any).id;
      const origMethod = (raw as any).method;
      const method = normalize(origMethod);

      // 1) MCP handshake
      if (method === "initialize") {
        const result = {
          protocolVersion: (raw as any)?.params?.protocolVersion ?? "2025-01-01",
          serverInfo: { name: "ga4-mcp", version: "1.0.0" },
          capabilities: { tools: { list: true, call: true }, actions: { list: true, call: true } },
        };
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY initialize:", payload);
        return ok(res, payload);
      }

      // 2) Some clients send this right after initialize; respond with empty success
      if (method === "notifications/initialized") {
        const payload = jsonrpc ? { jsonrpc, id, result: {} } : {};
        log("REPLY notifications/initialized:", payload);
        return ok(res, payload);
      }

      // 3) List actions/tools
      if (method === "tools/list") {
        const actions = listTools().map(toAction);
        const tools = listTools().map(toTool);
        const result = { schema_version: "v1", actions, tools };
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY list:", payload);
        return ok(res, payload);
      }

      // 4) Call tool
      if (method === "tools/call") {
        const name =
          (raw as any).name ?? (raw as any).tool_name ??
          (raw as any).params?.name ?? (raw as any).params?.tool_name;
        const args =
          (raw as any).arguments ?? (raw as any).params?.arguments ?? (raw as any).args ?? {};
        if (!name) {
          const payload = jsonrpc ? { jsonrpc, id, error: { code: -32602, message: "Missing tool name" } }
                                  : { error: "Missing tool name" };
          log("REPLY call (missing name):", payload);
          return ok(res, payload);
        }
        const result = await callTool(name, args);
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY call:", payload);
        return ok(res, payload);
      }

      // 5) Fallback: return actions/tools so the client can still build
      const actions = listTools().map(toAction);
      const tools = listTools().map(toTool);
      const result = { schema_version: "v1", actions, tools, note: `fallback for method: ${origMethod}` };
      const payload = jsonrpc ? { jsonrpc, id, result } : result;
      log("REPLY fallback:", payload);
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
