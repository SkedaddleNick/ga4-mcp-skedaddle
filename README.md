# GA4 MCP (Vercel)

## Deploy
1. Create a new GitHub repo with this code.
2. Import the repo into Vercel (New Project → pick repo).
3. Set Environment Variables in Vercel → Settings → Environment Variables:
   - GA4_PROPERTY_ID = 123456789
   - GOOGLE_CLOUD_CREDENTIALS = <paste full JSON of your service account>
     - Or instead set CLIENT_EMAIL and PRIVATE_KEY (with \n escapes) and optional GCP_PROJECT_ID
4. Deploy.

Your MCP endpoint will be: `https://<your-vercel-project>.vercel.app/api/mcp`

## Connect to ChatGPT
- ChatGPT → Settings → Apps & Connectors → Developer mode → Connectors → Create
- Connector URL: paste your `/api/mcp` HTTPS URL.

## Example Calls
- "Run a GA4 report: last 30 days, metrics activeUsers, dimensions country, limit 50."
- "Realtime users by country, limit 20."
