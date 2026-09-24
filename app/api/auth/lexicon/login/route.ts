import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = String(body.email || "").trim().toLowerCase();
  if (email !== "etiennedujardin@hotmail.com" || !body.password) return Response.json({ error: "Identifiants Lexicon invalides." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase Auth non configuré." }, { status: 503 });
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: body.password }), cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string };
  if (!response.ok || !payload.access_token || !payload.refresh_token) return Response.json({ error: "Connexion Lexicon refusée." }, { status: 401 });
  const jar = await cookies();
  const secure = process.env.LOCAL_DEV_MODE !== "true";
  jar.set("sb-access-token", payload.access_token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 3600 });
  jar.set("sb-refresh-token", payload.refresh_token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return Response.json({ ok: true, workspace: "lexicon" });
}
