// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools, callTool } from "../src/mcpServer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body ?? {};
    const method = body.method;

    if (method === "tools/list") {
      return res.status(200).json({ tools: listTools() });
    }

    if (method === "tools/call") {
      const name = body.name;
      const args = body.arguments ?? {};
      const result = await callTool(name, args);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: `Unsupported method: ${method}` });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
}
