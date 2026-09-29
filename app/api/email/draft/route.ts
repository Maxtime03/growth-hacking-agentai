import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  try {
    const data = await request.json() as Record<string, unknown>;
    const company = clean(data.company, 160) || "votre entreprise";
    const offer = clean(data.offer, 80) || "Net.AI";
    const person = clean(data.person, 120);
    const evidence = clean(data.evidence, 2000) || "Aucune donnée vérifiée supplémentaire.";
    const action = clean(data.action, 80) || "regenerate";
    const fallback = {
      subject: `${company} — une idée à valider ensemble`,
      body: `Bonjour${person ? ` ${person.split(" ")[0]}` : ""},\n\nJ’ai découvert ${company} et la qualité de votre positionnement a retenu mon attention.\n\nEn analysant votre profil, j’ai identifié une piste concrète liée à ${offer}, à valider avec vous sans engagement.\n\nCurieux d’en savoir plus ? Répondez simplement « oui » et nous prévoyons un échange de 15 minutes.\n\nBien à vous,\nMaxime`,
    };
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ ...fallback, sources: evidence === "Aucune donnée vérifiée supplémentaire." ? [] : [evidence] });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        instructions: "Rédige ou améliore un email B2B en français, extrêmement court et naturel. Utilise exclusivement les faits fournis. N'invente aucun chiffre, activité ou anecdote. Structure: icebreaker factuel, compliment crédible, valeur en 2 ou 3 phrases, CTA léger demandant de répondre oui pour un échange de 20 minutes maximum. 100 mots maximum. Respecte précisément l'action demandée.",
        input: JSON.stringify({ company, person, offer, evidence, action, currentSubject:data.subject, currentBody:data.body }),
        text: { format: { type: "json_schema", name: "email_draft", strict: true, schema: { type: "object", additionalProperties: false, properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] } } },
      }),
    });
    if (!response.ok) return Response.json(fallback);
    const payload = await response.json() as { output_text?: string };
    const parsed = payload.output_text ? JSON.parse(payload.output_text) : fallback;
    return Response.json({ subject: clean(parsed.subject, 240) || fallback.subject, body: typeof parsed.body === "string" ? parsed.body.slice(0, 5000) : fallback.body, sources: evidence === "Aucune donnée vérifiée supplémentaire." ? [] : [evidence] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Génération impossible." }, { status: 502 });
  }
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[<>\r\n]/g, " ").trim().slice(0, max) : null; }
