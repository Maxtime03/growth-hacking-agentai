import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const USER_AGENT = "PluqOpportunityFinder/1.0 (hello@net-ia.biz)";

type Coordinates = { lat: number; lon: number };
type Station = Coordinates & { name: string; source: "Open Charge Map" };
type ApifyPlace = Record<string, unknown> & {
  placeId?: string; title?: string; categoryName?: string; categories?: string[];
  address?: string; street?: string; city?: string; postalCode?: string;
  phone?: string; phoneUnformatted?: string; website?: string; url?: string;
  totalScore?: number; reviewsCount?: number; openingHours?: unknown;
  location?: { lat?: number; lng?: number }; emails?: unknown; phones?: unknown;
};

type SearchRunRow = {
  id: string; workspace_id: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  query: Record<string, unknown>; result_count: number; error_message?: string | null;
  created_at: string; completed_at?: string | null;
};

const VOLUME_OPTIONS = new Set([10, 20, 50, 100, 200, 300, 500, 700, 1000, 2000, 3000, 5000]);

const searchTerms: Record<string, Record<string, string[]>> = {
  fr: {
    "Hôtel & séminaires": ["hôtel avec parking", "centre de séminaire"],
    "Parc d'affaires": ["parc d'affaires", "immeuble de bureaux"],
    "Sports & loisirs": ["centre sportif", "club de padel"],
    "Centre commercial": ["centre commercial", "retail park"],
    Santé: ["hôpital privé", "clinique"],
  },
  nl: {
    "Hôtel & séminaires": ["hotel met parking", "conferentiecentrum"],
    "Parc d'affaires": ["bedrijventerrein", "kantoorgebouw"],
    "Sports & loisirs": ["sportcentrum", "padelclub"],
    "Centre commercial": ["winkelcentrum", "retailpark"],
    Santé: ["privéziekenhuis", "kliniek"],
  },
};

async function authorize() {
  return Boolean(await getAuthorizedChatGPTUser());
}

