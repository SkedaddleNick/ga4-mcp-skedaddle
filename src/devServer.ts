import express from "express";
import { buildServer } from "./mcpServer.js";

const app = express();
app.use(express.json());
const server = buildServer();

app.post("/mcp", async (req, res) => {
  const response = await server.handle(req.body);
  res.json(response);
});

app.listen(8787, () => console.log("Dev MCP on http://localhost:8787/mcp"));
