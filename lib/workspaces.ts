import type { ChatGPTUser } from "@/app/chatgpt-auth";

export type WorkspaceSlug = "net-ai" | "lexicon" | "pluq" | "profitflow";
export type WorkspaceConfig = {
  slug: WorkspaceSlug;
  label: string;
  objective: string;
  mapLayer: "business" | "business+ocm";
  scoringModel: "general" | "lexicon" | "pluq" | "profitflow";
  profitflowRevenueFloor?: number;
};

export const WORKSPACE_CONFIGS: Record<WorkspaceSlug, WorkspaceConfig> = {
  "net-ai": { slug: "net-ai", label: "Exploration large", objective: "Recherche générale multi-secteurs.", mapLayer: "business", scoringModel: "general" },
  lexicon: { slug: "lexicon", label: "Lexicon", objective: "Visibilité web et visibilité dans les réponses IA.", mapLayer: "business", scoringModel: "lexicon" },
  pluq: { slug: "pluq", label: "Pluq OpportunityFinder", objective: "Sites avec parking et potentiel de recharge.", mapLayer: "business+ocm", scoringModel: "pluq" },
  profitflow: { slug: "profitflow", label: "Profitflow", objective: "Entreprises avec besoin potentiel de financement.", mapLayer: "business", scoringModel: "profitflow", profitflowRevenueFloor: 320000 },
};

export function normalizeWorkspace(value: unknown): WorkspaceSlug {
  return value === "lexicon" || value === "pluq" || value === "profitflow" ? value : "net-ai";
}

export function canAccessWorkspace(user: ChatGPTUser | null, workspace: WorkspaceSlug) {
  if (!user) return false;
  const email = user.email.trim().toLowerCase();
  if (email === "etiennedujardin@hotmail.com") return workspace === "lexicon";
  return true;
}

export function workspaceForProfile(profile: unknown): WorkspaceConfig {
  return WORKSPACE_CONFIGS[normalizeWorkspace(profile)];
}