export async function POST(request: Request) {
  if (!await authorize()) return Response.json({ error: "Accès non autorisé." }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const country = clean(textValue(body.country) || "Belgique", 60);
    const region = clean(textValue(body.region) || "Brabant wallon", 100);
    const category = clean(textValue(body.category) || "Toutes les catégories", 100);
    const profile = clean(textValue(body.profile) || "large", 30);
    const accessUser = await getAuthorizedChatGPTUser();
    if (!accessUser || !canAccessWorkspace(accessUser, normalizeWorkspace(profile))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    const requestedLimit = Number(body.limit || 50);
    const liveTestRequested = request.headers.get("x-netai-live-test") === "true";
    const isExplicitLiveSmokeTest = liveTestRequested && (requestedLimit === 1 || requestedLimit === 2);
    if (!VOLUME_OPTIONS.has(requestedLimit) && !isExplicitLiveSmokeTest) {
      return Response.json({ error: "Volume de leads invalide." }, { status: 400 });
    }
    const clickedLat = numberValue(body.lat);
    const clickedLng = numberValue(body.lng);
    const clickedRadius = Math.min(30, Math.max(2, numberValue(body.radiusKm) || 8));
    const options = {
      language: clean(textValue(body.language) || (country === "Pays-Bas" ? "nl" : "fr"), 8),
      website: body.website === true ? "withWebsite" : "allPlaces",
      skipClosedPlaces: body.skipClosedPlaces !== false,
      searchMatching: clean(textValue(body.searchMatching) || "all", 20),
      scrapePlaceDetailPage: body.scrapePlaceDetailPage === true,
      includeWebResults: body.includeWebResults === true,
      scrapeSocialMediaProfiles: body.scrapeSocialMediaProfiles === true,
      maximumLeadsEnrichmentRecords: Math.min(3, Math.max(0, numberValue(body.maximumLeadsEnrichmentRecords) || 0)),
      leadsEnrichmentDepartments: Array.isArray(body.leadsEnrichmentDepartments) ? body.leadsEnrichmentDepartments.filter((value): value is string => typeof value === "string").slice(0, 8) : [],
      verifyLeadsEnrichmentEmails: body.verifyLeadsEnrichmentEmails === true,
      placeMinimumStars: textValue(body.placeMinimumStars) || "",
      categoryFilterWords: Array.isArray(body.categoryFilterWords) ? body.categoryFilterWords.filter((value): value is string => typeof value === "string").slice(0, 20) : [],
      costLimit: numberValue(body.costLimit),
    };
    if (isExplicitLiveSmokeTest && (optionsHasPaidAddons(options) || options.verifyLeadsEnrichmentEmails)) {
      return Response.json({ error: "Le test live 1–2 leads interdit les options payantes." }, { status: 400 });
    }
    const areaLabel = clean(textValue(body.areaLabel) || region, 160);
    const clickedCenter = clickedLat != null && clickedLng != null && clickedLat >= -90 && clickedLat <= 90 && clickedLng >= -180 && clickedLng <= 180
      ? { lat: clickedLat, lon: clickedLng }
      : null;
    const area = clickedCenter ? { center: clickedCenter, radiusKm: clickedRadius } : await geocodeArea(region, country);
    const workspaceId = await getWorkspaceId(profile);
    const apifyRun = await startApifyRun(region, country, category, profile, requestedLimit, clickedCenter, area.radiusKm, options);
    const query = {
      country, region, areaLabel, category, profile, desiredLimit: requestedLimit,
      center: area.center, radiusKm: area.radiusKm, apifyRunId: apifyRun.id,
      datasetId: apifyRun.defaultDatasetId,
      idempotencyKey: clean(request.headers.get("idempotency-key") || textValue(body.idempotencyKey) || crypto.randomUUID(), 120),
    };
    const run = await createSearchRun(workspaceId, query);
    return Response.json({ runId: run.id, status: run.status, desiredLimit: requestedLimit }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Impossible de démarrer la recherche." }, { status: 502 });
  }
}

function optionsHasPaidAddons(options: unknown): boolean {
  if (!options || typeof options !== "object") return false;
  const value = options as Record<string, unknown>;
  return value.includeWebResults === true || value.scrapeSocialMediaProfiles === true ||
    value.scrapePlaceDetailPage === true || value.maximumLeadsEnrichmentRecords !== 0;
}

export async function GET(request: Request) {
  if (!await authorize()) return Response.json({ error: "Accès non autorisé." }, { status: 401 });

  const url = new URL(request.url);
  try {
    const runId = clean(url.searchParams.get("runId") || "", 80);
    const run = runId ? await getSearchRun(runId) : await getLatestSearchRun();
    if (!run) return Response.json({ items: [], run: null, meta: null });
    if (run.status === "running" || run.status === "queued") await refreshSearchRun(run);
    const freshRun = await getSearchRun(run.id);
    const accessUser = await getAuthorizedChatGPTUser();
    if (freshRun) {
      const runWorkspace = await workspaceSlugFromId(freshRun.workspace_id);
      if (!accessUser || !canAccessWorkspace(accessUser, runWorkspace)) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    }
    if (!freshRun) throw new Error("Recherche introuvable après actualisation.");
    const items = freshRun.status === "completed" ? await getSearchRunItems(freshRun.id) : [];
    const query = freshRun.query || {};
    return Response.json({
      items,
      run: { id: freshRun.id, status: freshRun.status, desiredLimit: query.desiredLimit, resultCount: freshRun.result_count, error: freshRun.error_message || null, createdAt: freshRun.created_at },
      meta: freshRun.status === "completed" ? {
        country: query.country, region: query.region, areaLabel: query.areaLabel, category: query.category, profile: query.profile,
        totalFound: freshRun.result_count, returned: items.length,
        chargingStationsChecked: query.chargingStationsChecked || 0,
        chargingSource: "Open Charge Map", businessSource: "Google Maps via Apify",
        fetchedAt: freshRun.completed_at || freshRun.created_at,
        attribution: "Établissements : Google Maps via Apify. Bornes : Open Charge Map contributors.",
      } : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de collecte inconnue.";
    return Response.json({ error: message }, { status: 502 });
  }
}

async function startApifyRun(region: string, country: string, category: string, profile: string, limit: number, center: Coordinates | null, radiusKm: number, options: {
  language: string; website: string; skipClosedPlaces: boolean; searchMatching: string; scrapePlaceDetailPage: boolean;
  includeWebResults: boolean; scrapeSocialMediaProfiles: boolean; maximumLeadsEnrichmentRecords: number; leadsEnrichmentDepartments: string[];
  verifyLeadsEnrichmentEmails: boolean; placeMinimumStars: string; categoryFilterWords: string[]; costLimit: number | null;
}) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("Apify Google Maps n'est pas encore connecté.");
  const language = options.language || (country === "Pays-Bas" ? "nl" : "fr");
  const catalog = searchTerms[language];
  const profileTerms: Record<string, string[]> = language === "nl" ? {
    lexicon: ["groeiende onderneming", "business consultancy", "vastgoedbedrijf", "advocatenkantoor"],
    profitflow: ["groeiende KMO", "bouwbedrijf", "logistiek bedrijf", "productiebedrijf"],
    enterprise: ["hoofdkantoor", "internationale groep", "bedrijf met meerdere vestigingen", "grote werkgever"],
    pluq: Object.values(catalog).map((terms) => terms[0]),
  } : {
    lexicon: ["entreprise en croissance", "cabinet de conseil", "agence immobilière", "cabinet d'avocats"],
    profitflow: ["PME en croissance", "entreprise de construction", "entreprise logistique", "entreprise industrielle"],
    enterprise: ["siège social", "groupe international", "entreprise multi-sites", "grand employeur"],
    pluq: Object.values(catalog).map((terms) => terms[0]),
  };
  const selectedTerms = profile !== "large" && profileTerms[profile]
    ? profileTerms[profile]
    : category === "Toutes les catégories"
      ? Object.values(catalog).map((terms) => terms[0])
      : (catalog[category] || Object.values(catalog).map((terms) => terms[0]));
  const effectiveTerms=selectedTerms.slice(0,Math.max(1,Math.min(selectedTerms.length,limit)));
  const maxPerSearch = Math.max(1, Math.ceil(limit / effectiveTerms.length));
  const runQuery=new URLSearchParams({memory:"4096",timeout:"21600",maxItems:String(limit)});
  if(options.costLimit!=null)runQuery.set("maxTotalChargeUsd",String(Math.min(0.1,Math.max(0.01,options.costLimit))));

  const response = await fetch(`https://api.apify.com/v2/acts/lukaskrivka~google-maps-with-contact-details/runs?${runQuery}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      searchStringsArray: effectiveTerms,
      ...(center ? { customGeolocation: circleGeoJson(center, radiusKm) } : { locationQuery: `${region}, ${country}` }),
      maxCrawledPlacesPerSearch: maxPerSearch,
      language,
      ...(options.categoryFilterWords.length ? { categoryFilterWords: options.categoryFilterWords } : {}),
      searchMatching: options.searchMatching,
      placeMinimumStars: options.placeMinimumStars ?? undefined,
      website: options.website,
      skipClosedPlaces: options.skipClosedPlaces,
      scrapePlaceDetailPage: options.scrapePlaceDetailPage,
      includeWebResults: options.includeWebResults,
      scrapeSocialMediaProfiles: {
        facebooks: options.scrapeSocialMediaProfiles,
        instagrams: options.scrapeSocialMediaProfiles,
        youtubes: options.scrapeSocialMediaProfiles,
        tiktoks: options.scrapeSocialMediaProfiles,
        twitters: options.scrapeSocialMediaProfiles,
      },
      maximumLeadsEnrichmentRecords: options.maximumLeadsEnrichmentRecords,
      leadsEnrichmentDepartments: options.leadsEnrichmentDepartments,
      verifyLeadsEnrichmentEmails: options.verifyLeadsEnrichmentEmails,
      countryCode: countryToCode(country),
      city: center ? undefined : undefined,
      county: center ? undefined : region,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint = response.status === 401 || response.status === 403 ? " Vérifiez le token ou les crédits du compte Apify." : " Réessayez dans quelques minutes.";
    throw new Error(`Apify a refusé la recherche (${response.status}).${hint}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
  }
  const payload = await response.json() as { data?: { id?: string; defaultDatasetId?: string } };
  if (!payload.data?.id || !payload.data.defaultDatasetId) throw new Error("Apify n'a pas renvoyé d'identifiant de recherche.");
  return { id: payload.data.id, defaultDatasetId: payload.data.defaultDatasetId };
}

function circleGeoJson(center: Coordinates, radiusKm: number) {
  const points: number[][] = [];
  const radiusLat = radiusKm / 110.574;
  const radiusLon = radiusKm / (111.32 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    points.push([center.lon + radiusLon * Math.cos(angle), center.lat + radiusLat * Math.sin(angle)]);
  }
  return { type: "Polygon", coordinates: [points] };
}

async function getWorkspaceId(profile: string) {
  const slug = ["pluq", "lexicon", "profitflow"].includes(profile) ? profile : "net-ai";
  const response = await supabaseRest(`workspaces?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
  const rows = await readSupabaseJson<Array<{ id: string }>>(response, "Impossible de retrouver l'espace client Supabase.");
  if (!rows[0]?.id) throw new Error(`L'espace « ${slug} » n'existe pas dans Supabase.`);
  return rows[0].id;
}

async function workspaceSlugFromId(id: string) {
  const response = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(id)}&select=slug&limit=1`);
  const rows = await readSupabaseJson<Array<{ slug: string }>>(response, "Impossible de vérifier l'espace client.");
  return normalizeWorkspace(rows[0]?.slug);
}

async function createSearchRun(workspaceId: string, query: Record<string, unknown>) {
  const response = await supabaseRest("search_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ workspace_id: workspaceId, provider: "apify_google_maps", status: "running", query, started_at: new Date().toISOString() }),
  });
  const rows = await readSupabaseJson<SearchRunRow[]>(response, "La recherche n'a pas pu être enregistrée.");
  if (!rows[0]) throw new Error("Supabase n'a pas renvoyé la recherche créée.");
  return rows[0];
}

async function getSearchRun(id: string) {
  const response = await supabaseRest(`search_runs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const rows = await readSupabaseJson<SearchRunRow[]>(response, "Impossible de lire la recherche Supabase.");
  return rows[0] || null;
}

async function getLatestSearchRun() {
  const response = await supabaseRest("search_runs?select=*&order=created_at.desc&limit=1");
  const rows = await readSupabaseJson<SearchRunRow[]>(response, "Impossible de lire la dernière recherche.");
  return rows[0] || null;
}

async function updateSearchRun(id: string, values: Record<string, unknown>) {
  const response = await supabaseRest(`search_runs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`Mise à jour de recherche impossible (${response.status}).`);
}

async function refreshSearchRun(run: SearchRunRow) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN manque dans .env.local.");
  const apifyRunId = textValue(run.query.apifyRunId);
  if (!apifyRunId) throw new Error("Identifiant Apify absent de la recherche.");
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(apifyRunId)}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Impossible de vérifier la progression Apify (${response.status}).`);
  const payload = await response.json() as { data?: { status?: string; defaultDatasetId?: string; statusMessage?: string } };
  const apifyStatus = payload.data?.status || "UNKNOWN";
  if (["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
    await updateSearchRun(run.id, { status: "failed", error_message: payload.data?.statusMessage || `Apify : ${apifyStatus}`, completed_at: new Date().toISOString() });
    return;
  }
  if (apifyStatus !== "SUCCEEDED") return;
  if (run.result_count > 0) {
    await updateSearchRun(run.id, { status: "completed", completed_at: new Date().toISOString() });
    return;
  }

  const datasetId = textValue(run.query.datasetId) || payload.data?.defaultDatasetId;
  const desiredLimit = Math.min(5000, Math.max(1, numberValue(run.query.desiredLimit) || 50));
  if (!datasetId) throw new Error("Dataset Apify absent de la recherche.");
  const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${desiredLimit}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT }, cache: "no-store",
  });
  if (!datasetResponse.ok) throw new Error(`Impossible de récupérer les résultats Apify (${datasetResponse.status}).`);
  const places = await datasetResponse.json() as ApifyPlace[];
  const centerValue = run.query.center as Record<string, unknown> | undefined;
  const center = { lat: numberValue(centerValue?.lat) || 50.5039, lon: numberValue(centerValue?.lon) || 4.4699 };
  const radiusKm = Math.min(100, Math.max(2, numberValue(run.query.radiusKm) || 8));
  const profile = textValue(run.query.profile) || "large";
  const stations = profile === "pluq" ? await fetchOpenChargeMapStations(center, radiusKm) : [];
  const items = deduplicatePlaces(Array.isArray(places) ? places : [])
    .map((place) => toOpportunity(place, stations, profile))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, desiredLimit);
  await persistSearchItems(run, items);
  await updateSearchRun(run.id, {
    status: "completed", result_count: items.length, completed_at: new Date().toISOString(),
    query: { ...run.query, chargingStationsChecked: stations.length, processedAt: new Date().toISOString() },
  });
}

async function persistSearchItems(run: SearchRunRow, items: Array<NonNullable<ReturnType<typeof toOpportunity>>>) {
  const countryCode = countryToCode(textValue(run.query.country));
  for (let offset = 0; offset < items.length; offset += 200) {
    const batch = items.slice(offset, offset + 200);
    const leadRows = batch.map((item) => ({
      workspace_id: run.workspace_id, search_run_id: run.id, source: "apify_google_maps", external_id: item.id,
      company_name: item.company, website: item.website, phone: item.phone, email: item.email,
      linkedin_url: item.linkedinUrl, industry: item.kind, category: item.kind, address: item.location,
      region: textValue(run.query.region), country_code: countryCode || null,
      latitude: item.coordinates?.lat, longitude: item.coordinates?.lon,
      google_place_id: item.id, google_maps_url: item.sourceUrl,
      status: item.status === "À appeler" ? "to_call" : item.status === "À vérifier" ? "to_review" : "new",
      score: item.score, confidence: item.confidence, parking_status: "unknown",
      fit_score: item.score, priority_score: item.score, data_confidence: item.confidence,
      pipeline_stage: "new", temperature: "non_contacte", score_model_version: textValue(run.query.profile) === "lexicon" ? "lexicon-v1" : "workspace-v1",
      charger_count_on_site: item.chargers, charger_count_500m: item.chargersWithin500m,
      charger_count_2km: item.chargersWithin2km, nearest_charger_m: item.nearestChargerMeters,
      raw_data: item, updated_at: new Date().toISOString(),
    }));
    const response = await supabaseRest("leads?on_conflict=workspace_id,external_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(leadRows),
    });
    const saved = await readSupabaseJson<Array<{ id: string; external_id: string }>>(response, "Les leads n'ont pas pu être enregistrés.");
    const rankByExternalId = new Map(batch.map((item, index) => [item.id, offset + index]));
    const links = saved.map((lead) => ({ search_run_id: run.id, lead_id: lead.id, rank: rankByExternalId.get(lead.external_id) || 0 }));
    const linkResponse = await supabaseRest("search_run_leads?on_conflict=search_run_id,lead_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(links),
    });
    if (!linkResponse.ok) throw new Error(`La liste de recherche n'a pas pu être reliée aux leads (${linkResponse.status}).`);
  }
}

