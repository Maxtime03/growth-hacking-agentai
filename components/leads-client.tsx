"use client";

import { useEffect, useState } from "react";

type Lead = { id: string; company: string; category?: string; location?: string; email?: string; phone?: string; score: number; dealStatus?: string; opportunityValue?: number; nextAction?: string | null };

export default function LeadsClient() {
  const [items, setItems] = useState<Lead[]>([]); const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [error, setError] = useState("");
  async function load() {
    setError(""); const params = new URLSearchParams({ page: String(page), pageSize: "50" }); if (q) params.set("q", q); if (status) params.set("status", status);
    const response = await fetch(`/api/leads?${params}`, { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Leads indisponibles."); setItems(payload.items || []); setPages(payload.pageCount || 1);
  }
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Leads indisponibles.")); }, [page, status]);
  return <main className="content-wrap" style={{ padding: 32 }}><p className="eyebrow">LEADS</p><h1>Leads importés</h1><div className="module-toolbar"><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Erreur")); } }} placeholder="Rechercher une entreprise, un email…"/><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Tous les statuts</option><option value="new">Nouveau</option><option value="qualified">Qualifié</option><option value="contacted">Contacté</option><option value="negotiation">Négociation</option><option value="won">Gagné</option><option value="lost">Perdu</option></select></div>{error && <p className="search-error">{error}</p>}<div className="table-card"><div className="table-scroll"><table><thead><tr><th>Entreprise</th><th>Contact</th><th>Score</th><th>Statut</th><th>Prochaine action</th></tr></thead><tbody>{items.map((lead) => <tr key={lead.id} onClick={() => { window.location.href = `/leads/${encodeURIComponent(lead.id)}`; }}><td><strong>{lead.company}</strong><br/><small>{lead.location || lead.category || ""}</small></td><td>{lead.email || lead.phone || "À enrichir"}</td><td>{lead.score}/100</td><td>{lead.dealStatus || "new"}</td><td>{lead.nextAction || "À définir"}</td></tr>)}</tbody></table></div></div><div className="table-footer"><span>{items.length} lead(s)</span><div className="lead-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Précédent</button><span>Page {page}/{pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Suivant</button></div></div></main>;
}
