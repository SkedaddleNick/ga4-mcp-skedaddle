// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

function ok(res: VercelResponse, payload: any, id?: any, jsonrpc?: string) {
  if (jsonrpc) return res.status(200).json({ jsonrpc, id, result: payload });
  return res.status(200).json(payload);
}
function err(res: VercelResponse, message: string, id?: any, jsonrpc?: string, code = -32000) {
  if (jsonrpc) return res.status(200).json({ jsonrpc, id, error: { code, message } });
  return res.status(500).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel usually parses JSON, but be defensive
    const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const method = raw.method;
    const jsonrpc = typeof raw.jsonrpc === "string" ? raw.jsonrpc : undefined;
    const id = raw.id;

    // ----- tools/list -----
    if (method === "tools/list") {
      cons