async function getSearchRunItems(runId: string) {
  const path = `search_run_leads?search_run_id=eq.${encodeURIComponent(runId)}&select=rank,lead:leads(id,external_id,raw_data,deal_status,opportunity_value,next_action,next_action_at)&order=rank.asc&limit=5000`;
  const response = await supabaseRest(path);
  const rows = await readSupabaseJson<Array<{ rank: number; lead: { id:string; external_id:string; raw_data?: unknown; deal_status?:string; opportunity_value?:number|null; next_action?:string|null; next_action_at?:string|null } | Array<{ id:string; external_id:string; raw_data?: unknown; deal_status?:string; opportunity_value?:number|null; next_action?:string|null; next_action_at?:string|null }> }>>(response, "Impossible de charger la liste des leads.");
  return rows.flatMap((row) => {
    const relation = Array.isArray(row.lead) ? row.lead[0] : row.lead;
    return relation?.raw_data && typeof relation.raw_data === "object" ? [{ ...(relation.raw_data as Record<string,unknown>), databaseId: relation.id, dealStatus: relation.deal_status || "new", opportunityValue: Number(relation.opportunity_value || 0), nextAction: relation.next_action || null, nextActionAt: relation.next_action_at || null }] : [];
  });
}

async function readSupabaseJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${fallback} (${response.status})${detail ? ` ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function countryToCode(country: string | null) {
  // The current actor schema only accepts an empty value or the lowercase US code.
  // Textual locationQuery already carries the country for European searches.
  return country === "États-Unis" || country === "United States" ? "us" : "";
}

async function geocodeArea(region: string, country: string) {
  const params = new URLSearchParams({ q: `${region}, ${country}`, format: "jsonv2", limit: "1", addressdetails: "1" });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "fr,en,nl" }, next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`La localisation de ${region} est indisponible (${response.status}).`);
  const results = await response.json() as Array<{ boundingbox: [string, string, string, string]; lat: string; lon: string }>;
  if (!results[0]) throw new Error(`La région « ${region} » n'a pas été trouvée.`);
  const [, north, , east] = results[0].boundingbox.map(Number);
  const center = { lat: Number(results[0].lat), lon: Number(results[0].lon) };
  return { center, radiusKm: Math.min(100, Math.max(5, haversine(center, { lat: north, lon: east }))) };
}

