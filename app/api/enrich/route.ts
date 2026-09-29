import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
const USER_AGENT = "NetAILeadOS/1.0 (hello@net-ia.biz)";

export async function POST(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "AccÃ¨s non autorisÃ©." }, { status: 401 });
  const input = await request.json().catch(() => ({})) as Record<string, unknown>;
  const externalId = clean(input.id || input.externalId, 200);
  if (!externalId) return Response.json({ error: "Identifiant du lead absent." }, { status: 400 });
  try {
    const leadResponse = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}&select=id,workspace_id&limit=1`);
    const leads = await leadResponse.json() as Array<{ id: string; workspace_id: string }>;
    if (!leads[0]) return Response.json({ error: "Lead introuvable." }, { status: 404 });
    const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(leads[0].workspace_id)}&select=slug&limit=1`);
    const workspaceRows = workspaceResponse.ok ? await workspaceResponse.json() as Array<{ slug: string }> : [];
    if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    const idempotency = clean(String(input.idempotencyKey || `${leads[0].id}:${Math.floor(Date.now() / 60000)}`), 180)!;
    const jobResponse = await supabaseRest("enrichment_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ workspace_id: leads[0].workspace_id, lead_id: leads[0].id, provider: "apify_openai", status: "queued", progress: 0, attempts: 0, idempotency_key: idempotency, fields_requested: ["company", "contacts", "sources", "summary"] }) });
    let jobs = jobResponse.ok ? await jobResponse.json() as Array<{ id: string }> : [];
    const created = Boolean(jobs[0]);
    if (!jobs[0]) {
      const existing = await supabaseRest(`enrichment_runs?lead_id=eq.${encodeURIComponent(leads[0].id)}&status=in.(queued,running)&select=id&limit=1`);
      jobs = existing.ok ? await existing.json() as Array<{ id: string }> : [];
    }
    if (!jobs[0]) return Response.json({ error: "Impossible de créer le job d'enrichissement." }, { status: 503 });
    const jobId = jobs[0].id;
    if (created) {
      await supabaseRest("enrichment_queue", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ enrichment_run_id: jobId, workspace_id: leads[0].workspace_id, payload: { ...input, id: externalId }, status: "queued" }) });
      const queued = await supabaseRest("rpc/enqueue_enrichment_job", { method: "POST", body: JSON.stringify({ p_run_id: jobId, p_workspace_id: leads[0].workspace_id, payload: { ...input, id: externalId } }) });
      if (!queued.ok) return Response.json({ error: "La file durable Supabase est indisponible." }, { status: 503 });
    }
    return Response.json({ jobId, status: "queued", progress: 0 }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lancement de l'enrichissement impossible." }, { status: 503 });
  }
}

export async function processEnrichmentJob(jobId: string, input: Record<string, unknown>, ownerEmail: string) {
  const current = await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(jobId)}&select=attempts,status&limit=1`);
  const rows = current.ok ? await current.json() as Array<{ attempts?: number; status?: string }> : [];
  if (rows[0]?.status === "cancelled" || rows[0]?.status === "completed") return;
  const attempt = Number(rows[0]?.attempts || 0) + 1;
  await supabaseRest(`enrichment_queue?enrichment_run_id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "running", attempts: attempt, locked_at: new Date().toISOString() }) });
  await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "running", progress: 10, attempts: attempt, locked_at: new Date().toISOString() }) });
  const response = await executeEnrichment(new Request("http://internal/api/enrich", { method: "POST", headers: { "Content-Type": "application/json", "oai-authenticated-user-email": ownerEmail }, body: JSON.stringify({ ...input, __jobId: jobId }) }));
  const payload = await response.json().catch(() => ({}));
  if (response.ok) {
    await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", progress: 100, result: payload, error_message: null, completed_at: new Date().toISOString(), locked_at: null }) });
    await supabaseRest(`enrichment_queue?enrichment_run_id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString(), locked_at: null }) });
    return;
  }
  const retry = attempt < 3;
  const retryAt = retry ? new Date(Date.now() + 2 ** attempt * 1000).toISOString() : null;
  await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: retry ? "queued" : "failed", progress: 0, result: {}, error_message: payload.error || "Échec de l'enrichissement", next_retry_at: retryAt, completed_at: retry ? null : new Date().toISOString(), locked_at: null }) });
  await supabaseRest(`enrichment_queue?enrichment_run_id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: retry ? "queued" : "failed", available_at: retryAt || new Date().toISOString(), last_error: payload.error || "Échec de l'enrichissement", locked_at: null, completed_at: retry ? null : new Date().toISOString() }) });
}

