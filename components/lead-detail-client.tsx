"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Lead = Record<string, unknown>;
export default function LeadDetailClient({ id }: { id: string }) {
  const [lead, setLead] = useState<Lead | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Lead introuvable."); setLead(payload.item); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Lead introuvable.")); }, [id]);
  async function enrich() {
    if (!lead || busy) return; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.externalId || lead.id, company: lead.company, location: lead.location, sourceUrl: lead.sourceUrl, website: lead.website }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Enrichissement impossible.");
      if (response.status === 202 && payload.jobId) {
        setNotice("Enrichissement placé en file…");
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const statusResponse = await fetch(`/api/enrich/${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
          const statusPayload = await statusResponse.json();
          if (statusPayload.job?.status === "completed") { setNotice("Enrichissement terminé et fiche actualisée."); break; }
          if (["failed", "cancelled"].includes(statusPayload.job?.status)) throw new Error(statusPayload.job.error_message || "Enrichissement interrompu.");
          setNotice(`Enrichissement en cours (${statusPayload.job?.progress || 0} %)…`);
        }
      } else {
        setLead((current) => current ? { ...current, ...(payload.lead || {}), enrichment: payload.enrichment } : current);
        setNotice("Enrichissement terminé et fiche actualisée.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enrichissement impossible."); } finally { setBusy(false); }
  }
  async function enrichLegacy() {
    if (!lead || busy) return; setBusy(true); setError(""); setNotice("");
    try { const response = await fetch("/api/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.externalId || lead.id, company: lead.company, location: lead.location, sourceUrl: lead.sourceUrl, website: lead.website }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Enrichissement impossible."); setLead((current) => current ? { ...current, ...(payload.lead || {}), enrichment: payload.enrichment } : current); setNotice("Enrichissement terminé et fiche actualisée."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enrichissement impossible."); } finally { setBusy(false); }
  }
  if (error && !lead) return <main className="content-wrap" style={{ padding: 32 }}><p className="search-error">{error}</p><Link className="secondary-action" href="/leads">Retour aux leads</Link></main>;
  if (!lead) return <main className="content-wrap" style={{ padding: 32 }}><p>Chargement de la fiche…</p></main>;
  const raw = (lead.rawData || {}) as Record<string, unknown>;
  return <main className="content-wrap" style={{ padding: 32 }}><p className="eyebrow">FICHE LEAD</p><h1>{String(lead.company || "Entreprise")}</h1><p>{String(lead.location || "")} · Score {String(lead.score || 0)}/100</p><section className="contact-details"><div><span>Email</span><strong>{String(lead.email || "À enrichir")}</strong></div><div><span>Téléphone</span><strong>{String(lead.phone || "À enrichir")}</strong></div><div><span>Site</span><strong>{String(lead.website || "À enrichir")}</strong></div><div><span>Statut</span><strong>{String(lead.dealStatus || "new")}</strong></div></section><button className="primary-cta" onClick={() => void enrich()} disabled={busy}>{busy ? "Enrichissement en cours…" : "Rechercher plus d'informations"}</button>{notice && <p role="status" className="composer-notice">{notice}</p>}{error && <p className="search-error">{error}</p>}<article className="prospect-facts"><h2>Données publiques</h2>{Object.entries(raw).slice(0, 30).map(([key, value]) => <p key={key}><strong>{key} :</strong> {typeof value === "string" ? value : JSON.stringify(value)}</p>)}</article><Link className="secondary-action" href="/leads">Retour aux leads</Link></main>;
}
