import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_CLOUD_CREDENTIALS;
const CLIENT_EMAIL = process.env.CLIENT_EMAIL;
const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/\\n/g, "\n");
const PROJECT_ID = process.env.GCP_PROJECT_ID;

function makeGa4Client() {
  if (SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(SERVICE_ACCOUNT_JSON);
    return new BetaAnalyticsDataClient({
      projectId: PROJECT_ID || creds.project_id,
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key,
      },
    });
  }
  if (CLIENT_EMAIL && PRIVATE_KEY) {
    return new BetaAnalyticsDataClient({
      projectId: PROJECT_ID,
      credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
    });
  }
  throw new Error("Missing GA4 credentials. Provide GOOGLE_CLOUD_CREDENTIALS or CLIENT_EMAIL/PRIVATE_KEY env vars.");
}

export function buildServer() {
  const server = new McpServer({ name: "ga4-mcp", version: "1.0.0" });

  const ga4 = makeGa4Client();
  const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
  if (!GA4_PROPERTY_ID) throw new Error("Missing GA4_PROPERTY_ID env var");
  const propertyPath = `properties/${GA4_PROPERTY_ID}`;

  server.registerTool(
    "ga4.run_report",
    {
      title: "GA4 runReport",
      description: "Run a GA4 Core report with dimensions/metrics and date ranges.",
      inputSchema: {
        dateRanges: z.array(z.object({ startDate: z.string(), endDate: z.string() })).default([{ startDate: "7daysAgo", endDate: "today" }]),
        dimensions: z.array(z.string()).default(["pagePath"]),
        metrics: z.array(z.string()).default(["activeUsers"]),
        limit: z.number().int().min(1).max(10000).default(100),
        offset: z.number().int().min(0).default(0),
        orderByMetric: z.string().optional(),
        orderDescending: z.boolean().default(true),
        filterExpression: z.any().optional(),
        includeQuota: z.boolean().default(true)
      }
    },
    async (input) => {
      const request: any = {
        property: propertyPath,
        dateRanges: input.dateRanges,
        dimensions: input.dimensions.map((name: string) => ({ name })),
        metrics: input.metrics.map((name: string) => ({ name })),
        limit: String(input.limit),
        offset: String(input.offset),
        returnPropertyQuota: input.includeQuota,
      };
      if (input.orderByMetric) {
        request.orderBys = [
          { metric: { metricName: input.orderByMetric }, desc: input.orderDescending },
        ];
      }
      if (input.filterExpression) request.dimensionFilter = input.filterExpression;

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
        structuredContent: {
          headers,
          rows,
          rowCount: rows.length,
          sampled: resp.rowCount !== undefined && rows.length < Number(resp.rowCount),
          quota: resp.propertyQuota ?? null,
        },
        content: [{ type: "text", text: `Returned ${rows.length} rows.` }],
      };
    }
  );

  server.registerTool(
    "ga4.realtime",
    {
      title: "GA4 realtime",
      description: "Get realtime active users by dimension.",
      inputSchema: {
        dimensions: z.array(z.string()).default(["country"]),
        metrics: z.array(z.string()).default(["activeUsers"]),
        limit: z.number().int().min(1).max(10000).default(100)
      }
    },
    async (input) => {
      const request: any = {
        property: propertyPath,
        dimensions: input.dimensions.map((name: string) => ({ name })),
        metrics: input.metrics.map((name: string) => ({ name })),
        limit: String(input.limit)
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
    }
  );

  return server;
}
