import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SignInWithChatGPTPage() {
  return <main className="access-page"><section className="access-card"><p className="eyebrow">NET.AI OS</p><h1>Connexion requise</h1><p>La session de production doit être fournie par l’authentification ChatGPT autorisée.</p><Link className="primary-cta" href="/signin-lexicon">Connexion Lexicon locale</Link></section></main>;
}
