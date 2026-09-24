import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const i=line.indexOf("="); if(i>0) env[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^['\"]|['\"]$/g,""); }
const runId = "gn09fQ8Egi3VtHnom";
const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${env.APIFY_API_TOKEN}` } });
const j = await r.json();
console.log(`STATUS_HTTP=${r.status} RUN_STATUS=${j.data?.status || "unknown"} HAS_DATASET=${Boolean(j.data?.defaultDatasetId)}`);
