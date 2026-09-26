"use client";

import {
  BarChart3, Bell, Building2, CalendarClock, ChevronRight, CircleCheck,
  CircleHelp, Filter, Gauge, LayoutDashboard, MapPin, Menu, Phone,
  Globe2, Mail, PlugZap, Search, Settings, Sparkles, Target, Users, X, Zap,
  Radar, WandSparkles, History, Send, FileText, Flame,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import GoogleRadarMap, { type RadarPoint } from "@/components/google-radar-map";
import CrmWorkspacePages from "@/components/crm-workspace-pages";
import { workspaceForProfile } from "@/lib/workspaces";

export type Opportunity = {
  id: string;
  company: string; location: string; kind: string; score: number;
  confidence: number; chargers: number; parking: string; phone: string | null;
  email: string | null; website: string | null; decisionMaker: string | null;
  operator: string | null; openingHours: string | null; description: string | null;
  chargersWithin500m: number; chargersWithin2km: number; nearestChargerMeters: number | null;
  sourceUrl: string;
  coordinates?: { lat: number; lon: number };
  status: "À appeler" | "À vérifier" | "Nouveau";
  temperature?: "Chaud" | "Tiède" | "À nourrir";
  recommendedOffer?: "Pluq" | "Lexicon" | "Profitflow" | "À analyser";
  fitReason?: string;
  linkedinUrl?: string | null; instagramUrl?: string | null; facebookUrl?: string | null;
  enrichment?: {
    fullName?: string | null; headline?: string | null; currentPosition?: string | null;
    email?: string | null; summary?: string | null; icebreaker?: string | null;
    whyNow?: string | null; callBrief?: string[]; sources?: string[];
  };
  databaseId?: string;
  dealStatus?: "new" | "qualified" | "contacted" | "negotiation" | "won" | "lost";
  opportunityValue?: number;
  nextAction?: string | null;
  nextActionAt?: string | null;
};

type SearchMeta = { totalFound: number; returned: number; chargingStationsChecked: number; chargingSource: string; businessSource: string; fetchedAt: string };
type SearchRun = { id: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; desiredLimit?: number; resultCount?: number; error?: string | null; createdAt?: string };
const leadVolumes = [10, 20, 50, 100, 200, 300, 500, 700, 1000, 2000, 3000, 5000];
const PAGE_SIZE = 50;

const navigation = [
  { label: "Vue d'ensemble", path: "/", icon: LayoutDashboard },
  { label: "Radar", path: "/radar", icon: Radar }, { label: "Leads", path: "/leads", icon: Target },
  { label: "Enrichissement", path: "/enrichissement", icon: WandSparkles },
  { label: "File d'appels", path: "/appels", icon: Phone, badge: "12" },
  { label: "Campagnes", path: "/campagnes", icon: Send }, { label: "Suivis", path: "/suivis", icon: History },
  { label: "Content Studio", path: "/content", icon: FileText }, { label: "Analyses", path: "/analyses", icon: BarChart3 },
  { label: "Expéditeurs", path: "/settings/email", icon: Mail }, { label: "Paramètres", path: "/settings", icon: Settings },
];

const pathToNav: Record<string, string> = { "/": "Vue d'ensemble", "/radar": "Radar", "/leads": "Leads", "/enrichissement": "Enrichissement", "/appels": "File d'appels", "/campagnes": "Campagnes", "/suivis": "Suivis", "/content": "Content Studio", "/analyses": "Analyses", "/settings/email": "Expéditeurs", "/settings": "Paramètres" };

const regionsByCountry: Record<string, string[]> = {
  Belgique: ["Brabant wallon", "Bruxelles", "Liège", "Hainaut", "Namur", "Flandre"],
  France: ["Île-de-France", "Hauts-de-France", "Grand Est", "Auvergne-Rhône-Alpes", "Provence-Alpes-Côte d’Azur"],
  "Pays-Bas": ["Hollande-Méridionale", "Hollande-Septentrionale", "Brabant-Septentrional", "Utrecht", "Gueldre"],
  Luxembourg: ["Luxembourg", "Capellen", "Esch-sur-Alzette", "Diekirch", "Grevenmacher"],
};

const searchProfiles = {
  large: { name: "Exploration large", short: "Toutes les entreprises", hint: "Brassez large, puis laissez le score détecter les meilleures offres.", logo: "/netai-logo.png" },
  pluq: { name: "Pluq", short: "Recharge & parkings", hint: "Hôtels, loisirs, retail, bureaux, santé et sites avec stationnement prolongé.", logo: "/pluq-logo.png" },
  lexicon: { name: "Lexicon", short: "Visibilité IA", hint: "Entreprises visibles, dirigeant identifiable et enjeu de réputation ou d'autorité.", logo: "/lexicon-logo.png" },
  profitflow: { name: "Profitflow", short: "Cashflow & talents", hint: "PME en croissance, besoin de financement ou de compétences flexibles.", logo: "/profitflow-logo.png" },
} as const;
type SearchProfile = keyof typeof searchProfiles;

function ScoreRing({ value }: { value: number }) {
  return <div className="score-ring" style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties} aria-label={`Score ${value} sur 100`}><span>{value}</span></div>;
}

