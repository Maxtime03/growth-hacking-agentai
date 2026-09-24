"use client";

import { BarChart3, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, FileText, Flame, Inbox, Mail, Phone, RefreshCw, Send, Sparkles, Target, TrendingUp, Users, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import EmailConnections from "@/components/email-connections";
import type { Opportunity } from "@/components/dashboard";

type Props = {
  page: string;
  leads: Opportunity[];
  onOpenLead: (lead: Opportunity) => void;
  onEnrichLead: (lead: Opportunity) => void;
  enrichingId: string | null;
  onNavigate: (page: string) => void;
};

export default function CrmWorkspacePages(props: Props) {
  if (props.page === "Vue d'ensemble") return <Overview {...props} />;
  if (props.page === "Enrichissement") return <Enrichment {...props} />;
  if (props.page === "File d'appels") return <CallQueue {...props} />;
  if (props.page === "Campagnes") return <Campaigns {...props} />;
  if (props.page === "Suivis") return <FollowUps {...props} />;
  if (props.page === "Content Studio") return <ContentStudio />;
  if (props.page === "Analyses") return <Analytics {...props} />;
  if (props.page === "Expéditeurs") return <Campaigns {...props} />;
  if (props.page === "Paramètres") return <SettingsPage />;
  return null;
}

function SettingsPage() {
  return <section className="crm-page"><PageHeader eyebrow="PARAMÈTRES" title="Paramètres de l’espace de travail." description="Gérez les connexions et les préférences de Net.AI OS." /><EmailConnections expanded /></section>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="module-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function Overview({ leads, onNavigate }: Props) {
  const hot = leads.filter((lead) => lead.temperature === "Chaud" || lead.score >= 75).length;
  const callable = leads.filter((lead) => lead.phone).length;
  const emailable = leads.filter((lead) => lead.email || lead.enrichment?.email).length;
  const enriched = leads.filter((lead) => lead.enrichment).length;
  const negotiationValue = leads.filter((lead)=>lead.dealStatus==="negotiation").reduce((sum,lead)=>sum+(lead.opportunityValue||0),0);
  const wonValue = leads.filter((lead)=>lead.dealStatus==="won").reduce((sum,lead)=>sum+(lead.opportunityValue||0),0);
  const lostValue = leads.filter((lead)=>lead.dealStatus==="lost").reduce((sum,lead)=>sum+(lead.opportunityValue||0),0);
  return <section className="crm-page">
    <PageHeader eyebrow="COCKPIT COMMERCIAL" title="Votre revenu se construit ici." description="Une vue claire des opportunités, des actions à faire et des conversations à faire avancer." action={<button className="primary-cta" onClick={() => onNavigate("Radar")}><Target size={17}/>Trouver des leads</button>} />
    <div className="hero-kpis">
      <article className="hero-kpi"><span><TrendingUp size={20}/></span><p>En négociation</p><strong>{money(negotiationValue)}</strong><small>{leads.filter((lead)=>lead.dealStatus==="negotiation").length} deals actifs</small></article>
      <article><span><CircleDollarSign size={19}/></span><p>Gagné</p><strong>{money(wonValue)}</strong><small>chiffre d’affaires confirmé</small></article>
      <article><span><Target size={19}/></span><p>Perdu</p><strong>{money(lostValue)}</strong><small>à analyser pour progresser</small></article>
      <article><span><Flame size={19}/></span><p>Leads chauds</p><strong>{hot}</strong><small>{callable} appelables · {emailable} joignables</small></article>
    </div>
    <div className="cockpit-grid">
      <article className="pipeline-card"><div className="card-title"><div><h2>Pipeline</h2><p>De la détection à la signature</p></div><CircleDollarSign size={22}/></div><div className="funnel-bars"><div><span>Nouveaux</span><i style={{ width: "100%" }}/><b>{leads.filter(x=>!x.dealStatus||x.dealStatus==="new").length}</b></div><div><span>Qualifiés</span><i style={{ width: `${Math.max(8, leads.length ? leads.filter(x=>x.dealStatus==="qualified").length / leads.length * 100 : 8)}%` }}/><b>{leads.filter(x=>x.dealStatus==="qualified").length}</b></div><div><span>Contactés</span><i style={{ width: `${Math.max(5, leads.length ? leads.filter(x=>x.dealStatus==="contacted").length / leads.length * 100 : 5)}%` }}/><b>{leads.filter(x=>x.dealStatus==="contacted").length}</b></div><div><span>Négociation</span><i style={{ width: `${Math.max(4, leads.length ? leads.filter(x=>x.dealStatus==="negotiation").length / leads.length * 100 : 4)}%` }}/><b>{leads.filter(x=>x.dealStatus==="negotiation").length}</b></div></div><small className="truth-note">Les montants proviennent uniquement des valeurs saisies dans les fiches prospects.</small></article>
      <article className="next-actions"><div className="card-title"><div><h2>Prochaines actions</h2><p>Ce qui mérite votre attention maintenant</p></div><Clock3 size={21}/></div><button onClick={() => onNavigate("File d'appels")}><span className="action-icon"><Phone size={16}/></span><div><strong>Appeler les leads prioritaires</strong><small>{callable} fiches avec téléphone</small></div><ChevronRight size={17}/></button><button onClick={() => onNavigate("Enrichissement")}><span className="action-icon purple"><WandSparkles size={16}/></span><div><strong>Compléter les profils</strong><small>{Math.max(0, leads.length - enriched)} leads à enrichir</small></div><ChevronRight size={17}/></button><button onClick={() => onNavigate("Campagnes")}><span className="action-icon amber"><Mail size={16}/></span><div><strong>Préparer une prise de contact</strong><small>{emailable} contacts avec email</small></div><ChevronRight size={17}/></button></article>
    </div>
  </section>;
}

function Enrichment({ leads, onOpenLead, onEnrichLead, enrichingId }: Props) {
  return <section className="crm-page"><PageHeader eyebrow="ENRICHISSEMENT" title="Chaque appel commence avec un avantage." description="Décideur, présence sociale, contexte, angle d’approche et preuves vérifiables." />
    <div className="module-toolbar"><strong>{leads.length} leads</strong><span>{leads.filter((lead) => lead.enrichment).length} déjà enrichis</span></div>
    <div className="lead-card-grid">{leads.map((lead) => <article key={lead.id}><div className="lead-card-top"><div className="company-logo">{lead.company.charAt(0)}</div><div><strong>{lead.company}</strong><span>{lead.location}</span></div><em className={`heat heat-${lead.score >= 75 ? "hot" : "warm"}`}><Flame size={12}/>{lead.score}</em></div><p>{lead.fitReason || "Profil à analyser avant prise de contact."}</p><div className="data-completeness"><span><i className={lead.phone ? "done" : ""}/>Téléphone</span><span><i className={lead.email || lead.enrichment?.email ? "done" : ""}/>Email</span><span><i className={lead.linkedinUrl ? "done" : ""}/>LinkedIn</span><span><i className={lead.enrichment ? "done" : ""}/>Brief IA</span></div><div className="card-actions"><button onClick={() => onOpenLead(lead)}>Voir la fiche</button><button className="primary" disabled={enrichingId === lead.id} onClick={() => onEnrichLead(lead)}>{enrichingId === lead.id ? "Recherche…" : "Enrichir"}</button></div></article>)}{!leads.length && <Empty title="Aucun lead à enrichir" text="Lancez une recherche dans le Radar pour alimenter cette file."/>}</div>
  </section>;
}

function CallQueue({ leads, onOpenLead }: Props) {
  const calls = leads.filter((lead) => lead.phone).sort((a,b) => b.score-a.score);
  return <section className="crm-page"><PageHeader eyebrow="FILE D'APPELS" title="Le bon prospect, au bon moment." description="Une file priorisée avec le contexte nécessaire pour ne jamais appeler à froid." />
    <div className="call-layout"><div className="call-list">{calls.map((lead, index) => <article key={lead.id}><span className="queue-number">{String(index+1).padStart(2,"0")}</span><div><strong>{lead.company}</strong><small>{lead.decisionMaker || "Décideur à confirmer"} · {lead.location}</small><p>{lead.enrichment?.whyNow || lead.fitReason || "Valider le besoin et le bon interlocuteur."}</p></div><div className="call-score"><b>{lead.score}</b><span>/100</span></div><a href={`tel:${lead.phone?.replaceAll(" ", "")}`}><Phone size={15}/>Appeler</a><button onClick={() => onOpenLead(lead)}>Fiche</button></article>)}{!calls.length && <Empty title="Aucun numéro disponible" text="Enrichissez les leads pour trouver des coordonnées publiques."/>}</div><aside className="call-coach"><Sparkles size={22}/><h3>Coach d’appel</h3><p>Ouvrez une fiche avant chaque appel : l’icebreaker, le besoin probable et la prochaine étape y sont préparés.</p><div><strong>Objectif du jour</strong><b>{Math.min(12,calls.length)} appels</b><span>{calls.length ? "Commencez par le meilleur score." : "Ajoutez d'abord des contacts."}</span></div></aside></div>
  </section>;
}

function Campaigns({ leads }: Props) {
  return <section className="crm-page"><PageHeader eyebrow="CAMPAGNES" title="Des emails individuels, pas du bruit." description="Générez un message à partir des faits du lead, relisez-le, puis envoyez-le manuellement depuis votre compte professionnel." /><EmailConnections expanded /><EmailComposer leads={leads}/></section>;
}

function FollowUps({ leads }: Props) {
  return <section className="crm-page"><PageHeader eyebrow="SUIVIS" title="Aucune conversation ne se perd." description="Inbox unifiée, réponses entrantes, classification et prochaine action proposée." /><InboxPanel/><div className="followup-board"><article><span>Leads à qualifier</span><strong>{leads.length}</strong><small>issus du Radar</small></article><article><span>Avec email</span><strong>{leads.filter((lead)=>lead.email||lead.enrichment?.email).length}</strong><small>prêts au contact</small></article><article><span>Sans email</span><strong>{leads.filter((lead)=>!lead.email&&!lead.enrichment?.email).length}</strong><small>à enrichir</small></article><article><span>Profils chauds</span><strong>{leads.filter((lead)=>lead.score>=75).length}</strong><small>à traiter en priorité</small></article></div></section>;
}

function ContentStudio() {
  return <section className="crm-page"><PageHeader eyebrow="CONTENT STUDIO" title="Une présence utile qui prépare la vente." description="Transformez une actualité ou un article en contenu LinkedIn, newsletter, PDF ou script vidéo." /><div className="studio-layout"><article className="content-brief"><label>Marque<select><option>Net.AI</option><option>Pluq</option><option>Lexicon</option><option>Profitflow</option></select></label><label>Source ou idée<textarea placeholder="Collez un article, une actualité ou votre idée…"/></label><label>Format<div className="format-pills"><button className="active" disabled>LinkedIn</button><button disabled>Newsletter</button><button disabled>PDF</button><button disabled>Vidéo</button></div></label><button className="primary-cta" disabled><Sparkles size={16}/>À venir — préparation de contenu</button></article><article className="studio-preview"><FileText size={28}/><h3>Aperçu</h3><p>La génération et la publication seront disponibles après branchement du fournisseur de contenu.</p></article></div></section>;
}

function Analytics({ leads }: Props) {
  const buckets = [0,0,0,0]; leads.forEach((lead) => { buckets[Math.min(3, Math.floor(lead.score/25))]++; });
  const max = Math.max(1,...buckets);
  return <section className="crm-page"><PageHeader eyebrow="ANALYSES" title="Comprendre ce qui crée des rendez-vous." description="Qualité des données, répartition des scores et performance par offre." /><div className="analytics-grid"><article><div className="card-title"><div><h2>Répartition des scores</h2><p>Qualité actuelle des opportunités</p></div><BarChart3 size={21}/></div><div className="score-chart">{buckets.map((value,index)=><div key={index}><b>{value}</b><i style={{height:`${Math.max(5,value/max*100)}%`}}/><span>{index*25}-{index===3?100:index*25+24}</span></div>)}</div></article><article><div className="card-title"><div><h2>Couverture des données</h2><p>Ce qui est prêt pour l’action</p></div><CheckCircle2 size={21}/></div><Metric label="Téléphone" value={leads.filter(x=>x.phone).length} total={leads.length}/><Metric label="Email" value={leads.filter(x=>x.email||x.enrichment?.email).length} total={leads.length}/><Metric label="LinkedIn" value={leads.filter(x=>x.linkedinUrl).length} total={leads.length}/><Metric label="Brief enrichi" value={leads.filter(x=>x.enrichment).length} total={leads.length}/></article></div></section>;
}

function Metric({label,value,total}:{label:string;value:number;total:number}) { const percent=total?Math.round(value/total*100):0; return <div className="coverage-row"><div><span>{label}</span><b>{value}/{total}</b></div><i><em style={{width:`${percent}%`}}/></i></div>; }
function Empty({title,text}:{title:string;text:string}) { return <div className="module-empty"><Inbox size={25}/><strong>{title}</strong><span>{text}</span></div>; }

type Connection = { id:string; email_address:string; display_name?:string|null; canRead:boolean; canSend:boolean };
function EmailComposer({ leads }: { leads: Opportunity[] }) {
  const contactable = leads.filter((lead)=>lead.email||lead.enrichment?.email);
  const [connections,setConnections]=useState<Connection[]>([]); const [leadId,setLeadId]=useState(contactable[0]?.id||""); const [connectionId,setConnectionId]=useState("");
  const [subject,setSubject]=useState(""); const [body,setBody]=useState(""); const [busy,setBusy]=useState(false); const [notice,setNotice]=useState("");
  const lead=contactable.find((item)=>item.id===leadId)||contactable[0];
  useEffect(()=>{fetch("/api/email/connections").then(r=>r.json()).then(p=>{setConnections(p.items||[]);setConnectionId((p.items||[])[0]?.id||"");}).catch(()=>undefined);},[]);
  async function draft(){if(!lead)return;setBusy(true);setNotice("");try{const r=await fetch("/api/email/draft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:lead.company,person:lead.enrichment?.fullName||lead.decisionMaker,offer:lead.recommendedOffer,evidence:[lead.fitReason,lead.enrichment?.icebreaker,lead.enrichment?.whyNow].filter(Boolean).join(" · ")})});const p=await r.json();if(!r.ok)throw new Error(p.error);setSubject(p.subject);setBody(p.body);}catch(e){setNotice(e instanceof Error?e.message:"Génération impossible.");}finally{setBusy(false);}}
  async function send(){if(!lead||!window.confirm(`Envoyer maintenant cet email à ${lead.email||lead.enrichment?.email} ?`))return;setBusy(true);setNotice("");try{const r=await fetch("/api/email/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({connectionId,leadId:lead.id,to:lead.email||lead.enrichment?.email,subject,body})});const p=await r.json();if(!r.ok)throw new Error(p.error);setNotice("Email envoyé et enregistré dans le suivi.");}catch(e){setNotice(e instanceof Error?e.message:"Envoi impossible.");}finally{setBusy(false);}}
  return <div className="composer-card"><div className="composer-form"><label>Lead<select value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">Sélectionner un lead</option>{contactable.map(item=><option key={item.id} value={item.id}>{item.company} · {item.email||item.enrichment?.email}</option>)}</select></label><label>Expéditeur<select value={connectionId} onChange={e=>setConnectionId(e.target.value)}><option value="">Sélectionner un compte</option>{connections.map(item=><option key={item.id} value={item.id}>{item.email_address}</option>)}</select></label><label>Objet<input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Objet de l'email"/></label><label>Message<textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Générez puis personnalisez votre message…"/></label><div className="composer-actions"><button onClick={draft} disabled={!lead||busy}><Sparkles size={15}/>Générer avec l’IA</button><button className="primary" onClick={send} disabled={!lead||!connectionId||!subject||!body||busy}><Send size={15}/>Envoyer maintenant</button></div>{notice&&<p className="composer-notice">{notice}</p>}</div><aside><strong>Contrôle qualité</strong><ul><li>Faits vérifiables uniquement</li><li>Message court et personnalisé</li><li>Envoi après votre validation</li><li>Historique conservé dans Supabase</li></ul></aside></div>;
}

function InboxPanel(){const[connections,setConnections]=useState<Connection[]>([]);const[connectionId,setConnectionId]=useState("");const[items,setItems]=useState<Array<{id:string;from:string;subject:string;snippet:string;date:string;unread:boolean;direction:string;classification:string;nextAction:string}>>([]);const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  useEffect(()=>{fetch("/api/email/connections").then(r=>r.json()).then(p=>{setConnections(p.items||[]);setConnectionId((p.items||[])[0]?.id||"");}).catch(()=>undefined);},[]);
  async function load(){if(!connectionId)return;setBusy(true);setError("");try{const r=await fetch(`/api/email/inbox?connectionId=${encodeURIComponent(connectionId)}`);const p=await r.json();if(!r.ok)throw new Error(p.error);setItems(p.items||[]);}catch(e){setError(e instanceof Error?e.message:"Inbox indisponible.");}finally{setBusy(false);}}
  useEffect(()=>{if(connectionId)void load();},[connectionId]);
  return <div className="inbox-card"><div className="inbox-toolbar"><div><Inbox size={18}/><strong>Boîte de réception</strong></div><select value={connectionId} onChange={e=>setConnectionId(e.target.value)}><option value="">Compte Google</option>{connections.map(c=><option key={c.id} value={c.id}>{c.email_address}</option>)}</select><button onClick={load} disabled={!connectionId||busy}><RefreshCw size={14}/>{busy?"Synchronisation…":"Actualiser"}</button></div>{error&&<p className="email-config-note">{error}</p>}<div className="message-list">{items.map(item=><article key={item.id} className={item.unread?"unread":""}><span className={`message-direction ${item.direction}`}>{item.direction==="inbound"?labelClassification(item.classification):"Envoyé"}</span><div><strong>{item.from}</strong><b>{item.subject}</b><p>{item.snippet}</p><small className="next-action">Prochaine étape : {item.nextAction}</small></div><time>{item.date?new Date(item.date).toLocaleDateString("fr-BE"):""}</time></article>)}{!items.length&&!busy&&!error&&<Empty title="Aucun message chargé" text="Connectez un compte autorisé à lire Gmail puis actualisez."/>}</div></div>;
}
function labelClassification(value:string){return value==="positive"?"Positif":value==="negative"?"Négatif":value==="question"?"Question":"À lire";}
function money(value:number){return new Intl.NumberFormat("fr-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value);}