async function executeEnrichment(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) {
    return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  try {
    const lead = await request.json() as Record<string, unknown>;
    const externalId = clean(lead.id || lead.externalId, 200);
    if (externalId) {
      const lookup = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}&select=workspace_id&limit=1`);
      const rows = await lookup.json() as Array<{ workspace_id: string }>;
      if (!rows[0]) return Response.json({ error: "Lead introuvable." }, { status: 404 });
      const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(rows[0].workspace_id)}&select=slug&limit=1`);
      const workspaceRows = await workspaceResponse.json() as Array<{ slug: string }>;
      if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    }
    const company = clean(lead.company, 160);
    if (!company) return Response.json({ error: "Entreprise manquante." }, { status: 400 });
    const companyEnrichment = await fetchCompanyEnrichment(lead);
    await reportProgress(lead.__jobId, 45);
    const businessLead = findBusinessLead(companyEnrichment);
    let linkedinUrl = validLinkedInUrl(lead.linkedinUrl) || validLinkedInUrl(firstText(businessLead, ["linkedinUrl", "linkedin", "profileUrl"]));
    const businessLeadName = profileName(businessLead);
    if (!linkedinUrl && businessLeadName) linkedinUrl = await findStrongLinkedInMatch(businessLeadName, company, clean(lead.location, 240), clean(lead.website, 500));
    const linkedinProfile = linkedinUrl ? await fetchLinkedInProfile(linkedinUrl) : null;
    await reportProgress(lead.__jobId, 75);
    const discoveredEmail = firstText(linkedinProfile, ["email", "emailAddress", "workEmail"]) || firstText(businessLead, ["email", "emailAddress", "workEmail"]) || firstContact(companyEnrichment, "emails");
    const discoveredPhone = firstText(businessLead, ["phone", "phoneNumber"]) || firstContact(companyEnrichment, "phones") || clean(companyEnrichment?.phone, 100);
    const discoveredName = profileName(linkedinProfile) || profileName(businessLead);
    const enrichedLead = {
      ...lead,
      email: discoveredEmail || lead.email || null,
      phone: discoveredPhone || lead.phone || null,
      linkedinUrl: linkedinUrl || lead.linkedinUrl || null,
      decisionMaker: discoveredName || lead.decisionMaker || null,
    };
    const enrichment = await createLeadBrief(enrichedLead, linkedinProfile || businessLead);
    await persistEnrichment(enrichedLead, enrichment, companyEnrichment, linkedinProfile || businessLead);
    await reportProgress(lead.__jobId, 95);
    return Response.json({
      linkedinFound: Boolean(linkedinProfile || linkedinUrl),
      lead: {
        email: enrichedLead.email,
        phone: enrichedLead.phone,
        linkedinUrl: enrichedLead.linkedinUrl,
        decisionMaker: enrichedLead.decisionMaker,
      },
      enrichment: {
        fullName: discoveredName,
        headline: firstText(linkedinProfile || businessLead, ["headline", "title", "occupation", "jobTitle"]),
        currentPosition: currentPosition(linkedinProfile) || firstText(businessLead, ["jobTitle", "title"]),
        email: discoveredEmail,
        summary: enrichment.summary,
        icebreaker: enrichment.icebreaker,
        whyNow: enrichment.whyNow,
        callBrief: enrichment.callBrief,
        sources: [clean(lead.sourceUrl, 500), linkedinUrl, clean(lead.website, 500)].filter(Boolean),
        company: normalizeCompany(companyEnrichment),
        contact: normalizeContact(linkedinProfile || businessLead, linkedinUrl),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur d'enrichissement." }, { status: 502 });
  }
}

async function fetchCompanyEnrichment(lead: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN manque dans .env.local.");
  const placeId = clean(lead.id, 120);
  const sourceUrl = clean(lead.sourceUrl, 800);
  const input = {
    ...(placeId && /^(ChIJ|GhIJ)/.test(placeId) ? { placeIds: [placeId] } : sourceUrl && /google\.(com|[a-z.]+)\/maps/i.test(sourceUrl) ? { startUrls: [{ url: sourceUrl }] } : { searchStringsArray: [clean(lead.company, 160)], locationQuery: clean(lead.location, 240) }),
    maxCrawledPlacesPerSearch: 1,
    language: "fr",
    maximumLeadsEnrichmentRecords: 1,
    leadsEnrichmentDepartments: ["c_suite", "operations", "sales", "marketing"],
    verifyLeadsEnrichmentEmails: false,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 1,
  };
  const run = await runApifyActor("lukaskrivka~google-maps-with-contact-details", input, 0.8, 1);
  const first = run.items[0];
  return first && typeof first === "object" ? { ...first, _apifyRun: run.meta } : null;
}

function findBusinessLead(place: Record<string, unknown> | null) {
  if (!place) return null;
  for (const key of ["leads", "businessLeads", "leadsEnrichment", "people"]) {
    const value = place[key];
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") return value[0] as Record<string, unknown>;
  }
  return null;
}

function firstContact(record: Record<string, unknown> | null, key: string) {
  if (!record) return null;
  const direct = record[key];
  const nested = record.contactDetails && typeof record.contactDetails === "object" ? (record.contactDetails as Record<string, unknown>)[key] : null;
  for (const value of [direct, nested]) {
    if (typeof value === "string") return clean(value, 200);
    if (Array.isArray(value) && value[0]) {
      if (typeof value[0] === "string") return clean(value[0], 200);
      if (typeof value[0] === "object") return firstText(value[0] as Record<string, unknown>, ["value", "email", "phone"]);
    }
  }
  return null;
}

async function persistEnrichment(lead: Record<string, unknown>, enrichment: Record<string, unknown>, companyData: Record<string, unknown> | null, contactData: Record<string, unknown> | null) {
  const externalId = clean(lead.id, 200);
  if (!externalId) return;
  const company = normalizeCompany(companyData);
  const response = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      email: clean(lead.email, 320), phone: clean(lead.phone, 120), linkedin_url: clean(lead.linkedinUrl, 800),
      status: "enriched", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      legal_name: company.legalName, description: company.description, industry: company.activity, sector: company.sector, category: company.category,
      website: company.website || clean(lead.website, 800), domain: company.domain, address: company.address, city: company.city, region: company.region, country_code: company.country,
      latitude: company.latitude, longitude: company.longitude, google_place_id: company.googlePlaceId, google_maps_url: company.googleMapsUrl,
      rating: company.rating, review_count: company.reviewCount, opening_hours: company.openingHours, photo_url: company.photoUrl, logo_url: company.logoUrl,
      social_links: company.socialLinks, company_size: company.companySize, employee_count: company.employeeCount, founded_year: company.foundedYear,
      raw_data: { ...lead, enrichment, company },
    }),
  });
  if (!response.ok) throw new Error(`L'enrichissement a été trouvé mais n'a pas pu être enregistré (${response.status}).`);
  const leadRows = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}&select=id,workspace_id&limit=1`).then(value => value.ok ? value.json() : [] ) as Array<{ id:string; workspace_id:string }>;
  const contact = normalizeContact(contactData, validLinkedInUrl(lead.linkedinUrl));
  if (leadRows[0] && contact.full_name) {
    const contactResponse = await supabaseRest("lead_contacts?on_conflict=lead_id,linkedin_url", { method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({ workspace_id:leadRows[0].workspace_id, lead_id:leadRows[0].id, ...contact, updated_at:new Date().toISOString() }) });
    if (!contactResponse.ok) throw new Error(`Le décideur a été trouvé mais n'a pas pu être enregistré (${contactResponse.status}).`);
  }
  if (leadRows[0]) {
    const sourceUrl = company.googleMapsUrl || clean(lead.sourceUrl, 800) || clean(lead.website, 800);
    const sourceResponse = await supabaseRest("enrichment_sources", { method:"POST", headers:{Prefer:"return=representation"}, body:JSON.stringify({ workspace_id:leadRows[0].workspace_id, lead_id:leadRows[0].id, provider:"apify_google_maps", source_url:sourceUrl, status:"collected", confidence:"verified", fields:{ company:Object.keys(company).filter(key => (company as Record<string,unknown>)[key] != null) }, raw_snapshot:safeEvidence(companyData) }) });
    const sourceRows = sourceResponse.ok ? await sourceResponse.json() as Array<{id:string}> : [];
    const facts = [{category:"identity",fact:company.legalName?`Nom officiel : ${company.legalName}`:null},{category:"location",fact:company.address?`Adresse : ${company.address}`:null},{category:"google_business",fact:company.rating!=null?`Google Business : ${company.rating}/5, ${company.reviewCount||0} avis`:null}].filter(item=>item.fact).map(item=>({ workspace_id:leadRows[0].workspace_id, lead_id:leadRows[0].id, enrichment_source_id:sourceRows[0]?.id||null, ...item, source_url:sourceUrl, source_title:"Google Maps via Apify", confidence:"verified" }));
    if (facts.length) await supabaseRest("evidence", { method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify(facts) });
    const metas = [companyData?._apifyRun, contactData?._apifyRun].filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"));
    for (const meta of metas) await supabaseRest("provider_runs?on_conflict=provider,provider_run_id", { method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({ workspace_id:leadRows[0].workspace_id, lead_id:leadRows[0].id, provider:"apify", actor_handle:meta.actor, provider_run_id:meta.id, dataset_id:meta.datasetId, status:"succeeded", sanitized_input:{maxItems:1,maxTotalChargeUsd:meta.maxTotalChargeUsd}, started_at:meta.startedAt, completed_at:meta.finishedAt }) });
  }
}

