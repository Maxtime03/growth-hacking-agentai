"use client";

import { CircleCheck, Mail, Plus } from "lucide-react";
import { useEffect, useState } from "react";

type Connection = { id: string; provider: string; email_address: string; display_name?: string | null; status: string; canRead?: boolean; canSend?: boolean; last_sync_at?: string | null };

export default function EmailConnections({ expanded = false }: { expanded?: boolean }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/email/connections").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Comptes indisponibles.");
      setItems(payload.items || []);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Comptes indisponibles."));
  }, []);
  return <section className={`email-connections ${expanded ? "email-connections-expanded" : ""}`}>
    <div><p className="eyebrow">EXPÉDITEURS</p><h2>Comptes email professionnels et personnels</h2><span>Connexion OAuth sécurisée. Net.AI OS ne reçoit jamais votre mot de passe.</span></div>
    <div className="email-account-list">{items.map((item) => <article key={item.id}><span className="email-provider"><Mail size={17}/></span><div><strong>{item.display_name || item.email_address}</strong><small>{item.email_address} · {item.canRead && item.canSend ? "lecture + envoi autorisés" : "autorisation incomplète — reconnecter"}</small></div><em className={item.canRead && item.canSend ? "" : "needs-reconnect"}><CircleCheck size={13}/>{item.canRead && item.canSend ? "Connecté" : "À reconnecter"}</em></article>)}{!items.length && !error && <p className="no-email-account">Aucun compte connecté pour le moment.</p>}</div>
    {error && <p className="email-config-note">{error}</p>}
    <a className="connect-google" href="/api/email/google/start"><Plus size={16}/>{items.length ? "Reconnecter / ajouter" : "Connecter un compte Google"}</a>
  </section>;
}
