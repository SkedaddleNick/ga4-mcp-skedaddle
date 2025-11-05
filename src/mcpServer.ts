// src/mcpServer.ts (minimal to satisfy the connector)
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

function getGa4PropertyPath() {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("Missing GA4_PROPERTY_ID");
  return `properties/${id}`;
}
function makeGa4Client() {
  const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_CLOUD_CREDENTIALS;
  const CLIENT_EMAIL = process.env.CLIENT_EMAIL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/\\n/g, "\n");
  const PROJECT_ID = process.env.GCP_PROJECT_ID;

  if (SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(SERVICE_ACCOUNT_JSON);
    return new BetaAnalyticsDataClient({
      projectId: PROJECT_ID || creds.project_id,
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
    });
  }
  if (CLIENT_EMAIL && PRIVATE_KEY) {
    return new BetaAnalyticsDataClient({
      projectId: PROJECT_ID,
      credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
    });
  }
  throw new Error("GA4 credentials not configured.");
}

type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
  validate?: (input: unknown) => any;
  run: (input: any) => Promise<any>;
};
const tools: Record<string, ToolDef> = {};

// --- minimal realtime tool, very plain JSON Schema (no unions, no nested arrays of objects)
const zRealtime = z.object({
  dimensions: z.array(z.string()).default(["country"]),
  metrics: z.array(z.string()).default(["activeUsers"]),
  limit: z.number().int().min(1).max(10000).default(10),
});

tools["ga4.realtime"] = {
  name: "ga4.realtime",
  title: "GA4 realtime",
  description: "Get realtime active users by dimension.",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    properties: {
      dimensions: { type: "array", items: { type: "string" }, description: "e.g. ['country']" },
      metrics:    { type: "array", items: { type: "string" }, description: "e.g. ['activeUsers']" },
      limit:      { type: "integer", minimum: 1, maximum: 10000, description: "Max rows to return" }
    },
    required: ["dimensions", "metrics"]
  },
  validate: (input) => zRealtime.parse(input),
  run: async (input) => {
    const args = zRealtime.parse(input);
    const ga4 = makeGa4Client();
    const property = getGa4PropertyPath();

    const request: any = {
      property,
      dimensions: args.dimensions.map((name: string) => ({ name })),
      metrics: args.metrics.map((name: string) => ({ name })),
      limit: String(args.limit),
    };
    const [resp] = await ga4.runRealtimeReport(request);

    const headers = [
      ...(resp.dimensionHeaders?.map((h) => ({ type: "dimension", name: h.name })) ?? []),
      ...(resp.metricHeaders?.map((h) => ({ type: "metric", name: h.name })) ?? []),
    ];
    const rows =
      resp.rows?.map((r) => [
        ...(r.dimensionValues ?? []).map((v) => v.value),
        ...(r.metricValues ?? []).map((v) => v.value),
      ]) ?? [];

    return { structuredContent: { headers, rows, rowCount: rows.length } };
  },
};

export function listTools() {
  return Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    title: t.title,
    inputSchema: t.inputSchema,
    input_schema: t.inputSchema,
    parameters: {
      type: "object",
      properties: t.inputSchema.properties || {},
      required: t.inputSchema.required || [],
      additionalProperties: false
    }
  }));
}
export async function callTool(name: string, args: any) {
  const t = tools[name];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  const parsed = t.validate ? t.validate(args) : args;
  return await t.run(parsed);
}
