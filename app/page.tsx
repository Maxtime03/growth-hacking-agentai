import Dashboard from "@/components/dashboard";
import { chatGPTSignOutPath, isAllowedChatGPTUser, isLocalDevelopmentRequest, requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await isLocalDevelopmentRequest()) {
    return <Dashboard userEmail="hello@net-ia.biz" ocmConnected={Boolean(process.env.OPEN_CHARGE_MAP_API_KEY)} apifyConnected={Boolean(process.env.APIFY_API_TOKEN)} />;
  }
  const user = await requireChatGPTUser("/");
  const normalizedEmail = user.email.trim().toLowerCase();

  if (!isAllowedChatGPTUser(normalizedEmail)) {
    return (
      <main className="access-page">
        <section className="access-card">
          <div className="access-logo">N</div>
          <p className="access-eyebrow">NET.AI LEADOS</p>
          <h1>Accès non autorisé</h1>
          <p>Le compte <strong>{user.email}</strong> n’est pas autorisé à ouvrir ce tableau de bord.</p>
          <a href={chatGPTSignOutPath("/")}>Utiliser un autre compte</a>
        </section>
      </main>
    );
  }

  return <Dashboard
    userEmail={user.email}
    ocmConnected={Boolean(process.env.OPEN_CHARGE_MAP_API_KEY)}
    apifyConnected={Boolean(process.env.APIFY_API_TOKEN)}
  />;
}
