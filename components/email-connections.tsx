"use client";

import { CircleCheck, Mail, Plus, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

type Connection = { id:string;provider:string;email_address:string;display_name?:string|null;status:string;status_detail?:string|null;scopes?:string[];canRead?:boolean;canDraft?:boolean;last_sync_at?:string|null;watch_expiration?:string|null;synced_message_count?:number;workspaces?:Array<{id:string;slug:string;name:string}> };

export default function EmailConnections({ expanded = false }: { expanded?: boolean }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy,setBusy]=useState<string|null>(null);const[notice,setNotice]=useState<string|null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch("/api/email/connections", { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Comptes indisponibles.");
      setItems(payload.items || []);
    }).catch((cause) => setError(cause instanceof Error && cause.name === "AbortError" ? "La connexion email a expiré. Réessayez ou reconnectez Google." : cause instanceof Error ? cause.message : "Comptes indisponibles.")).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);
  async function sync(id:string){setBusy(id);setNotice(null);try{const response=await fetch("/api/email/sync",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:id})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Synchronisation impossible.");setNotice(`${payload.mode==="initial"?"Première synchronisation":"Synchronisation incrémentale"} terminée · ${payload.processed} message(s) traité(s).`);location.reload();}catch(cause){setError(cause instanceof Error?cause.message:"Synchronisation impossible.");}finally{setBusy(null);}}
  async function disconnect(id:string){if(!window.confirm("Déconnecter ce compte Gmail de Net.AI OS ? Les conversations déjà synchronisées sont conservées."))return;setBusy(id);const response=await fetch(`/api/email/connections/disconnect?connectionId=${encodeURIComponent(id)}`,{method:"DELETE"});const payload=await response.json();if(!response.ok)setError(payload.error||"Déconnexion impossible.");else setItems(current=>current.map(item=>item.id===id?{...item,status:"revoked"}:item));setBusy(null);}
  return <section className={`email-connections ${expanded ? "email-connections-expanded" : ""}`}>
    <div><p className="eyebrow">EXPÉDITEURS</p><h2>Comptes email professionnels et personnels</h2><span>Connexion OAuth sécurisée. Net.AI OS ne reçoit jamais votre mot de passe.</span></div>
    <div className="email-account-list">{items.map((item) => <article key={item.id} className="email-account-detail"><span className="email-provider"><Mail size={17}/></span><div><strong>{item.display_name||"Nom Google non fourni"} · {item.email_address}</strong><small>Workspaces : {item.workspaces?.map(w=>w.name||w.slug).join(", ")||"aucun"}</small><small>Scopes : {(item.scopes||[]).map(s=>s.split("/").pop()).join(", ")||"aucun"}</small><small>Dernière synchro : {when(item.last_sync_at)} · Watch : {when(item.watch_expiration)}</small><small>{item.synced_message_count||0} messages synchronisés</small><div className="email-account-actions"><button onClick={()=>void sync(item.id)} disabled={busy===item.id||item.status==="revoked"}><RefreshCw size={12}/>{busy===item.id?"Synchronisation…":"Synchroniser maintenant"}</button><a href="/api/email/google/start">Reconnecter</a><button onClick={()=>void disconnect(item.id)} disabled={busy===item.id||item.status==="revoked"}><Unplug size={12}/>Déconnecter</button></div></div><em className={item.status==="connected"&&item.canRead&&item.canDraft?"":"needs-reconnect"}><CircleCheck size={13}/>{status(item)}</em></article>)}{!items.length&&!error&&<p className="no-email-account">Aucun compte connecté</p>}</div>
    {(error||notice)&&<p className="email-config-note" role="status">{error||notice}</p>}
    <a className="connect-google" href="/api/email/google/start"><Plus size={16}/>{items.length ? "Reconnecter / ajouter" : "Connecter un compte Google"}</a>
  </section>;
}
function when(value?:string|null){if(!value)return"jamais";return new Date(value).toLocaleString("fr-BE");}
function status(item:Connection){if(item.status==="revoked")return"Déconnecté";if(item.status==="expired")return"Expiré";if(item.status==="error")return"Erreur";return item.canRead&&item.canDraft?"Connecté":"À reconnecter";}
