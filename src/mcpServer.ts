// src/mcpServer.ts
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

/* -------------------------- GA4 helpers (lazy init) -------------------------- */
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

/* ------------------------------- Tool registry ------------------------------- */
type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: any;           // JSON Schema
  validate?: (input: unknown) => any; // zod
  run: (input: any) => Promise<any>;
};
const tools: Record<string, ToolDef> = {};

/* -------------------------------- ga4_realtime ------------------------------- */
const zRealtime = z.object({
  dimensions: z.array(z.string()).default(["country"]),
  metrics: z.array(z.string()).default(["activeUsers"]),
  limit: z.number().int().min(1).max(10000).default(10),
});

tools["ga4_realtime"] = {
  name: "ga4_realtime",
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

/* ------------------------------ ga4_run_report ------------------------------- */
const zRunReport = z.object({
  dateRanges: z.array(z.object({ startDate: z.string(), endDate: z.string() }))
              .default([{ startDate: "7daysAgo", endDate: "today" }]),
  dimensions: z.array(z.string()).default(["pagePath"]),
  metrics: z.array(z.string()).default(["activeUsers"]),
  limit: z.number().int().min(1).max(10000).default(100),
  offset: z.number().int().min(0).default(0),
  orderByMetric: z.string().optional(),
  orderDescending: z.boolean().default(true),
  filterExpression: z.any().optional(), // pass-through
  includeQuota: z.boolean().default(true),
});

tools["ga4_run_report"] = {
  name: "ga4_run_report",
  title: "GA4 runReport",
  description: "Run a GA4 Core report with dimensions/metrics and date ranges.",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    properties: {
      dateRanges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { startDate: { type: "string" }, endDate: { type: "string" } },
          required: ["startDate", "endDate"]
        },
        description: "Supports 'YYYY-MM-DD' and relative values like '7daysAgo'/'today'."
      },
      dimensions: { type: "array", items: { type: "string" } },
      metrics:    { type: "array", items: { type: "string" } },
      limit:      { type: "integer", minimum: 1, maximum: 10000 },
      offset:     { type: "integer", minimum: 0 },
      orderByMetric:   { type: "string" },
      orderDescending: { type: "boolean" },
      filterExpression:{ type: "object", additionalProperties: true },
      includeQuota:    { type: "boolean" }
    },
    required: ["dimensions","metrics","dateRanges"]
  },
  validate: (input) => zRunReport.parse(input),
  run: async (input) => {
    const args = zRunReport.parse(input);
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
        headers, rows, rowCount: rows.length,
        sampled: resp.rowCount !== undefined && rows.length < Number(resp.rowCount),
        quota: resp.propertyQuota ?? null
      }
    };
  },
};

/* --------------------------- Exports for the route --------------------------- */
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
  // support legacy names with dots by aliasing them to underscores
  const normalized = (name as string).replace(/\./g, "_");
  const t = tools[normalized];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  const parsed = t.validate ? t.validate(args) : args;
  return await t.run(parsed);
}