export default function Dashboard({ userEmail, ocmConnected, apifyConnected }: { userEmail: string; ocmConnected: boolean; apifyConnected: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [country, setCountry] = useState("Belgique");
  const [region, setRegion] = useState("Brabant wallon");
  const [category, setCategory] = useState("Toutes les catégories");
  const [searchProfile, setSearchProfile] = useState<SearchProfile>("large");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const activeNav = pathToNav[pathname] || "Vue d'ensemble";
  const [notice, setNotice] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<RadarPoint | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [leadLimit, setLeadLimit] = useState(50);
  const [radiusKm, setRadiusKm] = useState(8);
  const [activeRun, setActiveRun] = useState<SearchRun | null>(null);
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => opportunities.filter((item) => {
    const matchesQuery = `${item.company} ${item.location} ${item.kind}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === "Toutes les catégories" || item.kind === category);
  }), [category, query, opportunities]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  const mapLeads = useMemo(() => opportunities.slice(0, 1000), [opportunities]);
  const lexiconOnly = userEmail.trim().toLowerCase() === "etiennedujardin@hotmail.com";
  const visibleNavigation = lexiconOnly ? navigation.filter((item) => ["Vue d'ensemble", "Radar", "Leads", "Enrichissement", "File d'appels", "Campagnes", "Suivis", "Analyses", "Expéditeurs"].includes(item.label)) : navigation;
  const activeWorkspace = workspaceForProfile(searchProfile);

  const loadRun = useCallback(async (runId?: string) => {
    const response = await fetch(`/api/opportunities${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Impossible de charger la recherche.");
    setActiveRun(payload.run || null);
    if (payload.run?.status === "completed") {
      setOpportunities(payload.items || []); setMeta(payload.meta || null); setRunning(false); setPage(1);
      return true;
    }
    if (payload.run?.status === "failed" || payload.run?.status === "cancelled") {
      setRunning(false); throw new Error(payload.run.error || "La collecte Apify a échoué.");
    }
    setRunning(Boolean(payload.run));
    return false;
  }, []);

  useEffect(() => { void loadRun().catch(() => undefined); }, [loadRun]);
  useEffect(() => {
    document.querySelector<HTMLButtonElement>(".radar-launch")?.setAttribute("aria-label", `Generer ${leadLimit.toLocaleString("fr-BE")} leads`);
  }, [leadLimit]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_connected") === "1") showNotice("Compte Google connecté. Lecture et envoi Gmail sont prêts.");
    if (params.has("email_connected") || params.has("email_error")) window.history.replaceState({}, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (!activeRun?.id || !["queued", "running"].includes(activeRun.status)) return;
    const timer = window.setTimeout(() => void loadRun(activeRun.id).catch((cause) => { setRunning(false); setError(cause instanceof Error ? cause.message : "Erreur de suivi."); }), 5000);
    return () => window.clearTimeout(timer);
  }, [activeRun, loadRun]);

  const startAnalysis = useCallback(async (point?: RadarPoint | null) => {
    if (leadLimit >= 1000 && !window.confirm(`Cette recherche va demander jusqu'à ${leadLimit.toLocaleString("fr-BE")} établissements à Apify et peut entraîner un coût important. Continuer ?`)) return;
    setRunning(true); setError(null); setSelected(null); setPage(1);
    try {
      const target = point || selectedPoint;
      const body = { country, region, category, profile: searchProfile, limit: leadLimit,
        ...(target ? { lat: target.lat, lng: target.lon, radiusKm, areaLabel: target.label || "Zone sélectionnée" } : {}) };
      const response = await fetch("/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "La recherche a échoué.");
      setActiveRun({ id: payload.runId, status: payload.status || "running", desiredLimit: leadLimit });
      showNotice(`Recherche de ${leadLimit.toLocaleString("fr-BE")} leads lancée. La liste se remplira automatiquement.`);
      if (leadLimit === 50) showNotice("Recherche de 50 leads lancee");
    } catch (cause) {
      setRunning(false);
      setError(cause instanceof Error ? cause.message : "Erreur de recherche.");
    }
  }, [country, region, category, searchProfile, selectedPoint, leadLimit, radiusKm]);
  const selectMapArea = useCallback((point: RadarPoint) => {
    setSelectedPoint({ ...point, radiusKm });
    showNotice("Zone sélectionnée. Choisissez le volume puis lancez le Radar.");
  }, [radiusKm]);
  const selectMapLead = useCallback((lead: { id: string }) => {
    const match = opportunities.find((item) => item.id === lead.id);
    if (match) setSelected(match);
  }, [opportunities]);
  async function enrichLead(lead: Opportunity) {
    setEnrichingId(lead.id); setError(null);
    try {
      const response = await fetch("/api/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "L'enrichissement a échoué.");
      const enriched = { ...lead, ...payload.lead, enrichment: payload.enrichment };
      setOpportunities((items) => items.map((item) => item.id === lead.id ? enriched : item));
      setSelected(enriched);
      showNotice(payload.linkedinFound ? "Profil LinkedIn et analyse IA ajoutés." : "Analyse IA ajoutée. Aucun profil LinkedIn public détecté.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur d'enrichissement.");
    } finally { setEnrichingId(null); }
  }
  async function savePipeline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const payload = { externalId: selected.id, dealStatus: String(form.get("dealStatus") || "new"), opportunityValue: Number(form.get("opportunityValue") || 0), nextAction: String(form.get("nextAction") || ""), nextActionAt: String(form.get("nextActionAt") || "") || null };
    try {
      const response = await fetch("/api/leads", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mise à jour impossible.");
      const updated = { ...selected, dealStatus: payload.dealStatus as Opportunity["dealStatus"], opportunityValue: payload.opportunityValue, nextAction: payload.nextAction || null, nextActionAt: payload.nextActionAt };
      setSelected(updated); setOpportunities((items)=>items.map((item)=>item.id===selected.id?updated:item));
      showNotice("Pipeline et prochaine action enregistrés.");
    } catch(cause) { setError(cause instanceof Error?cause.message:"Mise à jour impossible."); }
  }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(null), 2600); }
  function handleNavigation(label: string) {
    const item = navigation.find((entry) => entry.label === label);
    if (item) router.push(item.path);
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-overlay" aria-label="Fermer la navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row"><img className="netai-brand" src="/netai-logo.png" alt="Net.AI" /><span className="brand-product">LeadOS</span><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Fermer"><X size={18} /></button></div>
        <div className="workspace-pill"><div className="workspace-logo-stack"><img src="/pluq-logo.png" alt="Pluq" /><img src="/profitflow-logo.png" alt="Profitflow" /><img src="/lexicon-icon.png" alt="Lexicon" /></div><div><strong>Portefeuille clients</strong><span>3 espaces commerciaux</span></div><ChevronRight size={16} /></div>
        <nav><p className="nav-title">ESPACE DE TRAVAIL</p>{visibleNavigation.map((item) => <Link key={item.label} href={item.path} onClick={() => { setSidebarOpen(false); router.push(item.path); }} className={`nav-item ${activeNav === item.label ? "active" : ""}`}><item.icon size={18} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</Link>)}</nav>
        <div className="sidebar-footer"><Link className="nav-item" href="/settings"><CircleHelp size={18} /><span>Aide & documentation</span></Link><Link className="nav-item" href="/settings/email"><Settings size={18} /><span>Expéditeurs</span></Link><a className="user-card" href="/signout-with-chatgpt?return_to=/"><div className="avatar">MT</div><div><strong>Maxime</strong><span>{userEmail}</span></div><ChevronRight size={15} /></a></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button><div className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une entreprise, une ville..." /><kbd>⌘ K</kbd></div><button className="icon-button notification" onClick={() => showNotice("Aucune nouvelle notification.")}><Bell size={19} /><i /></button><button className="new-campaign" onClick={() => handleNavigation("Radar")}><Sparkles size={17} />Nouvelle recherche</button></header>
        <div className="content-wrap">
          {!['Radar','Leads'].includes(activeNav) && <CrmWorkspacePages page={activeNav} leads={opportunities} onOpenLead={(lead) => router.push(`/leads/${encodeURIComponent(lead.databaseId || lead.id)}`)} onEnrichLead={(lead) => void enrichLead(lead)} enrichingId={enrichingId} onNavigate={handleNavigation} />}
          <section className={`welcome-row ${activeNav === "Radar" ? "" : "nav-hidden"}`}><div><p className="eyebrow">NET.AI · REVENUE INTELLIGENCE</p><h1>Radar territorial <span>détectez les bons signaux sur une zone précise.</span></h1></div><div className="live-status"><i />Moteur opérationnel <span>{meta ? `${meta.businessSource} · ${meta.chargingSource}` : `Apify ${apifyConnected ? "connecté" : "non connecté"} · OCM ${ocmConnected ? "connecté" : "non connecté"}`}</span></div></section>

          {activeNav === "Leads" && <header className="module-head"><div><p className="eyebrow">LEADS</p><h1>Vos opportunités, enfin exploitables.</h1><p>Filtrez, ouvrez la fiche complète, enrichissez le contact et choisissez la prochaine action.</p></div><button className="primary-cta" onClick={() => handleNavigation("Radar")}><Radar size={17}/>Générer des leads</button></header>}

          <section className={`radar-layout ${activeNav === "Radar" ? "" : "nav-hidden"}`} id="radar">
            <article className="geo-radar">
              <div className="radar-head"><div><p className="eyebrow">RADAR COMMERCIAL</p><h2>Choisissez votre zone d'impact</h2><span>France, Belgique, Pays-Bas et Luxembourg</span></div><div className="radar-pulse"><i /><Radar size={19} /></div></div>
              <div className="map-stage" role="group" aria-label="Carte interactive des prospects">
                <GoogleRadarMap country={country} leads={mapLeads} selectedPoint={selectedPoint} selectedLeadId={selected?.id} running={running} onAreaSelect={selectMapArea} onLeadSelect={selectMapLead} />
                {opportunities.length > 1000 && <div className="map-result-cap">Top 1 000 affichés sur la carte · liste complète ci-dessous</div>}
                <div className="map-country-actions">{Object.keys(regionsByCountry).map((item) => <button key={item} className={country === item ? "selected" : ""} onClick={() => { setCountry(item); setRegion(regionsByCountry[item][0]); setSelectedPoint(null); }}>{item}</button>)}</div>
              </div>
            </article>
            <article className="radar-control">
              <div className="mode-heading"><span>1</span><div><strong>Quel signal recherchez-vous ?</strong><p>Le Radar adapte les secteurs, les preuves et le scoring à l'offre.</p></div></div>
              <div className="profile-grid">{(Object.entries(searchProfiles) as [SearchProfile, typeof searchProfiles[SearchProfile]][]).filter(([key]) => !lexiconOnly || key === "lexicon").map(([key, profile]) => <button key={key} className={searchProfile === key ? "active" : ""} onClick={() => setSearchProfile(key)}><img src={profile.logo} alt="" /><div><strong>{profile.name}</strong><span>{profile.short}</span></div></button>)}</div>
              <div className="profile-explainer"><Sparkles size={16} /><span>{searchProfiles[searchProfile].hint}</span></div>
              <div className="mode-heading compact"><span>2</span><div><strong>Affinez le territoire</strong><p>Le lancement utilise les sources réelles déjà connectées.</p></div></div>
              <div className="radar-filters">
                <label>Région<select value={region} onChange={(e) => setRegion(e.target.value)}>{regionsByCountry[country].map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Secteur<select value={category} onChange={(e) => setCategory(e.target.value)}><option>Toutes les catégories</option><option>Hôtel & séminaires</option><option>Parc d'affaires</option><option>Sports & loisirs</option><option>Centre commercial</option><option>Santé</option></select></label>
                <label>Rayon autour du point<select value={radiusKm} onChange={(e) => { const value = Number(e.target.value); setRadiusKm(value); setSelectedPoint((point) => point ? { ...point, radiusKm: value } : point); }}><option value={2}>2 km</option><option value={5}>5 km</option><option value={8}>8 km</option><option value={10}>10 km</option><option value={20}>20 km</option><option value={30}>30 km</option></select></label>
                <label>Nombre de leads<select value={leadLimit} onChange={(e) => setLeadLimit(Number(e.target.value))}>{leadVolumes.map((value) => <option key={value} value={value}>{value.toLocaleString("fr-BE")}</option>)}</select></label>
              </div>
              {selectedPoint && <div className="selected-map-zone"><MapPin size={15}/><div><strong>Zone pointée sur la carte</strong><span>{selectedPoint.label} · rayon {selectedPoint.radiusKm || 8} km</span></div><button onClick={() => setSelectedPoint(null)}>Effacer</button></div>}
              <button className="radar-launch" onClick={() => void startAnalysis()} disabled={running}>{running ? <><span className="spinner" />Collecte Apify en cours…</> : <><Radar size={18} />Générer {leadLimit.toLocaleString("fr-BE")} leads</>}</button>
              {activeRun && <div className={`search-run-state run-${activeRun.status}`}><strong>{activeRun.status === "completed" ? "Recherche terminée" : activeRun.status === "failed" ? "Recherche échouée" : "Recherche enregistrée et en cours"}</strong><span>{activeRun.status === "completed" ? `${activeRun.resultCount || opportunities.length} leads disponibles dans la liste` : `Objectif : ${(activeRun.desiredLimit || leadLimit).toLocaleString("fr-BE")} leads · mise à jour automatique`}</span></div>}
              <div className="radar-sources"><span><CircleCheck size={13} />Apify</span>{activeWorkspace.mapLayer === "business+ocm" && <span><CircleCheck size={13} />Open Charge Map</span>}<span><CircleCheck size={13} />Traçabilité</span></div>
              {error && <div className="search-error">{error}</div>}
            </article>
          </section>
          <section className={`finder-card compact-finder ${activeNav === "Radar" ? "" : "nav-hidden"}`} id="recherche"><div className="finder-heading"><div><span className="section-icon"><Target size={20} /></span><div><h2>Recherche active</h2><p>{searchProfiles[searchProfile].name} · {country} · {region}</p></div></div><span className="beta-pill">QUALITÉ &gt; VOLUME</span></div><div className="filter-grid">
            <label>Pays<select value={country} onChange={(e) => { const nextCountry = e.target.value; setCountry(nextCountry); setRegion(regionsByCountry[nextCountry][0]); }}><option>Belgique</option><option>France</option><option>Pays-Bas</option><option>Luxembourg</option></select></label>
            <label>Région<select value={region} onChange={(e) => setRegion(e.target.value)}>{regionsByCountry[country].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Type d'établissement<select value={category} onChange={(e) => setCategory(e.target.value)}><option>Toutes les catégories</option><option>Hôtel & séminaires</option><option>Parc d'affaires</option><option>Sports & loisirs</option><option>Centre commercial</option><option>Santé</option></select></label>
            <label>Volume<select value={leadLimit} onChange={(e) => setLeadLimit(Number(e.target.value))}>{leadVolumes.map((value) => <option key={value} value={value}>{value.toLocaleString("fr-BE")} leads</option>)}</select></label>
            <button className="analysis-button" onClick={() => void startAnalysis()} disabled={running}>{running ? <><span className="spinner" />Analyse en cours...</> : <><Zap size={18} />Relancer l'analyse</>}</button>
          </div>{error && <div className="search-error">{error}</div>}</section>
          <section className={`metrics-grid ${activeNav === "Leads" ? "" : "nav-hidden"}`}>
            <article><div className="metric-icon mint"><Target size={19} /></div><div><p>Opportunités trouvées</p><strong>{opportunities.length}</strong><span className="positive">Données de la recherche active</span></div></article>
            <article><div className="metric-icon blue"><Phone size={19} /></div><div><p>Contacts téléphoniques</p><strong>{opportunities.filter((item) => item.phone).length}</strong><span>{opportunities.filter((item) => item.email).length} e-mails publiés</span></div></article>
            <article><div className="metric-icon amber"><Gauge size={19} /></div><div><p>Score moyen</p><strong>{opportunities.length ? Math.round(opportunities.reduce((sum, item) => sum + item.score, 0) / opportunities.length) : 0}<span>/100</span></strong><span className="positive">Score explicable</span></div></article>
            <article><div className="metric-icon purple"><Building2 size={19} /></div><div><p>Bornes contrôlées</p><strong>{meta?.chargingStationsChecked || 0}</strong><span>{meta?.chargingSource || "En attente d'analyse"}</span></div></article>
          </section>
          <section className={`opportunity-section ${activeNav === "Leads" ? "" : "nav-hidden"}`} id="opportunites"><div className="section-header"><div><h2>Opportunités prioritaires</h2><p>Classées selon le potentiel commercial et la fiabilité des données.</p></div><button className="filter-button" onClick={() => setQuery("")}><Filter size={16} />Réinitialiser</button></div>
            <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Établissement</th><th>Contact</th><th>Offre recommandée</th><th>Score</th><th>Température</th><th>Statut</th><th /></tr></thead><tbody>{paginated.map((item) => <tr key={item.id} onClick={() => router.push(`/leads/${encodeURIComponent(item.databaseId || item.id)}`)}>
              <td><div className="company-cell"><div className="company-logo">{item.company.charAt(0)}</div><div><strong>{item.company}</strong><span><MapPin size={12} />{item.location} · {item.kind}</span></div></div></td>
              <td><div className="contact-cell"><strong>{item.decisionMaker || item.operator || "Responsable à enrichir"}</strong><span>{item.phone || item.email || "Coordonnées à enrichir"}</span></div></td>
              <td><span className={`offer-tag offer-${(item.recommendedOffer || "analyse").toLowerCase()}`}>{item.recommendedOffer || "À analyser"}</span><small className="fit-copy">{item.fitReason || "Profil à enrichir avant recommandation."}</small></td>
              <td><div className="score-cell"><ScoreRing value={item.score} /><span>Confiance {item.confidence}%</span></div></td>
              <td><span className={`temperature temperature-${(item.temperature || "À nourrir").toLowerCase().replace("à ", "")}`}><Flame size={13} />{item.temperature || "À nourrir"}</span></td>
              <td><span className={`status status-${item.status.toLowerCase().replaceAll(" ", "-").replace("à-", "")}`}>{item.status}</span></td><td><button className="row-action" aria-label={`Voir ${item.company}`} onClick={(event) => { event.stopPropagation(); router.push(`/leads/${encodeURIComponent(item.databaseId || item.id)}`); }}><ChevronRight size={18} /></button></td>
            </tr>)}</tbody></table>{!running && filtered.length === 0 && <div className="empty-results"><Target size={24} /><strong>Aucune donnée chargée</strong><span>Sélectionnez une ville ou une zone, choisissez le volume, puis cliquez sur « Générer ».</span></div>}</div><div className="table-footer"><span>{filtered.length} opportunités dans cette recherche{meta ? ` · ${meta.totalFound} enregistrées` : ""}</span><div className="lead-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Précédent</button><span>Page {page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Suivant</button></div><span>{meta ? `Actualisé ${new Date(meta.fetchedAt).toLocaleString("fr-BE")}` : "Source et date affichées après analyse"}</span></div></div>
          </section>
          <section className="enrichment-flow nav-hidden" id="enrichissement"><div className="section-header"><div><h2>De la détection au rendez-vous</h2><p>Chaque étape laisse une trace et impose une prochaine action.</p></div><span className="quality-badge">Anti-perte de lead</span></div><div className="flow-grid">
            <article><span>01</span><Radar size={20}/><strong>Détecter</strong><p>Zone, secteur et signaux adaptés à l'offre.</p></article>
            <article><span>02</span><WandSparkles size={20}/><strong>Enrichir</strong><p>Décideur, e-mail pro, actualité et preuves sourcées.</p></article>
            <article><span>03</span><Mail size={20}/><strong>Personnaliser</strong><p>Icebreaker vérifié, angle positif et bénéfice concret.</p></article>
            <article><span>04</span><CalendarClock size={20}/><strong>Suivre</strong><p>Réponse, relance, appel, rendez-vous et historique.</p></article>
          </div><div className="channel-strip"><span><Users size={16}/>LinkedIn</span><span><Mail size={16}/>Google Workspace</span><span><FileText size={16}/>Newsletter & PDF</span><span><Sparkles size={16}/>Placid / contenus</span><small>Connexions à activer séparément par client</small></div></section>
          <section className={`bottom-grid ${activeNav === "Radar" ? "" : "nav-hidden"}`} id="carte">
            <article className="activity-card"><div className="mini-header"><div><h3>Qualité de la recherche</h3><p>Traçabilité des données utilisées</p></div></div><ul><li><span className="activity-icon green"><CircleCheck size={15} /></span><div><strong>Établissements réels</strong><p>{meta ? `${meta.totalFound} lieux trouvés dans ${region}` : `Google Maps ${apifyConnected ? "connecté" : "non connecté"}`}</p></div><time>APIFY</time></li><li><span className="activity-icon blue"><PlugZap size={15} /></span><div><strong>Couverture des bornes</strong><p>{meta ? `${meta.chargingStationsChecked} emplacements contrôlés` : `Open Charge Map ${ocmConnected ? "connecté" : "non connecté"}`}</p></div><time>{meta?.chargingSource || "OCM"}</time></li><li><span className="activity-icon amber"><Bell size={15} /></span><div><strong>Enrichissement contacts</strong><p>Téléphone, site et e-mail professionnel quand publiés</p></div><time>RGPD</time></li></ul></article>
          </section>
        </div>
      </main>
      {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer" onClick={(e) => e.stopPropagation()}><button className="secondary-action" onClick={() => handleNavigation("File d'appels")}>Ajouter un rappel</button>
        <button className="drawer-close" onClick={() => setSelected(null)} aria-label="Fermer"><X size={19} /></button>
        <p className="eyebrow">FICHE PROSPECT RÉELLE</p><h2>{selected.company}</h2><p className="drawer-location"><MapPin size={15} />{selected.location}</p>
        <div className="drawer-score"><ScoreRing value={selected.score} /><div><strong>{selected.status}</strong><span>Confiance de l'analyse : {selected.confidence}%</span></div></div>
        <form className="pipeline-editor" onSubmit={savePipeline}><div><label>Étape<select name="dealStatus" defaultValue={selected.dealStatus || "new"}><option value="new">Nouveau</option><option value="qualified">Qualifié</option><option value="contacted">Contacté</option><option value="negotiation">En négociation</option><option value="won">Gagné</option><option value="lost">Perdu</option></select></label><label>Valeur €<input name="opportunityValue" type="number" min="0" step="100" defaultValue={selected.opportunityValue || 0}/></label></div><label>Prochaine action<input name="nextAction" defaultValue={selected.nextAction || ""} placeholder="Ex. rappeler le décideur"/></label><label>Date<input name="nextActionAt" type="datetime-local" defaultValue={selected.nextActionAt ? selected.nextActionAt.slice(0,16) : ""}/></label><button type="submit">Enregistrer le pipeline</button></form>
        <div className="contact-details"><div><Users size={16} /><span>Responsable</span><strong>{selected.enrichment?.fullName || selected.decisionMaker || "À enrichir"}</strong></div><div><Phone size={16} /><span>Téléphone</span><strong>{selected.phone || "À enrichir"}</strong></div><div><Mail size={16} /><span>E-mail</span><strong>{selected.enrichment?.email || selected.email || "À enrichir"}</strong></div><div><Globe2 size={16} /><span>Site</span><strong>{selected.website ? "Site disponible" : "À enrichir"}</strong></div></div>
        <div className="social-proof"><strong>Présence numérique détectée</strong><div>{selected.linkedinUrl ? <a href={selected.linkedinUrl} target="_blank" rel="noreferrer"><Users size={15}/>LinkedIn</a> : <span><Users size={15}/>LinkedIn non trouvé</span>}{selected.instagramUrl ? <a href={selected.instagramUrl} target="_blank" rel="noreferrer"><Globe2 size={15}/>Instagram</a> : <span><Globe2 size={15}/>Instagram non trouvé</span>}</div></div>
        <button className="enrich-now" disabled={enrichingId === selected.id} onClick={() => void enrichLead(selected)}>{enrichingId === selected.id ? <><span className="spinner"/>Recherche Apify + LinkedIn + IA…</> : <><WandSparkles size={17}/>Rechercher plus d'informations sur ce lead</>}</button>
        <div className="insight-box"><Sparkles size={18} /><p><strong>Analyse du lieu.</strong> {selected.chargers === 0 ? "Aucune borne n'a été détectée à moins de 80 mètres." : `${selected.chargers} borne(s) détectée(s) à moins de 80 mètres.`} {selected.chargersWithin500m} à moins de 500 m et {selected.chargersWithin2km} à moins de 2 km. {selected.parking}.</p></div>
        <div className="prospect-facts"><p><strong>Exploitant ou marque :</strong> {selected.operator || "À enrichir"}</p><p><strong>Horaires :</strong> {selected.openingHours || "À enrichir"}</p><p><strong>Borne la plus proche :</strong> {selected.nearestChargerMeters != null ? `${selected.nearestChargerMeters} m` : "Aucune donnée"}</p>{selected.description && <p><strong>Information :</strong> {selected.description}</p>}{selected.enrichment?.headline && <p><strong>Profil :</strong> {selected.enrichment.headline}</p>}{selected.enrichment?.whyNow && <p><strong>Pourquoi maintenant :</strong> {selected.enrichment.whyNow}</p>}</div>
        <h3>Icebreaker et angle d'approche</h3><blockquote>« {selected.enrichment?.icebreaker || `Bonjour, je vous contacte au sujet de l'équipement de recharge de ${selected.company}. Nos données indiquent actuellement ${selected.chargers === 0 ? "qu'aucune borne n'est référencée directement sur le site" : "une couverture qui mérite d'être vérifiée"}. Qui est la bonne personne pour parler du parking et de la mobilité électrique ?`} »</blockquote>
        {selected.enrichment?.callBrief?.length ? <div className="call-brief"><strong>Préparation de l'appel</strong><ul>{selected.enrichment.callBrief.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
        <div className="drawer-actions">{selected.phone && <a href={`tel:${selected.phone.replaceAll(" ", "")}`}><Phone size={17} />Appeler {selected.phone}</a>}{(selected.enrichment?.email || selected.email) && <a className="secondary-action" href={`mailto:${selected.enrichment?.email || selected.email}`}><Mail size={17} />Préparer un e-mail</a>}{selected.website && <a className="secondary-action" href={selected.website} target="_blank" rel="noreferrer"><Globe2 size={17} />Voir le site</a>}<a className="source-action" href={selected.sourceUrl} target="_blank" rel="noreferrer">Vérifier la fiche Google Maps</a><button onClick={() => handleNavigation("File d'appels")}>Ajouter à la file d'appels</button></div>
        {error && <div className="search-error">{error}</div>}<small>Sources publiques vérifiables. Les informations absentes ne sont jamais inventées.</small>
      </aside></div>}
      {notice && <div className="app-notice" role="status">{notice}</div>}
    </div>
  );
}
