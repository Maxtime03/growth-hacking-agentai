import Dashboard from "@/components/dashboard";
import { isAllowedChatGPTUser, isLocalDevelopmentRequest, requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceRoute() {
  if (await isLocalDevelopmentRequest()) {
    return <Dashboard userEmail="hello@net-ia.biz" ocmConnected={Boolean(process.env.OPEN_CHARGE_MAP_API_KEY)} apifyConnected={Boolean(process.env.APIFY_API_TOKEN)} />;
  }
  const user = await requireChatGPTUser("/");
  const normalizedEmail = user.email.trim().toLowerCase();
  if (!isAllowedChatGPTUser(normalizedEmail)) return <main className="access-page"><section className="access-card"><h1>Accès non autorisé</h1><p>Ce compte n’est pas autorisé à ouvrir Net.AI OS.</p></section></main>;
  return <Dashboard userEmail={user.email} ocmConnected={Boolean(process.env.OPEN_CHARGE_MAP_API_KEY)} apifyConnected={Boolean(process.env.APIFY_API_TOKEN)} />;
}
