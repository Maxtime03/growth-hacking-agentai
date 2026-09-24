import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Net.AI LeadOS",
  description: "Radar commercial, enrichissement et suivi de leads pour Pluq, Lexicon et Profitflow.",
  other: { "codex-preview": "development" },
  icons: { icon: "/netai-icon.jpg", shortcut: "/netai-icon.jpg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
