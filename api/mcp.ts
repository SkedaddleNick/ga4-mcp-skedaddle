// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

function send(res: VercelResponse, code: number, body: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.status(code).send(typeof body === "string" ? body : JSON.stringify(body));
}

function ok(res: VercelResponse, payload: any, id?: any, jsonrpc?: string) {
  if (jsonrpc) return send(res, 200, { jsonrpc, id, result: payload });
  return send(res, 200, payload);
}
function err(res: VercelResponse, message: string, id?: any, jsonrpc?: string, code = -32000) {
  if (jsonrpc) return send(res, 200, { jsonrpc, id, error: { code, message } });
  return send(res, 500, { error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- OPTIONS (CORS preflight) ---
  if (req.method === "OPTIONS") return send(res, 204, "");

  // --- Friendly GET handler (probes & manual tests) ---
  if (req.method === "GET") {
    const method = (req.query?.method as string) || "";
    if (method === "tools/list") {
      const tools = listTools().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        input_schema: t.inputSchema,
        title: t.title,
      }));
      return ok(res, { tools });
    }
    return ok(res, {
      mcp: true,
      message: "POST with {\"method\":\"tools/list\"} or {\"method\":\"tools/call\",\"name\":\"...\",\"arguments\":{...}}",
      endpoints: { list: "tools/list", call: "tools/call" }
    });
  }

  // --- POST (main MCP gateway) ---
  if (req.method === "POST") {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      const method = raw.method;
      const jsonrpc = typeof raw.jsonrpc === "string" ? raw.jsonrpc : undefined;
      const id = raw.id;

      if (method === "tools/list") {
        const tools = listTools().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          input_schema: t.inputSchema,
          title: t.title,
        }));
        return ok(res, { tools }, id, jsonrpc);
      }

      if (method === "tools/call") {
        const name = raw.name ?? raw.params?.name;
        const args = raw.arguments ?? raw.params?.arguments ?? {};
        if (!name) return err(res, "Missing tool name", id, jsonrpc);
        const result = await callTool(name, args);
        return ok(res, result, id, jsonrpc);
      }

      return err(res, `Unsupported method: ${method}`, id, jsonrpc, -32601);
    } catch (e: any) {
      console.error(e);
      return err(res, e?.message || "Internal Server Error");
    }
  }

  // Anything else -> 405
  res.setHeader("Allow", "POST, GET, OPTIONS");
  return send(res, 405, { error: "Method Not Allowed" });
}