async function fetchLinkedInProfile(url: string): Promise<Record<string, unknown> | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN manque dans .env.local.");
  const run = await runApifyActor("harvestapi~linkedin-profile-scraper", { profileScraperMode: "Profile details no email ($4 per 1k)", urls: [url] }, 0.1, 1);
  const first = run.items[0]; return first && typeof first === "object" ? { ...first, _apifyRun: run.meta } : null;
}

async function findStrongLinkedInMatch(fullName: string, company: string, location: string | null, website: string | null) {
  const token = process.env.APIFY_API_TOKEN; if (!token) return null;
  const parts = fullName.trim().split(/\s+/); if (parts.length < 2) return null;
  const input = { profileScraperMode: "Short", firstName: parts[0], lastName: parts.slice(1).join(" "), strictSearch: true, maxPages: 1, maxItems: 3, ...(location ? { locations: [location] } : {}) };
  const run = await runApifyActor("harvestapi~linkedin-profile-search-by-name", input, 0.1, 3).catch(()=>null);
  if (!run) return null; const rows = run.items; const domain = website ? website.replace(/^https?:\/\//i,"").split("/")[0].replace(/^www\./,"").toLowerCase() : "";
  const matches = rows.map(row => ({ row, score: linkedinMatchScore(row, fullName, company, location, domain) })).filter(item => item.score >= 80).sort((a,b)=>b.score-a.score);
  if (!matches[0] || (matches[1] && matches[1].score === matches[0].score)) return null;
  return validLinkedInUrl(firstText(matches[0].row,["linkedinUrl","profileUrl","url"]));
}

function linkedinMatchScore(profile:Record<string,unknown>,fullName:string,company:string,location:string|null,domain:string){let score=0;const actual=(profileName(profile)||"").toLowerCase();if(actual===fullName.toLowerCase())score+=50;const text=JSON.stringify(safeEvidence(profile)).toLowerCase();if(text.includes(company.toLowerCase()))score+=35;if(location&&text.includes(location.toLowerCase()))score+=10;if(domain&&text.includes(domain))score+=15;return score;}

async function runApifyActor(actor:string,input:Record<string,unknown>,maxTotalChargeUsd:number,maxItems:number){const token=process.env.APIFY_API_TOKEN;if(!token)throw new Error("APIFY_API_TOKEN manque dans .env.local.");const start=await fetch(`https://api.apify.com/v2/acts/${actor}/runs?waitForFinish=60&maxTotalChargeUsd=${maxTotalChargeUsd}&maxItems=${maxItems}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","User-Agent":USER_AGENT},body:JSON.stringify(input),cache:"no-store"});if(!start.ok){const detail=await start.text().catch(()=>"");throw new Error(`Apify a refusé ${actor} (${start.status}). ${detail.slice(0,180)}`);}let data=(await start.json() as {data:Record<string,unknown>}).data;for(let attempt=0;attempt<120&&!["SUCCEEDED","FAILED","ABORTED","TIMED-OUT"].includes(String(data.status));attempt++){await new Promise(resolve=>setTimeout(resolve,2000));const status=await fetch(`https://api.apify.com/v2/actor-runs/${data.id}`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":USER_AGENT},cache:"no-store"});if(!status.ok)throw new Error(`Impossible de suivre le run Apify ${String(data.id)}.`);data=(await status.json() as {data:Record<string,unknown>}).data;}if(data.status!=="SUCCEEDED")throw new Error(`Le run Apify ${actor} s'est terminé avec le statut ${String(data.status)}.`);const datasetId=String(data.defaultDatasetId||"");const dataset=await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":USER_AGENT},cache:"no-store"});if(!dataset.ok)throw new Error(`Impossible de lire le dataset Apify ${datasetId}.`);const items=await dataset.json() as Array<Record<string,unknown>>;return{items,meta:{id:data.id,datasetId,actor,status:data.status,usageTotalUsd:data.usageTotalUsd,maxTotalChargeUsd,startedAt:data.startedAt,finishedAt:data.finishedAt}};}

function normalizeCompany(place:Record<string,unknown>|null){const location=place?.location&&typeof place.location==="object"?place.location as Record<string,unknown>:{};const images=place?.imageUrls;const website=firstText(place,["website","urlWebsite"]);const socialLinks={facebook:firstText(place,["facebookUrl","facebook"]),instagram:firstText(place,["instagramUrl","instagram"]),linkedin:firstText(place,["linkedinUrl","linkedin"]),twitter:firstText(place,["twitterUrl","twitter"])};return{legalName:firstText(place,["title","name","companyName"]),description:firstText(place,["description","about","subtitle"]),activity:firstText(place,["categoryName","industry"]),sector:firstText(place,["industry","sector"]),category:firstText(place,["categoryName","category"]),website,domain:website?website.replace(/^https?:\/\//i,"").split("/")[0].replace(/^www\./,""):null,address:firstText(place,["address","street"]),city:firstText(place,["city"]),region:firstText(place,["state","region"]),country:firstText(place,["countryCode","country"]),latitude:number(place?.latitude??location.lat),longitude:number(place?.longitude??location.lng),googlePlaceId:firstText(place,["placeId","googlePlaceId"]),googleMapsUrl:firstText(place,["url","googleMapsUrl"]),rating:number(place?.totalScore??place?.rating),reviewCount:integer(place?.reviewsCount??place?.reviewCount),openingHours:object(place?.openingHours)||{},photoUrl:Array.isArray(images)&&typeof images[0]==="string"?images[0]:firstText(place,["imageUrl","photoUrl"]),logoUrl:firstText(place,["logoUrl","logo"]),socialLinks:Object.fromEntries(Object.entries(socialLinks).filter(([,value])=>value)),companySize:firstText(place,["companySize","size"]),employeeCount:integer(place?.employeeCount??place?.employees),foundedYear:integer(place?.foundedYear??place?.founded)};}
function normalizeContact(profile:Record<string,unknown>|null,linkedinUrl:string|null){const fullName=profileName(profile);const parts=(fullName||"").split(/\s+/);return{first_name:firstText(profile,["firstName"])||parts[0]||null,last_name:firstText(profile,["lastName"])||parts.slice(1).join(" ")||null,full_name:fullName,title:firstText(profile,["title","occupation","jobTitle"]),department:firstText(profile,["department","function"]),seniority:firstText(profile,["seniority","seniorityLevel"]),email:firstText(profile,["email","emailAddress","workEmail"]),phone:firstText(profile,["phone","phoneNumber"]),linkedin_url:linkedinUrl||validLinkedInUrl(firstText(profile,["linkedinUrl","profileUrl","url"])),profile_photo_url:firstText(profile,["profilePicture","profilePictureUrl","photoUrl","imageUrl"]),headline:firstText(profile,["headline"]),about:firstText(profile,["about","summary"]),location:firstText(profile,["location","geo"]),experience:array(profile?.experience||profile?.positions),education:array(profile?.education),skills:array(profile?.skills),source:"apify_linkedin_public",confidence_score:linkedinUrl?90:75,is_primary:true,verified_at:new Date().toISOString()};}
function number(value:unknown){const result=Number(value);return Number.isFinite(result)?result:null;}function integer(value:unknown){const result=Number(value);return Number.isInteger(result)&&result>=0?result:null;}function object(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}function array(value:unknown){return Array.isArray(value)?value:[];}

async function createLeadBrief(lead: Record<string, unknown>, linkedinProfile: Record<string, unknown> | null) {
  const fallback = fallbackBrief(lead, linkedinProfile);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;
  const evidence = JSON.stringify({ lead: safeEvidence(lead), linkedinProfile: linkedinProfile ? safeEvidence(linkedinProfile) : null }).slice(0, 24000);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      tools: [{ type: "web_search" }],
      instructions: "Tu es un analyste commercial B2B francophone. Utilise exclusivement les données fournies. N'invente aucun fait. Prépare une fiche concise, utile avant un appel. L'icebreaker doit être naturel, positif, précis et ne pas prétendre avoir vu une information absente.",
      input: evidence,
      text: { format: { type: "json_schema", name: "lead_brief", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "string" }, icebreaker: { type: "string" }, whyNow: { type: "string" },
          callBrief: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
          sources: { type: "array", items: { type: "object", additionalProperties: false, properties: { url: { type: "string" }, title: { type: "string" }, publishedAt: { type: ["string", "null"] }, confidence: { type: "string", enum: ["verified", "probable", "to_verify"] } }, required: ["url", "title", "publishedAt", "confidence"] }, maxItems: 10 },
        },
        required: ["summary", "icebreaker", "whyNow", "callBrief", "sources"],
      }}},
    }),
  });
  if (!response.ok) return fallback;
  const data = await response.json() as Record<string, unknown>;
  const outputText = typeof data.output_text === "string" ? data.output_text : extractOutputText(data.output);
  if (!outputText) return fallback;
  try {
    const parsed = JSON.parse(outputText);
    return {
      summary: clean(parsed.summary, 900) || fallback.summary,
      icebreaker: clean(parsed.icebreaker, 600) || fallback.icebreaker,
      whyNow: clean(parsed.whyNow, 600) || fallback.whyNow,
      callBrief: Array.isArray(parsed.callBrief) ? parsed.callBrief.map((item: unknown) => clean(item, 300)).filter(Boolean).slice(0, 5) : fallback.callBrief,
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((item: unknown) => item && typeof item === "object").slice(0, 10) : [],
    };
  } catch { return fallback; }
}

