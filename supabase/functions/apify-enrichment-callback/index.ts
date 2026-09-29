import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, unknown>;
type Run = {
  id: string;
  actor_run_id: string;
  default_dataset_id: string | null;
  result: Json | null;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async (request) => {
  const webhookSecret = Deno.env.get("APIFY_WEBHOOK_SECRET");
  const supplied = request.headers.get("x-apify-webhook-secret") || new URL(request.url).searchParams.get("secret");
  if (!webhookSecret || supplied !== webhookSecret) return json({ error: "unauthorized" }, 401);

  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!baseUrl || !serviceKey || !apifyToken) return json({ error: "runtime_not_configured" }, 503);
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };

  const body = await request.json().catch(() => ({})) as Json;
  const resource = body.resource && typeof body.resource === "object" ? body.resource as Json : {};
  const eventId = request.headers.get("x-apify-webhook-id") || String(body.id || body.eventId || stableEventId(body));
  const eventType = String(body.eventType || body.event_type || "").toUpperCase();
  const actorRunId = String(resource.id || body.actorRunId || body.actor_run_id || "");
  const datasetFromEvent = String(resource.defaultDatasetId || body.defaultDatasetId || "");
  if (!actorRunId || !eventType) return json({ error: "invalid_event" }, 400);

  const eventInsert = await rest(baseUrl, headers, "provider_webhook_events?on_conflict=provider,event_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: {
      provider: "apify",
      event_id: eventId,
      actor_run_id: actorRunId,
      event_type: eventType,
      dataset_id: datasetFromEvent || null,
      payload: body,
    },
  });
  if (!eventInsert.ok) return json({ error: "event_persist_failed", detail: eventInsert.error }, 502);

  const previous = await rest<Array<{ processed_at: string | null; attempts: number }>>(
    baseUrl,
    headers,
    `provider_webhook_events?provider=eq.apify&event_id=eq.${encodeURIComponent(eventId)}&select=processed_at,attempts&limit=1`,
  );
  if (previous.data?.[0]?.processed_at) return json({ status: "duplicate", eventId });

  const found = await rest<Run[]>(
    baseUrl,
    headers,
    `enrichment_runs?actor_run_id=eq.${encodeURIComponent(actorRunId)}&select=id,actor_run_id,default_dataset_id,result&limit=1`,
  );
  const run = found.data?.[0];
  if (!found.ok || !run) {
    await markEventError(baseUrl, headers, eventId, null, "Actor run non associé à un enrichment_run");
    return json({ status: "ignored", reason: "run_not_found", actorRunId }, 202);
  }
  await rest(baseUrl, headers, `provider_webhook_events?provider=eq.apify&event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { enrichment_run_id: run.id, dataset_id: datasetFromEvent || null },
  });

  if (eventType.includes("SUCCEEDED")) {
    try {
      const provider = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(actorRunId)}`, {
        headers: { Authorization: `Bearer ${apifyToken}` },
      });
      if (!provider.ok) throw new Error(`Apify status HTTP ${provider.status}`);
      const providerData = ((await provider.json()) as { data?: Json }).data || {};
      const datasetId = String(datasetFromEvent || providerData.defaultDatasetId || run.default_dataset_id || "");
      if (!datasetId) throw new Error("Dataset Apify absent");
      const dataset = await fetch(
        `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=1`,
        { headers: { Authorization: `Bearer ${apifyToken}` } },
      );
      if (!dataset.ok) throw new Error(`Dataset HTTP ${dataset.status}`);
      const items = await dataset.json() as Json[];
      const completed = await rpc<Json>(baseUrl, headers, "finalize_enrichment_run", {
        p_run_id: run.id,
        p_actor_run_id: actorRunId,
        p_dataset_id: datasetId,
        p_item: Array.isArray(items) ? items[0] || {} : {},
        p_event_id: eventId,
        p_usage_total_usd: numeric(providerData.usageTotalUsd),
      });
      if (!completed.ok) throw new Error(completed.error);
      const messageId = messageIdFrom(run.result);
      if (messageId != null) await rpc(baseUrl, headers, "ack_enrichment_job", { p_msg_id: messageId });
      return json(completed.data || { status: "completed", jobId: run.id, datasetId });
    } catch (error) {
      await markEventError(baseUrl, headers, eventId, run.id, safeMessage(error));
      return json({ error: "finalization_failed", jobId: run.id, detail: safeMessage(error) }, 502);
    }
  }

  if (["FAILED", "TIMED_OUT", "TIMED-OUT", "ABORTED"].some((status) => eventType.includes(status))) {
    const failure = await rpc<Json>(baseUrl, headers, "fail_enrichment_attempt", {
      p_run_id: run.id,
      p_provider_status: eventType,
      p_error_message: String(resource.statusMessage || resource.status || eventType).slice(0, 2000),
      p_event_id: eventId,
    });
    if (!failure.ok) {
      await markEventError(baseUrl, headers, eventId, run.id, failure.error);
      return json({ error: "failure_state_save_failed", jobId: run.id }, 502);
    }
    if ((failure.data as Json | undefined)?.terminal === true) {
      const messageId = messageIdFrom(run.result);
      if (messageId != null) await rpc(baseUrl, headers, "archive_enrichment_job", { p_msg_id: messageId });
    }
    return json(failure.data);
  }

  await rest(baseUrl, headers, `provider_webhook_events?provider=eq.apify&event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { enrichment_run_id: run.id, processed_at: new Date().toISOString() },
  });
  return json({ status: "ignored", reason: "non_terminal", jobId: run.id });
});

async function markEventError(baseUrl: string, headers: HeadersInit, eventId: string, runId: string | null, message: string) {
  const previous = await rest<Array<{ attempts: number }>>(
    baseUrl,
    headers,
    `provider_webhook_events?provider=eq.apify&event_id=eq.${encodeURIComponent(eventId)}&select=attempts&limit=1`,
  );
  await rest(baseUrl, headers, `provider_webhook_events?provider=eq.apify&event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      enrichment_run_id: runId,
      attempts: Number(previous.data?.[0]?.attempts || 0) + 1,
      error_message: message.slice(0, 2000),
    },
  });
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

function messageIdFrom(result: Json | null) {
  const value = Number(result?.messageId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function stableEventId(body: Json) {
  const resource = body.resource && typeof body.resource === "object" ? body.resource as Json : {};
  return `${String(body.eventType || body.event_type || "event")}:${String(resource.id || body.actorRunId || "unknown")}`;
}
function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}
