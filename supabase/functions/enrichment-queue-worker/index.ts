import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, unknown>;
type ReconcileRun = {
  id: string;
  actor_run_id: string;
  default_dataset_id: string | null;
  attempts: number;
  max_attempts: number;
  message_id: number | null;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async () => {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!baseUrl || !serviceKey) return json({ error: "runtime_not_configured" }, 503);

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  const report: Json[] = [];

  // Reconciliation always runs before consuming a new message. It does not
  // depend on PGMQ visibility and therefore heals runs even if a callback was
  // lost after the external Actor had already completed.
  const stale = await rpc<ReconcileRun[]>(baseUrl, headers, "claim_enrichment_reconciliation", {
    p_lease_seconds: 120,
    p_limit: 5,
  });
  if (!stale.ok) return json({ status: "reconciliation_claim_failed", detail: stale.error }, 502);

  for (const run of stale.data || []) {
    const outcome = await reconcileRun(baseUrl, headers, apifyToken, run);
    report.push(outcome);
  }

  const claim = await rpc<Array<{ msg_id: number; message: Json }>>(baseUrl, headers, "claim_enrichment_job", {
    p_visibility_seconds: 300,
  });
  if (!claim.ok) return json({ status: "claim_failed", reconciled: report, detail: claim.error }, 502);
  const message = claim.data?.[0];
  if (!message) return json({ status: report.length ? "reconciled" : "idle", reconciled: report, processed: 0 });

  const runId = String(message.message?.run_id || "");
  const payload = (message.message?.payload && typeof message.message.payload === "object"
    ? message.message.payload : {}) as Json;
  const current = await rest<Array<{ actor_run_id: string | null; status: string }>>(
    baseUrl,
    headers,
    `enrichment_runs?id=eq.${encodeURIComponent(runId)}&select=actor_run_id,status&limit=1`,
  );
  if (!current.ok || !current.data?.[0]) return json({ status: "run_not_found", runId }, 404);
  if (current.data[0].actor_run_id) {
    return json({ status: "already_started", jobId: runId, actorRunId: current.data[0].actor_run_id, reconciled: report });
  }
  if (!apifyToken) {
    const failure = await failAttempt(baseUrl, headers, runId, "CONFIGURATION_ERROR", "APIFY_API_TOKEN absent");
    return json({ status: failure.status, jobId: runId, reconciled: report }, 503);
  }

  const input = {
    searchStringsArray: [String(payload.company || "")],
    locationQuery: String(payload.location || "Belgique"),
    maxCrawledPlacesPerSearch: 1,
    language: "fr",
    maximumLeadsEnrichmentRecords: 1,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 1,
  };
  const launch = await fetch(
    "https://api.apify.com/v2/acts/lukaskrivka~google-maps-with-contact-details/runs?waitForFinish=0&maxTotalChargeUsd=0.8&maxItems=1",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apifyToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const launchBody = await launch.json().catch(() => ({})) as Json;
  const actorRunId = String((launchBody.data as Json | undefined)?.id || launchBody.id || "");
  if (!launch.ok || !actorRunId) {
    const failure = await failAttempt(baseUrl, headers, runId, "LAUNCH_FAILED", `Apify launch failed (${launch.status})`);
    return json({ status: failure.status, jobId: runId, reconciled: report }, 502);
  }

  const now = new Date().toISOString();
  const saved = await rest(baseUrl, headers, `enrichment_runs?id=eq.${encodeURIComponent(runId)}&actor_run_id=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: "running",
      provider_status: "RUNNING",
      actor_run_id: actorRunId,
      progress: 20,
      locked_at: null,
      heartbeat_at: now,
      lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
      result: { messageId: message.msg_id, actorRunId },
    },
  });
  if (!saved.ok) return json({ status: "run_state_save_failed", jobId: runId, actorRunId }, 502);

  await registerWebhook(apifyToken, actorRunId);
  return json({ status: "running", processed: 1, jobId: runId, actorRunId, reconciled: report });
});

async function reconcileRun(baseUrl: string, headers: HeadersInit, token: string | undefined, run: ReconcileRun): Promise<Json> {
  if (!token) return failAttempt(baseUrl, headers, run.id, "CONFIGURATION_ERROR", "APIFY_API_TOKEN absent");
  try {
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.actor_run_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return failAttempt(baseUrl, headers, run.id, "STATUS_CHECK_ERROR", `Apify status HTTP ${response.status}`);
    const envelope = await response.json() as { data?: Json };
    const provider = envelope.data || {};
    const status = String(provider.status || "UNKNOWN").toUpperCase();

    if (status === "SUCCEEDED") {
      const datasetId = String(provider.defaultDatasetId || run.default_dataset_id || "");
      if (!datasetId) return failAttempt(baseUrl, headers, run.id, "DATASET_MISSING", "Run Apify réussi sans dataset");
      const item = await fetchDatasetItem(token, datasetId);
      if (!item.ok) return failAttempt(baseUrl, headers, run.id, "DATASET_FETCH_ERROR", item.error);
      const completed = await rpc<Json>(baseUrl, headers, "finalize_enrichment_run", {
        p_run_id: run.id,
        p_actor_run_id: run.actor_run_id,
        p_dataset_id: datasetId,
        p_item: item.data,
        p_event_id: null,
        p_usage_total_usd: numeric(provider.usageTotalUsd),
      });
      if (!completed.ok) return failAttempt(baseUrl, headers, run.id, "FINALIZATION_ERROR", completed.error);
      if (run.message_id != null) await rpc(baseUrl, headers, "ack_enrichment_job", { p_msg_id: run.message_id });
      return { ...completed.data, source: "reconciliation" };
    }

    if (["FAILED", "TIMED-OUT", "TIMED_OUT", "ABORTED"].includes(status)) {
      const failed = await failAttempt(baseUrl, headers, run.id, status, String(provider.statusMessage || `Run Apify ${status}`));
      if (failed.terminal && run.message_id != null) await rpc(baseUrl, headers, "archive_enrichment_job", { p_msg_id: run.message_id });
      return failed;
    }

    const renewed = await rpc(baseUrl, headers, "renew_enrichment_lease", {
      p_run_id: run.id,
      p_provider_status: status,
      p_lease_seconds: 120,
    });
    return renewed.ok ? { status: "active", jobId: run.id, providerStatus: status } : { status: "lease_error", jobId: run.id };
  } catch (error) {
    return failAttempt(baseUrl, headers, run.id, "RECONCILIATION_ERROR", safeMessage(error));
  }
}

async function failAttempt(baseUrl: string, headers: HeadersInit, runId: string, status: string, message: string): Promise<Json> {
  const failed = await rpc<Json>(baseUrl, headers, "fail_enrichment_attempt", {
    p_run_id: runId,
    p_provider_status: status,
    p_error_message: message.slice(0, 2000),
    p_event_id: null,
  });
  return failed.ok && failed.data ? failed.data : { status: "failure_record_error", jobId: runId, error: failed.error };
}

async function fetchDatasetItem(token: string, datasetId: string) {
  try {
    const response = await fetch(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return { ok: false as const, error: `Dataset HTTP ${response.status}` };
    const items = await response.json() as Json[];
    return { ok: true as const, data: Array.isArray(items) ? items[0] || {} : {} };
  } catch (error) {
    return { ok: false as const, error: safeMessage(error) };
  }
}

async function registerWebhook(token: string, actorRunId: string) {
  const callback = Deno.env.get("APIFY_CALLBACK_URL");
  const webhookSecret = Deno.env.get("APIFY_WEBHOOK_SECRET");
  if (!callback || !webhookSecret) return;
  await fetch(`https://api.apify.com/v2/webhooks?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
      requestUrl: callback,
      condition: { actorRunId },
      payloadTemplate: "{\"eventType\":\"{{eventType}}\",\"resource\":{{resource}}}",
      headersTemplate: JSON.stringify({ "x-apify-webhook-secret": webhookSecret }),
    }),
  }).catch(() => null);
}

async function rpc<T = unknown>(baseUrl: string, headers: HeadersInit, name: string, body: Json) {
  return rest<T>(baseUrl, headers, `rpc/${name}`, { method: "POST", body });
}

async function rest<T = unknown>(baseUrl: string, headers: HeadersInit, path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  try {
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers: { ...(headers as Record<string, string>), ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as T : undefined;
    return response.ok ? { ok: true as const, data } : { ok: false as const, error: text.slice(0, 1000) };
  } catch (error) {
    return { ok: false as const, error: safeMessage(error) };
  }
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}
