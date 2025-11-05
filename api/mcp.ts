// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

function setCORS(res: VercelResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

function toCompatTool(t: any) {
  // Provide ALL shapes some clients look for
  const schema = t.inputSchema || t.input_schema || {};
  return {
    name: t.name,
    title: t.title,
    description: t.description,

    // MCP-ish
    inputSchema: schema,
    input_schema: schema,

    // Actions-style
    parameters: {
      type: "object",
      properties: schema.properties ?? {},
      required: schema.required ?? [],
      additionalProperties: false,
    },
  };
}

function ok(res: VercelResponse, payload: any, id?: any, jsonrpc?: string) {
  setCORS(res);
  if (jsonrpc) return res.status(200).json({ jsonrpc, id, result: payload });
  return res.status(200).json(payload);
}
function err(res: VercelResponse, message: string, id?: any, jsonrpc?: string, code = -32601) {
  setCORS(res);
  if (jsonrpc) return res.status(200).json({ jsonrpc, id, error: { code, message } });
  return res.status(500).json({ error: message });
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
    const m = normalize((req.query?.method as string) || "");
    if (m === "tools/list") {
      const tools = listTools().map(toCompatTool);
      // Return tools AND actions for maximum compatibility
      return ok(res, { schema_version: "v1", tools, actions: tools });
    }
    return ok(res, {
      mcp: true,
      message:
        'POST {"method":"tools/list"} or {"method":"tools/call","name":"...","arguments":{...}} (JSON-RPC accepted).',
      endpoints: { list: "tools/list|tools.list", call: "tools/call|tools.call" },
    });
  }

  if (req.method === "POST") {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      const jsonrpc = typeof raw.jsonrpc === "string" ? raw.jsonrpc : undefined;
      const id = raw.id;
      const method = normalize(raw.method);

      if (method === "tools/list") {
        const tools = listTools().map(toCompatTool);
        return ok(res, { schema_version: "v1", tools, actions: tools }, id, jsonrpc);
      }

      if (method === "tools/call") {
        const name =
          raw.name ?? raw.tool_name ?? raw.params?.name ?? raw.params?.tool_name;
        const args = raw.arguments ?? raw.params?.arguments ?? raw.args ?? {};
        if (!name) return err(res, "Missing tool name", id, jsonrpc, -32602);
        const result = await callTool(name, args);
        return ok(res, result, id, jsonrpc);
      }

      return err(res, `Unsupported method: ${raw.method}`, id, jsonrpc, -32601);
    } catch (e: any) {
      console.error(e);
      return err(res, e?.message || "Internal Server Error");
    }
  }

  setCORS(res);
  res.setHeader("Allow", "POST, GET, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
