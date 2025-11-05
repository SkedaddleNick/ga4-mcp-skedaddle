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
function ok(res: VercelResponse, payload: any) {
  setCORS(res);
  return res.status(200).json(payload);
}
function normalize(m?: string) {
  const s = (m || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "/");
  // common aliases
  if (s === "tools/list" || s === "actions/list" || s === "list" || s === "get/actions") return "tools/list";
  if (s === "tools/call"  || s === "actions/call"  || s === "call" || s === "invoke")   return "tools/call";
  return s;
}
function toAction(t: any) {
  const schema = t.inputSchema || t.input_schema || {};
  return {
    name: t.name, // underscore-safe
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

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    setCORS(res);
    return res.status(204).send("");
  }

  // Friendly GET for manual/browser checks
  if (req.method === "GET") {
    const method = normalize((req.query?.method as string) || "");
    const actions = listTools().map(toAction);
    if (method === "tools/list" || method === "") {
      log("GET list -> actions:", actions);
      return ok(res, { actions });
    }
    log("GET unknown -> actions:", { method, count: actions.length });
    return ok(res, { actions });
  }

  if (req.method === "POST") {
    try {
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      log("POST body:", raw);

      const jsonrpc = typeof (raw as any).jsonrpc === "string" ? (raw as any).jsonrpc : undefined;
      const id = (raw as any).id;
      const origMethod = (raw as any).method;
      const method = normalize(origMethod);

      /* -------- MCP handshake: initialize -------- */
      if (method === "initialize") {
        // Respond OK and advertise capabilities so client continues
        const result = {
          protocolVersion: (raw as any)?.params?.protocolVersion ?? "2025-01-01",
          serverInfo: { name: "ga4-mcp", version: "1.0.0" },
          capabilities: {
            // advertise both so various clients proceed
            tools:   { list: true, call: true },
            actions: { list: true, call: true },
          },
        };
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY initialize:", payload);
        return ok(res, payload);
      }

      /* -------------------- List actions/tools -------------------- */
      if (method === "tools/list") {
        const actions = listTools().map(toAction);
        const payload = jsonrpc ? { jsonrpc, id, result: { actions } } : { actions };
        log("REPLY list:", payload);
        return ok(res, payload);
      }

      /* ------------------------ Call tool ------------------------- */
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
          log("REPLY call (missing name):", payload);
          return ok(res, payload);
        }
        const result = await callTool(name, args);
        const payload = jsonrpc ? { jsonrpc, id, result } : result;
        log("REPLY call:", payload);
        return ok(res, payload);
      }

      /* -------- Fallback: if unknown, still hand back actions ----- */
      const actions = listTools().map(toAction);
      const payload = jsonrpc
        ? { jsonrpc, id, result: { actions, note: `fallback for method: ${origMethod}` } }
        : { actions, note: `fallback for method: ${origMethod}` };
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
