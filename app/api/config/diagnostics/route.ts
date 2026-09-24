import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { getIntegrationDiagnostics } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getAuthorizedChatGPTUser()) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  return Response.json({ items: getIntegrationDiagnostics() });
}