async function fetchOpenChargeMapStations(center: Coordinates, radiusKm: number): Promise<Station[]> {
  const key = process.env.OPEN_CHARGE_MAP_API_KEY;
  if (!key) throw new Error("Open Charge Map n'est pas encore connecté.");
  const params = new URLSearchParams({ output: "json", latitude: String(center.lat), longitude: String(center.lon), distance: String(Math.ceil(radiusKm)), distanceunit: "KM", maxresults: "1000", compact: "true", verbose: "false" });
  const response = await fetch(`https://api.openchargemap.io/v3/poi/?${params}`, {
    headers: { "User-Agent": USER_AGENT, "X-API-Key": key }, next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Open Charge Map a refusé la recherche (${response.status}). Vérifiez la clé API.`);
  const data = await response.json() as Array<{ AddressInfo?: { Latitude?: number; Longitude?: number; Title?: string } }>;
  return data.flatMap((item) => item.AddressInfo?.Latitude != null && item.AddressInfo?.Longitude != null
    ? [{ lat: item.AddressInfo.Latitude, lon: item.AddressInfo.Longitude, name: item.AddressInfo.Title || "Borne référencée", source: "Open Charge Map" as const }]
    : []);
}

function toOpportunity(place: ApifyPlace, stations: Station[], profile: string) {
  const coordinates = getPlaceCoordinates(place);
  const company = textValue(place.title);
  if (!coordinates || !company) return null;
  const distances = stations.map((station) => ({ ...station, distanceMeters: Math.round(haversine(coordinates, station) * 1000) })).sort((a, b) => a.distanceMeters - b.distanceMeters);
  const onSite = distances.filter((station) => station.distanceMeters < 80).length;
  const within500m = distances.filter((station) => station.distanceMeters <= 500).length;
  const within2km = distances.filter((station) => station.distanceMeters <= 2000).length;
  const email = firstContact(place.emails) || nestedFirstContact(place, ["contactDetails", "emails"]);
  const phone = textValue(place.phone) || textValue(place.phoneUnformatted) || firstContact(place.phones) || nestedFirstContact(place, ["contactDetails", "phones"]);
  const website = normalizeWebsite(textValue(place.website));
  const lead = findLead(place);
  const decisionMaker = lead ? [textValue(lead.firstName), textValue(lead.lastName)].filter(Boolean).join(" ") || textValue(lead.name) : null;
  const decisionMakerTitle = lead ? textValue(lead.jobTitle) || textValue(lead.title) : null;
  const leadEmail = lead ? textValue(lead.email) : null;
  const socialUrls = collectSocialUrls(place);
  const linkedinUrl = lead ? textValue(lead.linkedinUrl) || textValue(lead.linkedin) || textValue(lead.profileUrl) || socialUrls.linkedin : socialUrls.linkedin;
  const category = humanCategory([textValue(place.categoryName), ...(place.categories || [])].filter(Boolean).join(" "));
  const rating = numberValue(place.totalScore);
  const reviewsCount = numberValue(place.reviewsCount);
  let score = profile === "lexicon" ? 35 : profile === "profitflow" ? 25 : profile === "enterprise" ? 28 : 43;
  if (profile === "pluq") {
    if (onSite === 0) score += 24; else if (onSite <= 2) score += 8; else score -= 12;
    if (within2km <= 3) score += 12; else if (within2km <= 8) score += 5;
  } else {
    if (website) score += profile === "lexicon" ? 15 : 8;
    if ((reviewsCount || 0) >= 40) score += profile === "lexicon" ? 15 : 5;
    if (decisionMaker) score += profile === "enterprise" ? 16 : 10;
    if (profile === "profitflow" && !place.annualRevenue) score = Math.min(score, 65);
    if (profile === "enterprise") {
      if (linkedinUrl) score += 9;
      if ((reviewsCount || 0) >= 100) score += 8;
      if (website && phone) score += 7;
    }
  }
  if (phone) score += 6;
  if (email || leadEmail) score += 6;
  if (website) score += 4;
  if (decisionMaker) score += 5;
  if ((reviewsCount || 0) >= 100) score += 3;
  if (["Hôtel & séminaires", "Parc d'affaires", "Sports & loisirs"].includes(category)) score += 4;
  score = Math.max(0, Math.min(100, score));
  const contactCompleteness = [phone, email || leadEmail, website, decisionMaker].filter(Boolean).length;
  const confidence = Math.min(97, 60 + contactCompleteness * 7 + (rating ? 4 : 0) + (reviewsCount ? 4 : 0));
  const sourceUrl = textValue(place.url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${company} ${formatAddress(place)}`)}`;
  const recommendation = recommendOffer({ profile, category, onSite, within2km, phone, email: leadEmail || email, website, decisionMaker, reviewsCount });
  const result = {
    id: textValue(place.placeId) || `${company}-${coordinates.lat}-${coordinates.lon}`,
    company, location: formatAddress(place), kind: category, score, confidence,
    chargers: onSite, chargersWithin500m: within500m, chargersWithin2km: within2km,
    nearestChargerMeters: distances[0]?.distanceMeters ?? null,
    parking: "Parking à confirmer par photo satellite ou appel",
    phone, email: leadEmail || email, website,
    decisionMaker: decisionMaker ? `${decisionMaker}${decisionMakerTitle ? ` · ${decisionMakerTitle}` : ""}` : null,
    linkedinUrl, instagramUrl: socialUrls.instagram, facebookUrl: socialUrls.facebook,
    operator: null, openingHours: formatOpeningHours(place.openingHours),
    description: [rating ? `Note Google ${rating}/5` : null, reviewsCount ? `${reviewsCount} avis` : null].filter(Boolean).join(" · ") || null,
    coordinates, status: score >= 80 ? "À appeler" : score >= 65 ? "À vérifier" : "Nouveau", sourceUrl,
    temperature: score >= 82 && contactCompleteness >= 2 ? "Chaud" : score >= 68 ? "Tiède" : "À nourrir",
    recommendedOffer: recommendation.offer, fitReason: recommendation.reason,
  };
  result.temperature = "non_contacte";
  return result;
}

function recommendOffer(input: { profile: string; category: string; onSite: number; within2km: number; phone: string | null; email: string | null; website: string | null; decisionMaker: string | null; reviewsCount: number | null }) {
  if (input.profile === "pluq" || (["Hôtel & séminaires", "Parc d'affaires", "Sports & loisirs", "Centre commercial", "Santé"].includes(input.category) && input.onSite === 0)) {
    return { offer: "Pluq", reason: `Site à stationnement probable, ${input.onSite === 0 ? "aucune borne détectée sur place" : "couverture à vérifier"} et ${input.within2km} borne(s) référencée(s) dans un rayon de 2 km.` };
  }
  if (input.profile === "profitflow") {
    return { offer: "Profitflow", reason: "Profil de PME compatible avec une analyse cashflow ou talents. Chiffre d'affaires et besoin réel à confirmer avant contact." };
  }
  if (input.profile === "enterprise") {
    return { offer: "À analyser", reason: "Signaux publics compatibles avec une organisation structurée ou multi-sites. La taille, le budget et le besoin restent des probabilités à valider avec un décideur." };
  }
  if (input.profile === "lexicon" || (input.website && (input.reviewsCount || 0) >= 40)) {
    return { offer: "Lexicon", reason: "Présence numérique déjà visible : potentiel d'amélioration de l'autorité, de la réputation et de la visibilité dans les moteurs IA." };
  }
  if (input.phone || input.email || input.decisionMaker) return { offer: "À analyser", reason: "Contact exploitable détecté, mais l'enrichissement doit encore confirmer l'offre et le signal d'achat." };
  return { offer: "À analyser", reason: "Entreprise détectée : enrichissement requis avant toute prise de contact." };
}

function deduplicatePlaces(places: ApifyPlace[]) {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = textValue(place.placeId) || `${textValue(place.title)}|${textValue(place.address)}`.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function getPlaceCoordinates(place: ApifyPlace): Coordinates | null {
  const lat = numberValue(place.location?.lat ?? place.latitude);
  const lon = numberValue(place.location?.lng ?? place.longitude);
  return lat == null || lon == null ? null : { lat, lon };
}

function formatAddress(place: ApifyPlace) {
  return textValue(place.address) || [textValue(place.street), [textValue(place.postalCode), textValue(place.city)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse à enrichir";
}

function humanCategory(value: string) {
  const category = value.toLowerCase();
  if (/hôtel|hotel|séminaire|seminar|conference/.test(category)) return "Hôtel & séminaires";
  if (/bureau|office|business|bedrijf|kantoor/.test(category)) return "Parc d'affaires";
  if (/sport|padel|fitness|loisir/.test(category)) return "Sports & loisirs";
  if (/centre commercial|shopping|winkel|retail|mall/.test(category)) return "Centre commercial";
  if (/hôpital|hospital|clinique|clinic|kliniek|ziekenhuis/.test(category)) return "Santé";
  return "Entreprise";
}

function findLead(place: ApifyPlace): Record<string, unknown> | null {
  for (const key of ["leads", "businessLeads", "leadsEnrichment", "people"]) {
    const value = place[key];
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") return value[0] as Record<string, unknown>;
  }
  return null;
}

function firstContact(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const record = first as Record<string, unknown>;
    return textValue(record.value) || textValue(record.email) || textValue(record.phone);
  }
  return null;
}

function nestedFirstContact(place: ApifyPlace, path: string[]) {
  let current: unknown = place;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return firstContact(current);
}

function collectSocialUrls(value: unknown) {
  const found: string[] = [];
  const visit = (item: unknown, depth = 0) => {
    if (depth > 5 || item == null) return;
    if (typeof item === "string") {
      if (/^https?:\/\//i.test(item) && /(linkedin\.com|instagram\.com|facebook\.com)/i.test(item)) found.push(item);
      return;
    }
    if (Array.isArray(item)) return item.forEach((entry) => visit(entry, depth + 1));
    if (typeof item === "object") Object.values(item as Record<string, unknown>).forEach((entry) => visit(entry, depth + 1));
  };
  visit(value);
  return {
    linkedin: found.find((url) => /linkedin\.com\/in\//i.test(url)) || found.find((url) => /linkedin\.com/i.test(url)) || null,
    instagram: found.find((url) => /instagram\.com/i.test(url)) || null,
    facebook: found.find((url) => /facebook\.com/i.test(url)) || null,
  };
}

function formatOpeningHours(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.slice(0, 2).map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      return [textValue(row.day), textValue(row.hours)].filter(Boolean).join(" ");
    }
    return "";
  }).filter(Boolean).join(" · ") || null;
}

function normalizeWebsite(value: string | null) { if (!value) return null; return /^https?:\/\//i.test(value) ? value : `https://${value}`; }
function textValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown): number | null { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? number : null; }
function clean(value: string, maxLength: number) { return value.replace(/[<>\r\n]/g, "").trim().slice(0, maxLength); }
function haversine(a: Coordinates, b: Coordinates) {
  const toRad = (value: number) => value * Math.PI / 180; const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon); const lat1 = toRad(a.lat); const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}
