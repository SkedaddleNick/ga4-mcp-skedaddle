import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildServer } from "../src/mcpServer.js";

const server = buildServer();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const body = req.body ?? {};
    const response = await server.handle(body);
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(response);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
}
