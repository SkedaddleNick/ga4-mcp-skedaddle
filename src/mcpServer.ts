// src/mcpServer.ts
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

// --- helpers: read env, lazy-create GA4 client ---
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
  throw new Error("GA4 credentials not configured (set GOOGLE_CLOUD_CREDENTIALS or CLIENT_EMAIL/PRIVATE_KEY).");
}

// --- very small tool registry ---
type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: any; // JSON Schema object (not zod)
  validate?: (input: unknown) => any; // optional zod validation
  run: (input: any) => Promise<any>;
};

const tools: Record<string, ToolDef> = {};

// util: convert zod schema -> JSON schema (manual minimal)
function jsonSchemaFromZodObject(shape: Record<string, any>, required: string[] = []) {
  const props: Record<string, any> = {};
  for (const [k, v] of Object.entries(shape)) {
    // ultra-minimal: just map common zod types we used
    const type =
      v?._def?.typeName === "ZodArray" ? "array" :
      v?._def?.typeName === "ZodNumber" ? "number" :
      v?._def?.typeName === "ZodBoolean" ? "boolean" :
      v?._def?.typeName === "ZodObject" ? "object" : "string";
    props[k] = { type };
  }
  return { type: "object", properties: props, required };
}

// ---- GA4: run_report tool ----
{
  const zInput = z.object({
    dateRanges: z.array(z.object({ startDate: z.string(), endDate: z.string() }))
      .default([{ startDate: "7daysAgo", endDate: "today" }]),
    dimensions: z.array(z.string()).default(["pagePath"]),
    metrics: z.array(z.string()).default(["activeUsers"]),
    limit: z.number().int().min(1).max(10000).default(100),
    offset: z.number().int().min(0).default(0),
    orderByMetric: z.string().optional(),
    orderDescending: z.boolean().default(true),
    filterExpression: z.any().optional(),
    includeQuota: z.boolean().default(true),
  });

  tools["ga4.run_report"] = {
    name: "ga4.run_report",
    title: "GA4 runReport",
    description: "Run a GA4 Core report with dimensions/metrics and date ranges.",
    inputSchema: jsonSchemaFromZodObject(zInput.shape),
    validate: (input) => zInput.parse(input),
    run: async (input) => {
      const args = zInput.parse(input);
      const ga4 = makeGa4Client();
      const property = getGa4PropertyPath();

      const request: any = {
        property,
        dateRanges: args.dateRanges,
        dimensions: args.dimensions.map((name: string) => ({ name })),
        metrics: args.metrics.map((name: string) => ({ name })),
        limit: String(args.limit),
        offset: String(args.offset),
        returnPropertyQuota: args.includeQuota,
      };
      if (args.orderByMetric) {
        request.orderBys = [{ metric: { metricName: args.orderByMetric }, desc: args.orderDescending }];
      }
      if (args.filterExpression) request.dimensionFilter = args.filterExpression;

      const [resp] = await ga4.runReport(request);

      const headers = [
        ...(resp.dimensionHeaders?.map((h) => ({ type: "dimension", name: h.name })) ?? []),
        ...(resp.metricHeaders?.map((h) => ({ type: "metric", name: h.name })) ?? []),
      ];
      const rows =
        resp.rows?.map((r) => [
          ...(r.dimensionValues ?? []).map((v) => v.value),
          ...(r.metricValues ?? []).map((v) => v.value),
        ]) ?? [];

      return {
        content: [{ type: "text", text: `Returned ${rows.length} rows.` }],
        structuredContent: {
          headers,
          rows,
          rowCount: rows.length,
          sampled: resp.rowCount !== undefined && rows.length < Number(resp.rowCount),
          quota: resp.propertyQuota ?? null,
        },
      };
    },
  };
}

// ---- GA4: realtime tool ----
{
  const zInput = z.object({
    dimensions: z.array(z.string()).default(["country"]),
    metrics: z.array(z.string()).default(["activeUsers"]),
    limit: z.number().int().min(1).max(10000).default(100),
  });

  tools["ga4.realtime"] = {
    name: "ga4.realtime",
    title: "GA4 realtime",
    description: "Get realtime active users by dimension.",
    inputSchema: jsonSchemaFromZodObject(zInput.shape),
    validate: (input) => zInput.parse(input),
    run: async (input) => {
      const args = zInput.parse(input);
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
}

// --- public API used by the route ---
export function listTools() {
  // Return minimal data schema ChatGPT expects
  return Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    title: t.title,
  }));
}

export async function callTool(name: string, args: any) {
  const t = tools[name];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  // Validate (if defined)
  const parsed = t.validate ? t.validate(args) : args;
  return await t.run(parsed);
}
