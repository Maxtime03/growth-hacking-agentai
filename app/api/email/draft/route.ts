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
    const fallback = {
      subject: `${company} — une idée à valider ensemble`,
      body: `Bonjour${person ? ` ${person.split(" ")[0]}` : ""},\n\nJ’ai découvert ${company} et la qualité de votre positionnement a retenu mon attention.\n\nEn analysant votre profil, j’ai identifié une piste concrète liée à ${offer}, à valider avec vous sans engagement.\n\nCurieux d’en savoir plus ? Répondez simplement « oui » et nous prévoyons un échange de 15 minutes.\n\nBien à vous,\nMaxime`,
    };
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json(fallback);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        instructions: "Rédige un email B2B en français, extrêmement court et naturel. Utilise seulement les faits fournis. Structure: icebreaker factuel, compliment crédible, valeur en 2 phrases maximum, CTA demandant de répondre oui. Pas de fausse statistique, pas de promesse, pas de jargon. 90 mots maximum.",
        input: JSON.stringify({ company, person, offer, evidence }),
        text: { format: { type: "json_schema", name: "email_draft", strict: true, schema: { type: "object", additionalProperties: false, properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] } } },
      }),
    });
    if (!response.ok) return Response.json(fallback);
    const payload = await response.json() as { output_text?: string };
    const parsed = payload.output_text ? JSON.parse(payload.output_text) : fallback;
    return Response.json({ subject: clean(parsed.subject, 240) || fallback.subject, body: typeof parsed.body === "string" ? parsed.body.slice(0, 5000) : fallback.body });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Génération impossible." }, { status: 502 });
  }
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[<>\r\n]/g, " ").trim().slice(0, max) : null; }