function fallbackBrief(lead: Record<string, unknown>, profile: Record<string, unknown> | null) {
  const company = clean(lead.company, 160) || "cette entreprise";
  const offer = clean(lead.recommendedOffer, 80) || "Net.AI";
  const person = profileName(profile);
  return {
    summary: `${company} correspond à une opportunité ${offer}. Les coordonnées et signaux publics affichés doivent être vérifiés avant le contact.`,
    icebreaker: person
      ? `Bonjour ${person.split(" ")[0]}, j'ai découvert ${company} en analysant les entreprises actives de votre zone. Votre profil m'a permis de voir que vous étiez probablement la bonne personne à contacter.`
      : `Bonjour, j'ai découvert ${company} en analysant les entreprises actives de votre zone et un point précis a retenu mon attention.`,
    whyNow: clean(lead.fitReason, 600) || "Le profil mérite une qualification rapide avant d'être placé dans une campagne.",
    callBrief: ["Confirmer le bon décideur et son rôle.", "Valider le besoin avant de présenter la solution.", "Proposer une prochaine étape simple et datée."],
  };
}

function safeEvidence(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (typeof value === "string") return value.slice(0, 1200);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => safeEvidence(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 60).map(([key, item]) => [key, safeEvidence(item, depth + 1)]));
  return undefined;
}
function validLinkedInUrl(value: unknown) { const url = clean(value, 500); return url && /^https:\/\/(www\.)?linkedin\.com\/in\//i.test(url) ? url : null; }
function profileName(profile: Record<string, unknown> | null) { if (!profile) return null; return firstText(profile, ["fullName", "name"]) || [firstText(profile, ["firstName"]), firstText(profile, ["lastName"])].filter(Boolean).join(" ") || null; }
function currentPosition(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  for (const key of ["experience", "positions", "currentPositions"]) {
    const rows = profile[key];
    if (Array.isArray(rows) && rows[0] && typeof rows[0] === "object") {
      const row = rows[0] as Record<string, unknown>;
      return [firstText(row, ["title", "position"]), firstText(row, ["companyName", "company"])].filter(Boolean).join(" chez ") || null;
    }
  }
  return null;
}
function firstText(record: Record<string, unknown> | null, keys: string[]) { if (!record) return null; for (const key of keys) { const value = clean(record[key], 500); if (value) return value; } return null; }
function extractOutputText(output: unknown) {
  if (!Array.isArray(output)) return null;
  for (const item of output) if (item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content)) {
    for (const part of (item as { content: unknown[] }).content) if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return (part as Record<string, unknown>).text as string;
  }
  return null;
}
function clean(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[<>\r\n]/g, " ").trim().slice(0, max) : null; }
async function reportProgress(jobId:unknown,progress:number){const id=clean(jobId,80);if(id)await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(id)}&status=eq.running`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({progress})});}
