"use client";

import { BarChart3, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, FileText, Flame, Inbox, Mail, Phone, RefreshCw, Send, Sparkles, Target, TrendingUp, Users, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import EmailConnections from "@/components/email-connections";
import LeadEmailEditorDurable from "@/components/lead-email-editor-durable";
import CallQueueFunctional from "@/components/call-queue-functional";
import type { Opportunity } from "@/components/dashboard";
import { displayText, safeInitial } from "@/lib/provider-normalization";

type Props = {
  page: string;
  leads: Opportunity[];
  onOpenLead: (lead: Opportunity) => void;
  onEnrichLead: (lead: Opportunity) => void;
  enrichingId: string | null;
  onNavigate: (page: string) => void;
};

export default function CrmWorkspacePages(props: Props) {
  const normalizedPage = props.page.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (normalizedPage === "Expediteurs") return <Campaigns {...props} />;
  if (normalizedPage === "Parametres") return <SettingsPage />;
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
  const safeLeads=leads.filter((lead):lead is Opportunity=>Boolean(lead&&typeof lead==="object"&&typeof lead.id==="string"&&lead.id));
  return <section className="crm-page"><PageHeader eyebrow="ENRICHISSEMENT" title="Chaque appel commence avec un avantage." description="Décideur, présence sociale, contexte, angle d’approche et preuves vérifiables." />
    <div className="module-toolbar"><strong>{safeLeads.length} leads</strong><span>{safeLeads.filter((lead) => lead.enrichment).length} déjà enrichis</span></div>
    <div className="lead-card-grid">{safeLeads.map((lead) => {const company=displayText(lead.company,"Entreprise sans nom");return <article key={lead.id}><div className="lead-card-top"><div className="company-logo">{safeInitial(company)}</div><div><strong>{company}</strong><span>{displayText(lead.location,"Localisation à enrichir")}</span></div><em className={`heat heat-${Number(lead.score||0) >= 75 ? "hot" : "warm"}`}><Flame size={12}/>{Number(lead.score||0)}</em></div><p>{displayText(lead.fitReason,"Profil à analyser avant prise de contact.")}</p><div className="data-completeness"><span><i className={lead.phone ? "done" : ""}/>Téléphone</span><span><i className={lead.email || lead.enrichment?.email ? "done" : ""}/>Email</span><span><i className={lead.linkedinUrl ? "done" : ""}/>LinkedIn</span><span><i className={lead.enrichment ? "done" : ""}/>Brief IA</span></div><div className="card-actions"><button onClick={() => onOpenLead(lead)}>Voir la fiche</button><button className="primary" disabled={enrichingId === lead.id} onClick={() => onEnrichLead(lead)}>{enrichingId === lead.id ? "Recherche…" : "Enrichir"}</button></div></article>})}{!safeLeads.length && <Empty title="Aucun lead à enrichir" text="Lancez une recherche dans le Radar pour alimenter cette file."/>}</div>
  </section>;
}

function CallQueue({ leads, onOpenLead }: Props) {
  return <section className="crm-page"><PageHeader eyebrow="FILE D'APPELS" title="Le bon prospect, au bon moment." description="Une file priorisée avec le contexte nécessaire pour ne jamais appeler à froid." />
    <CallQueueFunctional leads={leads} onOpenLead={onOpenLead}/>
  </section>;
}

function Campaigns({ leads }: Props) {
  return <section className="crm-page"><PageHeader eyebrow="CAMPAGNES" title="Des emails individuels, pas du bruit." description="Le même brouillon interne est restauré ici et dans la fiche lead, même sans compte Gmail." /><EmailConnections expanded /><CampaignDrafts leads={leads}/></section>;
}

function CampaignDrafts({leads}:{leads:Opportunity[]}){const eligible=leads.filter(lead=>lead&&lead.id);const[selectedId,setSelectedId]=useState(eligible[0]?.id||"");const selected=eligible.find(lead=>lead.id===selectedId)||eligible[0];return <div className="campaign-drafts"><label>Lead<select value={selectedId} onChange={event=>setSelectedId(event.target.value)}><option value="">Sélectionner un lead</option>{eligible.map(lead=><option key={lead.id} value={lead.id}>{displayText(lead.company,"Entreprise sans nom")}</option>)}</select></label>{selected?<LeadEmailEditorDurable compact lead={{...selected,id:selected.databaseId||selected.id,workspaceId:String((selected as unknown as Record<string,unknown>).workspaceId||""),company:displayText(selected.company,"Entreprise sans nom"),contacts:selected.enrichment?[{full_name:selected.enrichment.fullName,email:selected.enrichment.email}]:[],evidence:(selected.enrichment?.sources||[]).map(source=>({fact:selected.fitReason||"Source d’enrichissement",source_url:source})),workspace:{slug:String((selected as unknown as {workspace?:{slug?:string}}).workspace?.slug||"lexicon"),label:selected.recommendedOffer||"Lexicon"}}}/>:<Empty title="Aucun lead sélectionné" text="Ajoutez ou sélectionnez un lead avant de préparer un brouillon."/>}</div>}

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

function InboxPanel(){type Thread={id:string;gmail_thread_id:string;subject:string;snippet:string;last_message_at:string;unread:boolean;classification:string;needs_association:boolean;leads?:{id:string;company_name?:string;legal_name?:string}|null};type MessageRow={id:string;from_address:string;to_addresses:string[];subject:string;snippet:string;text_body?:string;html_body?:string;sent_at:string;direction:string;email_attachments?:Array<{id:string;filename:string;mime_type:string}>};const[connections,setConnections]=useState<Connection[]>([]);const[connectionId,setConnectionId]=useState("");const[items,setItems]=useState<Thread[]>([]);const[selected,setSelected]=useState<{thread:Thread;items:MessageRow[]}|null>(null);const[filter,setFilter]=useState("all");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  useEffect(()=>{fetch("/api/email/connections").then(r=>r.json()).then(p=>{setConnections(p.items||[]);setConnectionId((p.items||[])[0]?.id||"");}).catch(()=>undefined);},[]);
  async function load(){if(!connectionId)return;setBusy(true);setError("");try{const r=await fetch(`/api/email/inbox?connectionId=${encodeURIComponent(connectionId)}&filter=${filter}`);const p=await r.json();if(!r.ok)throw new Error(p.error);setItems(p.items||[]);}catch(e){setError(e instanceof Error?e.message:"Inbox indisponible.");}finally{setBusy(false);}}
  async function sync(){if(!connectionId)return;setBusy(true);try{const r=await fetch("/api/email/sync",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:connectionId})});const p=await r.json();if(!r.ok)throw new Error(p.error);await load();}catch(e){setError(e instanceof Error?e.message:"Synchronisation impossible.");}finally{setBusy(false);}}
  async function open(thread:Thread){const r=await fetch(`/api/email/inbox?connectionId=${encodeURIComponent(connectionId)}&threadId=${encodeURIComponent(thread.gmail_thread_id)}`);const p=await r.json();if(r.ok)setSelected({thread:p.thread,items:p.items||[]});else setError(p.error||"Conversation indisponible.");}
  useEffect(()=>{if(connectionId)void load();},[connectionId,filter]);
  const filters=[['all','Tous'],['unread','Non lus'],['positive','Positifs'],['negative','Négatifs'],['vacation','Absences'],['unsubscribe','Désabonnements'],['uncertain','À classifier'],['unmatched','À associer']];
  return <div className="inbox-card"><div className="inbox-toolbar"><div><Inbox size={18}/><strong>Boîte de réception CRM</strong></div><select value={connectionId} onChange={e=>setConnectionId(e.target.value)}><option value="">Tous les comptes autorisés</option>{connections.map(c=><option key={c.id} value={c.id}>{c.email_address}</option>)}</select><button onClick={sync} disabled={!connectionId||busy}><RefreshCw size={14}/>{busy?"Synchronisation…":"Synchroniser"}</button></div><div className="inbox-filters">{filters.map(([value,label])=><button className={filter===value?"active":""} key={value} onClick={()=>setFilter(value)}>{label}</button>)}</div>{error&&<p className="email-config-note">{error}</p>}<div className="message-list">{items.map(item=><article key={item.id} className={item.unread?"unread":""} onClick={()=>void open(item)}><span className="message-direction inbound">{labelClassification(item.classification)}</span><div><strong>{item.leads?.legal_name||item.leads?.company_name||(item.needs_association?"À associer":"Sans lead")}</strong><b>{item.subject}</b><p>{item.snippet}</p><small>{item.needs_association?"Correspondance à valider":"Lead lié"}</small></div><time>{item.last_message_at?new Date(item.last_message_at).toLocaleDateString("fr-BE"):""}</time></article>)}{!items.length&&!busy&&!error&&<Empty title="Aucune conversation" text="La première synchronisation charge au maximum les 30 derniers jours."/>}</div>{selected&&<aside className="thread-panel"><button onClick={()=>setSelected(null)}>Fermer</button><h3>{selected.thread.subject}</h3>{selected.items.map(message=><article key={message.id}><header><strong>{message.from_address}</strong><span>→ {message.to_addresses?.join(", ")}</span><time>{new Date(message.sent_at).toLocaleString("fr-BE")}</time></header><p>{message.text_body||message.snippet}</p>{message.email_attachments?.map(file=><small key={file.id}>Pièce jointe : {file.filename} · {file.mime_type}</small>)}</article>)}<div className="thread-actions"><button>Répondre</button><button>Créer un brouillon</button>{selected.thread.leads?.id&&<a href={`/leads/${selected.thread.leads.id}`}>Ouvrir la fiche lead</a>}<button>Changer la classification</button><button>Programmer une action</button><button>Marquer lu / non lu</button></div></aside>}</div>;
}
function labelClassification(value:string){return({positive:"Positif",meeting:"Rendez-vous",question:"Question",negative:"Négatif",not_now:"Pas maintenant",vacation:"Absence",unsubscribe:"Désabonnement",bounce:"Bounce",automatic:"Automatique",uncertain:"À classifier",unclassified:"À classifier"} as Record<string,string>)[value]||"À lire";}
function money(value:number){return new Intl.NumberFormat("fr-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value);}
