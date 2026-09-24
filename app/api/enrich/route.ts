import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
const USER_AGENT = "NetAILeadOS/1.0 (hello@net-ia.biz)";

export async function POST(request: Request) {
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
    const businessLead = findBusinessLead(companyEnrichment);
    const linkedinUrl = validLinkedInUrl(lead.linkedinUrl) || validLinkedInUrl(firstText(businessLead, ["linkedinUrl", "linkedin", "profileUrl"]));
    const linkedinProfile = linkedinUrl ? await fetchLinkedInProfile(linkedinUrl) : null;
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
    await persistEnrichment(enrichedLead, enrichment);
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
    maximumLeadsEnrichmentRecords: 3,
    leadsEnrichmentDepartments: ["c_suite", "operations", "sales", "marketing"],
    verifyLeadsEnrichmentEmails: false,
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    maxImages: 0,
  };
  const response = await fetch("https://api.apify.com/v2/acts/lukaskrivka~google-maps-with-contact-details/run-sync-get-dataset-items?timeout=300&clean=true&format=json", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(input), cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`L'enrichissement Google Maps/Apify a échoué (${response.status}). ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  return Array.isArray(data) && data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
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

async function persistEnrichment(lead: Record<string, unknown>, enrichment: Record<string, unknown>) {
  const externalId = clean(lead.id, 200);
  if (!externalId) return;
  const response = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      email: clean(lead.email, 320), phone: clean(lead.phone, 120), linkedin_url: clean(lead.linkedinUrl, 800),
      status: "enriched", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      raw_data: { ...lead, enrichment },
    }),
  });
  if (!response.ok) throw new Error(`L'enrichissement a été trouvé mais n'a pas pu être enregistré (${response.status}).`);
}

async function fetchLinkedInProfile(url: string): Promise<Record<string, unknown> | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN manque dans .env.local.");
  const response = await fetch("https://api.apify.com/v2/actors/harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items?timeout=240&clean=true&format=json", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ profileScraperMode: "Profile details", urls: [url] }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Apify LinkedIn a refusé l'enrichissement (${response.status}). ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  return Array.isArray(data) && data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
}

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
