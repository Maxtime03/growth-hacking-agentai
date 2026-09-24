"use client";
import { FormEvent, useState } from "react";
export default function LexiconSignIn() {
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const response = await fetch("/api/auth/lexicon/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "etiennedujardin@hotmail.com", password }) }); const payload = await response.json(); if (!response.ok) setError(payload.error || "Connexion refusée."); else window.location.assign("/radar"); setBusy(false); }
  return <main className="access-page"><section className="access-card"><p className="eyebrow">LEXICON</p><h1>Connexion Lexicon</h1><p>Accès réservé à l’espace Lexicon.</p><form onSubmit={submit}><label>Mot de passe<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="primary-cta" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>{error && <p role="alert" className="search-error">{error}</p>}</form></section></main>;
}
